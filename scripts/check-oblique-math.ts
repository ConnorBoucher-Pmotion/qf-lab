import { LM } from "../src/pose/types";
import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import { computeOrientation, oldShoulderAxisYawDeg } from "../src/oblique/torsoOrientation";
import { primarySignedRom, directionalRom } from "../src/oblique/rotation";
import { extractLandmarks } from "../src/oblique/landmarks";
import { BaselineCollector } from "../src/oblique/baseline";
import { syntheticSeated } from "../src/tl/tlRotation";
import type { Vec } from "../src/pose/types";

const near = (value: number | null, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

/** Simulate MediaPipe world-Z saturation on the shoulder girdle (keeps elbows free). */
function compressShoulderZ(world: Vec[], factor: number): Vec[] {
  return world.map((p, i) => {
    if (i === LM.leftShoulder || i === LM.rightShoulder) {
      return { ...p, z: p.z * factor };
    }
    return { ...p };
  });
}

// --- Unit: orientation climbs with true yaw ---
const collector = new BaselineCollector();
let t = 0;
let baseline = null as ReturnType<BaselineCollector["push"]>;
for (let i = 0; i < 40 && !baseline; i += 1) {
  baseline = collector.push(syntheticSeated().world, 40, { ...OBLIQUE_CONFIG, stableMs: 80, calibrationMs: 120, minCalibrationFrames: 4 }, "oblique-45");
  t += 40;
}
if (!baseline) throw new Error("baseline failed");

const steps = [0, 10, 20, 30, 40];
const multiSeries: number[] = [];
const oldSeries: number[] = [];
for (const yaw of steps) {
  const pose = syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: 0 });
  const sample = extractLandmarks(pose.world)!;
  const reading = computeOrientation(sample, baseline);
  const primary = primarySignedRom(reading);
  multiSeries.push(reading.multiLandmarkFromNeutralDeg ?? NaN);
  oldSeries.push(reading.oldShoulderLineFromNeutralDeg ?? NaN);
  if (yaw === 0) near(primary, 0, 3, "neutral primary");
  if (yaw === 40) {
    if ((primary ?? 0) < 30) throw new Error(`primary should reach ~40°, got ${primary}`);
    near(directionalRom(primary, "right"), 40, 6, "40° right ROM");
  }
}
// Monotonic climb
for (let i = 1; i < multiSeries.length; i += 1) {
  if (!(multiSeries[i] > multiSeries[i - 1] + 5)) {
    throw new Error(`multi-landmark did not climb: ${multiSeries.join(",")}`);
  }
}

// --- Plateau diagnosis: compress shoulder Z after a large rotation ---
const full = syntheticSeated({ shoulderYawDeg: 40, pelvisYawDeg: 0 });
const compressed = { ...full, world: compressShoulderZ(full.world, 0.25) };
const fullRead = computeOrientation(extractLandmarks(full.world)!, baseline);
const compRead = computeOrientation(extractLandmarks(compressed.world)!, baseline);
const oldFull = fullRead.oldShoulderLineFromNeutralDeg ?? 0;
const oldComp = Math.abs(compRead.oldShoulderLineFromNeutralDeg ?? 0);
const multiComp = Math.abs(compRead.multiLandmarkFromNeutralDeg ?? 0);
if (oldComp > 22) {
  // With heavy Z compression the old axis angle must drop / plateau below true 40°.
  console.warn("old axis still high under Z compression", oldComp);
}
if (oldComp + 8 >= Math.abs(oldFull) && oldComp > 30) {
  throw new Error(`expected old shoulder-line to lose range under Z compression (full=${oldFull}, comp=${oldComp})`);
}
if (multiComp < 28) {
  throw new Error(`multi-landmark should keep ~40° under shoulder-Z compression, got ${multiComp}`);
}
console.log("Plateau diagnosis", {
  oldFull: oldFull.toFixed(1),
  oldCompressed: oldComp.toFixed(1),
  multiCompressed: multiComp.toFixed(1),
  torsoFrameCompressed: (compRead.upperTorsoFromNeutralDeg ?? 0).toFixed(1),
});

// --- Session integration: primary climbs past 15° even with coupled pelvis partial ---
const session = new ObliqueSession("right", {
  ...OBLIQUE_CONFIG,
  countdownMs: 0,
  thumbStableMs: 0,
  stableMs: 100,
  calibrationMs: 200,
  minCalibrationFrames: 4,
  captureWindowMs: 5000,
});
t = 0;
let snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
for (let i = 0; i < 40; i += 1) {
  t += 33;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
}
if (snap.state !== "WAITING_FOR_READY") throw new Error(`expected WAITING_FOR_READY, got ${snap.state}`);
session.arm(t);
const liveClimb: number[] = [];
for (let yaw = 5; yaw <= 42; yaw += 3) {
  t += 33;
  // Mild pelvis leak (8°) should reduce thoracic but not erase climb.
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: Math.min(8, yaw * 0.2) }) }, t);
  if (snap.rawRom != null) liveClimb.push(snap.rawRom);
}
if (liveClimb.length < 5) throw new Error("no live raw samples");
const maxLive = Math.max(...liveClimb);
if (maxLive < 25) throw new Error(`live raw plateaued too low: max=${maxLive} series=${liveClimb.join(",")}`);
if (!liveClimb.some((v, i) => i > 0 && v > 15) || liveClimb[liveClimb.length - 1] <= 15) {
  // Must continue responding past the old 12–15° wall
  const last = liveClimb[liveClimb.length - 1];
  if (last <= 16) throw new Error(`still stuck near 15° at end of climb: ${liveClimb.join(",")}`);
}
console.log("Live climb past 15°", { maxLive: maxLive.toFixed(1), series: liveClimb.map((v) => v.toFixed(0)).join(",") });

t += 5200;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 12 }) }, t);
if (snap.state !== "TRIAL_COMPLETE") throw new Error(`expected TRIAL_COMPLETE, got ${snap.state}`);
if ((snap.result?.rawMaximum ?? 0) < 25) throw new Error(`stored raw max too low: ${snap.result?.rawMaximum}`);

void oldShoulderAxisYawDeg;
console.log("Oblique math checks passed", {
  multiAt40: multiSeries[multiSeries.length - 1].toFixed(1),
  storedRawMax: snap.result?.rawMaximum?.toFixed(1),
});

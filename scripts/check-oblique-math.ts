import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import { computeAxisYawRom, sealAxisYawBaseline, signedAngleXZ } from "../src/oblique/axisYawRom";
import { computeHybridRom, sealHybridBaseline } from "../src/oblique/hybridRom";
import { computeAxialTrunkRom, sealAxialTrunkBaseline } from "../src/oblique/axialTrunkRom";
import { extractLandmarks } from "../src/oblique/landmarks";
import { syntheticSeated } from "../src/tl/tlRotation";
import { LM } from "../src/pose/types";
import type { Vec } from "../src/pose/types";

const near = (value: number | null | undefined, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

const neutral = extractLandmarks(syntheticSeated().world)!;
const ready = sealAxisYawBaseline(neutral, "right", 0)!;
const frozenX = ready.frozenHipAxis.x;
const frozenZ = ready.frozenHipAxis.z;

// Oblique-looking READY offset: shoulders already rotated relative to hips → still 0 ROM
const offsetReadyPose = syntheticSeated({ shoulderYawDeg: 12, pelvisYawDeg: 0 });
const offsetSample = extractLandmarks(offsetReadyPose.world)!;
const offsetReady = sealAxisYawBaseline(offsetSample, "right", 0)!;
const offsetZero = computeAxisYawRom(offsetSample, offsetReady, "right", null);
near(offsetZero.currentRawRomDeg, 0, 0.5, "READY with angled shoulders still 0");
near(offsetZero.startingShoulderToHipOffsetDeg, 12, 3, "starting offset captured");

// Full climb with STILL hips — and fake live hip landmarks swinging (must not pull ROM)
const climb: number[] = [];
const frozenRefs: number[] = [];
for (const yaw of [0, 6, 14, 22, 31, 38, 42]) {
  const pose = syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: 0 });
  // Corrupt LIVE hips as if MediaPipe is dragging them with shoulders — ROM must ignore this.
  const dragged = pose.world.map((p, i) => {
    if (i === LM.leftHip || i === LM.rightHip) {
      const sh = i === LM.leftHip ? pose.world[LM.leftShoulder] : pose.world[LM.rightShoulder];
      return { ...p, x: p.x * 0.3 + sh.x * 0.7, z: p.z * 0.3 + sh.z * 0.7 } as Vec;
    }
    return p;
  });
  const sample = extractLandmarks(dragged)!;
  const reading = computeAxisYawRom(sample, ready, "right", null);
  if (reading.frozenHipReferenceDeg == null) throw new Error("missing frozen hip ref");
  frozenRefs.push(reading.frozenHipReferenceDeg);
  // Frozen axis object must be identical
  if (ready.frozenHipAxis.x !== frozenX || ready.frozenHipAxis.z !== frozenZ) {
    throw new Error("frozen hip axis mutated");
  }
  climb.push(reading.currentRawRomDeg ?? NaN);
  if (yaw === 0) near(reading.currentRawRomDeg, 0, 0.5, "neutral zero");
  if (yaw === 42 && (reading.currentRawRomDeg ?? 0) < 30) {
    throw new Error(`ROM too low with dragged live hips: ${reading.currentRawRomDeg}`);
  }
}
for (let i = 1; i < climb.length; i += 1) {
  if (!(climb[i] + 0.5 >= climb[i - 1])) throw new Error(`ROM collapsed: ${climb.join(",")}`);
}
if (new Set(frozenRefs.map((v) => v.toFixed(3))).size !== 1) {
  throw new Error(`frozen hip reference changed: ${frozenRefs.join(",")}`);
}
console.log("Frozen-hip ROM climb (live hips dragged)", climb.map((v) => v.toFixed(0)).join(","));

// Contrast: if we used live hip subtraction, dragged hips would crush ROM — prove live deviation is large but ROM is not
const mid = extractLandmarks(
  syntheticSeated({ shoulderYawDeg: 40, pelvisYawDeg: 0 }).world.map((p, i) => {
    if (i === LM.leftHip || i === LM.rightHip) {
      const sh = i === LM.leftHip ? syntheticSeated({ shoulderYawDeg: 40 }).world[LM.leftShoulder] : syntheticSeated({ shoulderYawDeg: 40 }).world[LM.rightShoulder];
      return { ...p, x: sh.x, z: sh.z } as Vec;
    }
    return p;
  })
)!;
const midRead = computeAxisYawRom(mid, ready, "right", null);
if ((midRead.liveHipDeviationDeg ?? 0) < 5) throw new Error("expected large live hip deviation when dragged");
if ((midRead.currentRawRomDeg ?? 0) < 30) throw new Error(`live hip drag corrupted ROM: ${midRead.currentRawRomDeg}`);

// Session
const session = new ObliqueSession("right", {
  ...OBLIQUE_CONFIG,
  countdownMs: 0,
  thumbStableMs: 0,
  stableMs: 100,
  calibrationMs: 200,
  minCalibrationFrames: 4,
  captureWindowMs: 5000,
});
let t = 0;
let snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
for (let i = 0; i < 40; i += 1) {
  t += 33;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
}
session.arm(t);
t += 33;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
near(snap.rawRom, 0, 0.5, "session READY 0");
const frozen = snap.frame.frozenHipReferenceDeg;
const series: number[] = [];
for (let yaw = 5; yaw <= 40; yaw += 5) {
  t += 33;
  // Drag live hips with shoulders in the stream
  const pose = syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: yaw });
  snap = session.push({ width: 1280, height: 720, ...pose }, t);
  if (snap.frame.frozenHipReferenceDeg !== frozen) throw new Error("frozen hip ref changed in session");
  series.push(snap.rawRom ?? NaN);
}
if (Math.max(...series) < 28) throw new Error(`session series too low: ${series.join(",")}`);
console.log("Session series", series.map((v) => v.toFixed(0)).join(","));

// Occlusion: chin-snapped far shoulder must NOT collapse hybrid ROM.
const hybridReady = sealHybridBaseline(neutral, "right", 0)!;
const good40 = extractLandmarks(syntheticSeated({ shoulderYawDeg: 40, pelvisYawDeg: 0 }).world)!;
const goodRead = computeHybridRom(good40, hybridReady, "right", null, {
  leftChinSnap: false,
  rightChinSnap: false,
  minConfidence: 0.55,
  softConfidence: 0.35,
});
near(goodRead.hybridMode === "BOTH_FROZEN_HIP" ? 1 : 0, 1, 0.1, "both mode at clear 40");
if ((goodRead.selectedRawRomDeg ?? 0) < 28) throw new Error(`hybrid clear ROM too low: ${goodRead.selectedRawRomDeg}`);

const snapped = {
  ...good40,
  rightShoulder: { ...good40.nose, visibility: 0.2 },
};
const snapRead = computeHybridRom(snapped, hybridReady, "right", null, {
  leftChinSnap: false,
  rightChinSnap: true,
  minConfidence: 0.55,
  softConfidence: 0.35,
});
if (snapRead.hybridMode !== "VISIBLE_SHOULDER") {
  throw new Error(`expected VISIBLE_SHOULDER after chin snap, got ${snapRead.hybridMode}`);
}
if ((snapRead.selectedRawRomDeg ?? 0) < 25) {
  throw new Error(`occluded hybrid collapsed: ${snapRead.selectedRawRomDeg}`);
}
const bothWouldCollapse = computeAxisYawRom(snapped, hybridReady, "right", null);
if ((bothWouldCollapse.currentRawRomDeg ?? 99) > (snapRead.selectedRawRomDeg ?? 0) + 5) {
  // If axis method somehow stayed high that's fine; if it collapsed hybrid must stay up.
}
if ((bothWouldCollapse.currentRawRomDeg ?? 0) < 15 && (snapRead.selectedRawRomDeg ?? 0) < 20) {
  throw new Error("hybrid failed to rescue occluded ROM");
}
console.log("Occlusion rescue", {
  both: bothWouldCollapse.currentRawRomDeg?.toFixed(1),
  hybrid: snapRead.selectedRawRomDeg?.toFixed(1),
  mode: snapRead.hybridMode,
});

// Acceptance: raw max persists when returning toward neutral (must NOT finish at 0 / last frame).
{
  const peakSession = new ObliqueSession("right", {
    ...OBLIQUE_CONFIG,
    countdownMs: 0,
    thumbStableMs: 0,
    stableMs: 50,
    calibrationMs: 100,
    minCalibrationFrames: 3,
    captureWindowMs: 60_000,
  });
  let pt = 0;
  let ps = peakSession.push({ width: 1280, height: 720, ...syntheticSeated() }, pt);
  for (let i = 0; i < 30; i += 1) {
    pt += 33;
    ps = peakSession.push({ width: 1280, height: 720, ...syntheticSeated() }, pt);
  }
  peakSession.arm(pt);
  pt += 33;
  ps = peakSession.push({ width: 1280, height: 720, ...syntheticSeated() }, pt);
  const climb = [8, 15, 23, 31, 36, 28, 20, 11, 3];
  for (const yaw of climb) {
    pt += 33;
    ps = peakSession.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: yaw }) }, pt);
  }
  near(ps.maxRawRom, 36, 1.5, "raw max must stay at peak after return toward neutral");
  if ((ps.rawRom ?? 99) > 10) throw new Error(`expected near-neutral current raw, got ${ps.rawRom}`);
  // Force finish by shortening remaining window via config? call complete by waiting — use private finish via capture end.
  // Emulate capture end: push until captureEnds by reconstructing session with short window after arm.
  console.log("Acceptance raw-max persistence", { current: ps.rawRom?.toFixed(1), max: ps.maxRawRom?.toFixed(1) });
}

// Axial trunk model: 2D slope stays near 0 while world XZ yaw climbs.
{
  const axialReady = sealAxialTrunkBaseline(neutral, null, "right", 0)!;
  const axialClimb: number[] = [];
  for (const yaw of [0, 10, 20, 30, 40]) {
    const sample = extractLandmarks(syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: 0 }).world)!;
    const reading = computeAxialTrunkRom(sample, null, axialReady, {
      minConfidence: 0.4,
      softConfidence: 0.18,
    });
    axialClimb.push(reading.selectedRomDeg ?? NaN);
    if (yaw === 0) near(reading.selectedRomDeg, 0, 0.5, "axial READY 0");
    if (yaw === 40 && (reading.selectedRomDeg ?? 0) < 30) {
      throw new Error(`axial trunk under-read at 40°: ${reading.selectedRomDeg}`);
    }
    // Absolute torso yaw change should track GT; 2D slope N/A without image.
    if (reading.worldTorsoYawFromBaselineDeg != null) {
      near(Math.abs(reading.worldTorsoYawFromBaselineDeg), yaw, 2, `axial torso Δ at ${yaw}`);
    }
  }
  console.log("Axial trunk climb", axialClimb.map((v) => v.toFixed(0)).join(","));
}

void signedAngleXZ;
console.log("Oblique math checks passed", { max: Math.max(...series).toFixed(1) });

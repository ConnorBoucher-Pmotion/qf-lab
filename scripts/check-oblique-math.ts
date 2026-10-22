import { LM } from "../src/pose/types";
import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import {
  computePrimaryRom,
  primarySide,
  sealReadyBaseline,
  signedXZAngleDeg,
} from "../src/oblique/primaryShoulderRom";
import { extractLandmarks } from "../src/oblique/landmarks";
import { syntheticSeated } from "../src/tl/tlRotation";

const near = (value: number | null | undefined, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

if (primarySide("right") !== "left") throw new Error("RIGHT trial must use LEFT shoulder primary");
if (primarySide("left") !== "right") throw new Error("LEFT trial must use RIGHT shoulder primary");

// Unit: signed XZ angle of left shoulder around hip for right rotation
const n = extractLandmarks(syntheticSeated().world)!;
const t40 = extractLandmarks(syntheticSeated({ shoulderYawDeg: 40, pelvisYawDeg: 0 }).world)!;
const ready = sealReadyBaseline(n, "right", 0)!;
const reading = computePrimaryRom(t40, ready, "right", 2.5);
near(reading.primaryChangeDeg, 40, 3, "right trial left-shoulder arc");
near(reading.rawTlRomDeg, 40, 3, "raw TL at 40° with still pelvis");
if ((reading.comparisonChangeDeg ?? 0) < 20) throw new Error("comparison shoulder should also move when both rotate");

// Occluded comparison must NOT drag primary down
const dragged = { ...t40 };
dragged.rightShoulder = { ...t40.rightShoulder, x: n.rightShoulder.x, z: n.rightShoulder.z, visibility: 0.1 };
const readingDrag = computePrimaryRom(dragged, ready, "right", 2.5);
if ((readingDrag.rawTlRomDeg ?? 0) < 30) {
  throw new Error(`occluded comparison dragged primary down: ${readingDrag.rawTlRomDeg} (primaryΔ=${readingDrag.primaryChangeDeg}, compΔ=${readingDrag.comparisonChangeDeg})`);
}

// Left trial uses right shoulder
const readyL = sealReadyBaseline(n, "left", 0)!;
const tLeft = extractLandmarks(syntheticSeated({ shoulderYawDeg: -38, pelvisYawDeg: 0 }).world)!;
const readingL = computePrimaryRom(tLeft, readyL, "left", 2.5);
near(readingL.primaryChangeDeg, 38, 4, "left trial right-shoulder arc");
near(readingL.rawTlRomDeg, 38, 4, "left raw TL");

// Session: READY hard-zeros, then climbs past 15°
const session = new ObliqueSession("right", {
  ...OBLIQUE_CONFIG,
  countdownMs: 0,
  thumbStableMs: 0,
  stableMs: 100,
  calibrationMs: 200,
  minCalibrationFrames: 4,
  captureWindowMs: 5000,
  pelvisDeadbandDeg: 2.5,
});
let t = 0;
let snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
for (let i = 0; i < 40; i += 1) {
  t += 33;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
}
if (snap.state !== "WAITING_FOR_READY") throw new Error(`expected WAITING_FOR_READY, got ${snap.state}`);
if (snap.frame.readyBaselineCaptured) throw new Error("READY baseline must not exist before arm()");
if ((snap.rawRom ?? -1) !== 0) throw new Error(`pre-ready display must be 0, got ${snap.rawRom}`);

session.arm(t);
t += 33;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
if (!snap.frame.readyBaselineCaptured) throw new Error("READY baseline missing after arm");
near(snap.rawRom, 0, 0.5, "hard zero at READY");
near(snap.frame.primaryChangeFromBaselineDeg, 0, 0.5, "primary change 0 at READY");
if (snap.frame.primaryLandmark !== "left") throw new Error("RIGHT trial primary must be left");

const climb: number[] = [];
const sealedBearing = snap.frame.startingPrimaryAngleDeg;
for (let yaw = 5; yaw <= 42; yaw += 3) {
  t += 33;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: 1 }) }, t);
  if (snap.frame.startingPrimaryAngleDeg !== sealedBearing) {
    throw new Error("READY baseline bearing changed during movement");
  }
  if (snap.rawRom != null) climb.push(snap.rawRom);
}
const maxLive = Math.max(...climb);
if (maxLive < 30) throw new Error(`primary arc plateaued too low: ${maxLive} series=${climb.join(",")}`);
if (climb[climb.length - 1] <= 15) throw new Error(`did not continue past 15°: ${climb.join(",")}`);
console.log("Primary-shoulder climb", { maxLive: maxLive.toFixed(1), series: climb.map((v) => v.toFixed(0)).join(",") });

// Finish window stores raw max
t += 5200;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 10 }) }, t);
if (snap.state !== "TRIAL_COMPLETE") throw new Error(`expected TRIAL_COMPLETE, got ${snap.state}`);
if ((snap.result?.rawMaximum ?? 0) < 30) throw new Error(`stored raw max too low: ${snap.result?.rawMaximum}`);

void signedXZAngleDeg;
void LM;
console.log("Oblique math checks passed", {
  rightPrimary: reading.rawTlRomDeg?.toFixed(1),
  leftPrimary: readingL.rawTlRomDeg?.toFixed(1),
  occludedStill: readingDrag.rawTlRomDeg?.toFixed(1),
  stored: snap.result?.rawMaximum?.toFixed(1),
});

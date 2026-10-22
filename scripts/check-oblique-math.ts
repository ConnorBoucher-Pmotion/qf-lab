import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import {
  axisYawDeg,
  computeAxisYawRom,
  sealAxisYawBaseline,
  shortestAngleDeltaDeg,
  unwrapAngleDeg,
} from "../src/oblique/axisYawRom";
import { sealReadyBaseline, computePrimaryRom } from "../src/oblique/primaryShoulderRom";
import { extractLandmarks } from "../src/oblique/landmarks";
import { syntheticSeated } from "../src/tl/tlRotation";
import { LM } from "../src/pose/types";

const near = (value: number | null | undefined, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

// Unwrap continuity across ±180
let u = 170;
u = unwrapAngleDeg(u, 170, -170); // +20° step across wrap
near(u, 190, 0.1, "unwrap across +180");
near(shortestAngleDeltaDeg(170, -170), 20, 0.1, "shortest delta across wrap");

const neutral = extractLandmarks(syntheticSeated().world)!;
const ready = sealAxisYawBaseline(neutral, "right", 0)!;
near(ready.baselineShoulderYawDeg, 0, 2, "neutral shoulder yaw");

const shoulderSeries: number[] = [];
const hipSeries: number[] = [];
const tlSeries: number[] = [];
const oldSeries: number[] = [];
const oldReady = sealReadyBaseline(neutral, "right", 0)!;

for (const yaw of [0, 5, 10, 15, 20, 25, 30, 35, 40]) {
  const sample = extractLandmarks(syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: yaw * 0.08 }).world)!;
  const reading = computeAxisYawRom(sample, ready, "right", oldReady);
  const old = computePrimaryRom(sample, oldReady, "right", 2.5);
  shoulderSeries.push(reading.shoulderYawChangeDeg ?? NaN);
  hipSeries.push(reading.hipYawChangeDeg ?? NaN);
  tlSeries.push(reading.currentRawRomDeg ?? NaN);
  oldSeries.push(old.primaryChangeDeg ?? NaN);
  if (yaw === 0) near(reading.currentRawRomDeg, 0, 0.5, "READY zero");
  if (yaw === 40) {
    near(reading.shoulderYawChangeDeg, 40, 3, "shoulder Δ at 40");
    if ((reading.currentRawRomDeg ?? 0) < 30) throw new Error(`TL ROM too low at 40°: ${reading.currentRawRomDeg}`);
  }
}

for (let i = 1; i < tlSeries.length; i += 1) {
  if (!(tlSeries[i] + 0.5 >= tlSeries[i - 1])) {
    throw new Error(`TL collapsed toward zero: ${tlSeries.join(",")}`);
  }
}
console.log("Axis-yaw series", {
  shoulder: shoulderSeries.map((v) => v.toFixed(0)).join(","),
  hip: hipSeries.map((v) => v.toFixed(1)).join(","),
  tl: tlSeries.map((v) => v.toFixed(0)).join(","),
  oldPivot: oldSeries.map((v) => v.toFixed(0)).join(","),
});

// Vector ordering consistency: never left−right
const turned = extractLandmarks(syntheticSeated({ shoulderYawDeg: 30 }).world)!;
const yawRL = axisYawDeg(turned.rightShoulder, turned.leftShoulder)!;
const yawLR = axisYawDeg(turned.leftShoulder, turned.rightShoulder)!;
if (Math.abs(shortestAngleDeltaDeg(yawRL, yawLR)) < 150) {
  throw new Error("left−right should be ~180° from right−left");
}

// Session integration
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
near(snap.rawRom, 0, 0.5, "session READY zero");
const baseSh = snap.frame.baselineShoulderYawDeg;
const absAtReady = snap.frame.absoluteShoulderYawDeg;
console.log("READY absolute shoulder yaw", absAtReady?.toFixed(2), "→ displayed ROM", snap.rawRom?.toFixed(1));

const climb: number[] = [];
const shClimb: number[] = [];
const hipClimb: number[] = [];
for (let yaw = 4; yaw <= 42; yaw += 4) {
  t += 33;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: 2 }) }, t);
  if (snap.frame.baselineShoulderYawDeg !== baseSh) throw new Error("baseline shoulder yaw mutated");
  climb.push(snap.rawRom ?? NaN);
  shClimb.push(snap.frame.shoulderYawChangeDeg ?? NaN);
  hipClimb.push(snap.frame.hipYawChangeDeg ?? NaN);
}
if (Math.max(...climb) < 30) throw new Error(`session climb too low: ${climb.join(",")}`);
if (climb[climb.length - 1] <= 15) throw new Error(`collapsed near end: ${climb.join(",")}`);
for (let i = 1; i < climb.length; i += 1) {
  if (climb[i] + 1 < climb[i - 1] && climb[i] < 15 && climb[i - 1] > 12) {
    throw new Error(`15→0 style collapse detected: ${climb.join(",")}`);
  }
}

t += 5200;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 8 }) }, t);
if ((snap.result?.rawMaximum ?? 0) < 30) throw new Error(`stored raw max too low: ${snap.result?.rawMaximum}`);

void LM;
console.log("Oblique math checks passed", {
  climb: climb.map((v) => v.toFixed(0)).join(","),
  shoulder: shClimb.map((v) => v.toFixed(0)).join(","),
  hip: hipClimb.map((v) => v.toFixed(1)).join(","),
  stored: snap.result?.rawMaximum?.toFixed(1),
});

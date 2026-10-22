import { LM } from "../src/pose/types";
import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import { computeRotation, directionalRom } from "../src/oblique/rotation";
import { angleDelta, subjectHorizontalYawDeg, thoracicRelativeYawDeg } from "../src/oblique/vectors";
import { syntheticSeated } from "../src/tl/tlRotation";

const near = (value: number | null, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

const neutral = syntheticSeated();
const turned = syntheticSeated({ shoulderYawDeg: 35, pelvisYawDeg: 2 });
const s0 = {
  x: neutral.world[LM.rightShoulder].x - neutral.world[LM.leftShoulder].x,
  y: neutral.world[LM.rightShoulder].y - neutral.world[LM.leftShoulder].y,
  z: neutral.world[LM.rightShoulder].z - neutral.world[LM.leftShoulder].z,
};
const h0 = {
  x: neutral.world[LM.rightHip].x - neutral.world[LM.leftHip].x,
  y: neutral.world[LM.rightHip].y - neutral.world[LM.leftHip].y,
  z: neutral.world[LM.rightHip].z - neutral.world[LM.leftHip].z,
};
const s1 = {
  x: turned.world[LM.rightShoulder].x - turned.world[LM.leftShoulder].x,
  y: turned.world[LM.rightShoulder].y - turned.world[LM.leftShoulder].y,
  z: turned.world[LM.rightShoulder].z - turned.world[LM.leftShoulder].z,
};
const shoulder0 = subjectHorizontalYawDeg(s0);
const shoulder1 = subjectHorizontalYawDeg(s1);
if (shoulder0 == null || shoulder1 == null) throw new Error("shoulder yaw missing");
const shoulderDelta = angleDelta(shoulder1, shoulder0);
near(directionalRom(shoulderDelta, "right"), 35, 4, "shoulder-from-neutral right ROM");

// Demonstrate the old bug: when pelvis tracks shoulders, thoracic relative stays near 0.
const coupled = syntheticSeated({ shoulderYawDeg: 35, pelvisYawDeg: 35 });
const sC = {
  x: coupled.world[LM.rightShoulder].x - coupled.world[LM.leftShoulder].x,
  y: coupled.world[LM.rightShoulder].y - coupled.world[LM.leftShoulder].y,
  z: coupled.world[LM.rightShoulder].z - coupled.world[LM.leftShoulder].z,
};
const hC = {
  x: coupled.world[LM.rightHip].x - coupled.world[LM.leftHip].x,
  y: coupled.world[LM.rightHip].y - coupled.world[LM.leftHip].y,
  z: coupled.world[LM.rightHip].z - coupled.world[LM.leftHip].z,
};
const thoracicCoupled = angleDelta(thoracicRelativeYawDeg(sC, hC) ?? 0, thoracicRelativeYawDeg(s0, h0) ?? 0);
const shoulderCoupled = angleDelta(subjectHorizontalYawDeg(sC) ?? 0, shoulder0);
if (Math.abs(thoracicCoupled) > 5) throw new Error(`expected thoracic≈0 when pelvis tracks, got ${thoracicCoupled}`);
if (Math.abs(shoulderCoupled) < 25) throw new Error(`expected shoulder ROM when pelvis tracks, got ${shoulderCoupled}`);

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
if (snap.state !== "WAITING_FOR_READY") throw new Error(`expected WAITING_FOR_READY, got ${snap.state}`);
if (!snap.frame.baselineSealed) throw new Error("baseline should be sealed before ready");
const sealedYaw = snap.frame.neutralShoulderYawDeg;

session.arm(t);
t += 33;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 5 }) }, t);
if (snap.state !== "MEASURING") throw new Error(`expected MEASURING, got ${snap.state}`);
if (snap.captureProgress == null) throw new Error("progress bar value missing during MEASURING");
if (snap.frame.neutralShoulderYawDeg !== sealedYaw) throw new Error("neutral baseline yaw changed after measure start");

const liveValues: number[] = [];
for (let i = 0; i < 30; i += 1) {
  t += 33;
  const yaw = 4 + i * 1.2;
  snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: yaw }) }, t);
  if (snap.shoulderRawDeg != null) liveValues.push(snap.shoulderRawDeg);
  if ((snap.rawRom ?? 0) === 0 && yaw > 15) {
    throw new Error(`live raw ROM stuck at 0 while shoulders at ${yaw}° (thoracic trap?) raw=${snap.rawRom} shoulder=${snap.shoulderRawDeg} thoracic=${snap.thoracicRawDeg}`);
  }
}
if (liveValues.length < 5) throw new Error("no live shoulder ROM samples");
const moved = liveValues.some((v, i) => i > 0 && Math.abs(v - liveValues[0]) > 8);
if (!moved) throw new Error(`live shoulder ROM did not change: ${liveValues.slice(0, 8).join(",")}`);
if ((snap.maxRawRom ?? 0) < 25) throw new Error(`raw max too low: ${snap.maxRawRom}`);

// Finish the 5s window
t += 5200;
snap = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 10 }) }, t);
if (snap.state !== "TRIAL_COMPLETE") throw new Error(`expected TRIAL_COMPLETE, got ${snap.state}`);
if (snap.result?.rawMaximum == null || snap.result.rawMaximum < 25) {
  throw new Error(`result should store raw max, got ${snap.result?.rawMaximum}`);
}
if (snap.rightResult !== snap.result.rawMaximum) throw new Error("rightResult should equal stored raw max");
if (snap.captureProgress != null) throw new Error("progress must be null after trial");

// Chin snap should not invent absolute 3D explosion
const session2 = new ObliqueSession("right", {
  ...OBLIQUE_CONFIG,
  countdownMs: 0,
  thumbStableMs: 0,
  stableMs: 100,
  calibrationMs: 200,
  minCalibrationFrames: 4,
});
t = 0;
for (let i = 0; i < 40; i += 1) {
  session2.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
  t += 33;
}
session2.arm(t);
t += 33;
for (let i = 0; i < 20; i += 1) {
  session2.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 10 + i * 1.2, pelvisYawDeg: 1 }) }, t);
  t += 33;
}
session2.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 36, pelvisYawDeg: 1 }) }, t);
const snapPose = syntheticSeated({ shoulderYawDeg: 38, pelvisYawDeg: 1 });
snapPose.world[LM.rightShoulder] = {
  ...snapPose.world[LM.nose],
  visibility: 0.85,
  x: snapPose.world[LM.nose].x + 0.02,
  y: snapPose.world[LM.nose].y - 0.02,
};
const after = session2.push({ width: 1280, height: 720, ...snapPose }, t + 33);
if ((after.rawRom ?? 0) > 70) throw new Error(`oblique raw exploded after chin snap: ${after.rawRom}`);

void computeRotation;
console.log("Oblique math checks passed", {
  shoulderDelta: shoulderDelta.toFixed(1),
  thoracicCoupled: thoracicCoupled.toFixed(1),
  shoulderCoupled: shoulderCoupled.toFixed(1),
  maxRaw: snap.result?.rawMaximum?.toFixed(1),
  afterRaw: after.rawRom?.toFixed(1),
  liveMoved: moved,
});

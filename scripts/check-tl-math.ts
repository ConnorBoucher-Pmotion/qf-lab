import { grade } from "../src/tl/tlCompensation";
import { TL_CONFIG, normalizeConfig } from "../src/tl/tlConfig";
import { TLSession } from "../src/tl/tlStateMachine";
import { captureYaws, detectSigns, leanDegrees, readRotation, syntheticSeated } from "../src/tl/tlRotation";

const near = (value: number | null, expected: number, tolerance: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, got ${value}`);
  }
};

const neutral = syntheticSeated();
const signs = detectSigns(neutral.world);
if (!signs) throw new Error("signs missing");
const baseline = captureYaws(neutral.world, neutral.image, signs);
if (!baseline) throw new Error("baseline yaws missing");
near(baseline.shoulderYawDeg, 0, 1, "neutral shoulder yaw");
near(baseline.pelvisYawDeg, 0, 1, "neutral pelvis yaw");

const both = syntheticSeated({ shoulderYawDeg: 45, pelvisYawDeg: 8 });
const relative = readRotation(both.world, both.image, baseline);
near(relative.shoulderNeutralDeg, 45, 2, "shoulder vs neutral");
near(relative.shoulderVsPelvisDeg, 37, 2, "shoulder vs pelvis");
near(relative.worldTorsoDeg, 37, 3, "world torso");
near(relative.imageDepthDeg, 37, 3, "image depth");
near(relative.pelvisYawDeg, 8, 2, "pelvis yaw");

const lean = syntheticSeated({ leanForwardM: 0.16 });
const leanReading = readRotation(lean.world, lean.image, baseline);
const leanDeg = leanDegrees(lean.world, signs);
if ((leanDeg.forward ?? 0) < 8) throw new Error(`forward lean too small: ${leanDeg.forward}`);
if (Math.abs(leanReading.worldTorsoDeg ?? 99) > 6) throw new Error(`forward lean created yaw ${leanReading.worldTorsoDeg}`);

const side = leanDegrees(syntheticSeated({ leanRightM: 0.14 }).world, signs);
if ((side.lateral ?? 0) < 6) throw new Error(`lateral lean too small: ${side.lateral}`);

if (grade(4, 3, 5) !== "warn") throw new Error("4° should warn at 3/5");
if (grade(4, 6, 10) !== "pass") throw new Error("the same 4° must pass when the config lines move");
if (grade(6, 3, 5) !== "fail") throw new Error("6° should fail at 3/5");

const fast = normalizeConfig({
  ...TL_CONFIG,
  angleFilter: "none",
  landmarkMinCutoffHz: 8,
  landmarkBeta: 0,
  outlierJumpHipWidths: 2,
  angleOutlierDeg: 40,
  reacquireFrames: 1,
  stableMs: 180,
  calibrationMs: 180,
  minCalibrationFrames: 4,
  holdMs: 280,
  movementConfirmMs: 90,
  minMovementDeg: 6,
  minVelocityDegPerSec: 8,
  peakWindowDeg: 5,
  peakVelocityDegPerSec: 12,
  hardFailPersistMs: 60,
  pelvisRotationWarnDeg: 3,
  pelvisRotationFailDeg: 5,
});

function feed(session: TLSession, pose: ReturnType<typeof syntheticSeated>, frames: number, start: number): number {
  let t = start;
  for (let i = 0; i < frames; i += 1) {
    session.push({ width: 1280, height: 720, ...pose }, t);
    t += 33;
  }
  return t;
}

const clean = new TLSession(fast, "right");
let t = feed(clean, syntheticSeated(), 40, 0);
const ready = clean.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
if (ready.state !== "READY" || ready.result) throw new Error(`neutral pose became ${ready.state}, result ${ready.result?.measuredRom}`);
t += 33;
for (let step = 1; step <= 12; step += 1) {
  t = feed(clean, syntheticSeated({ shoulderYawDeg: step * 3, pelvisYawDeg: 1 }), 2, t);
}
t = feed(clean, syntheticSeated({ shoulderYawDeg: 36, pelvisYawDeg: 1 }), 20, t);
const done = clean.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 36, pelvisYawDeg: 1 }) }, t);
if (done.state !== "COMPLETE" || !done.result?.accepted) throw new Error(`clean trial ended ${done.state} ${done.result?.instruction}`);
near(done.result.measuredRom, 36, 6, "clean valid ROM");
near(done.result.rawMaximum, 36, 6, "clean raw ROM");
if ((done.result.measuredRom ?? 0) < 8) throw new Error("resting pose was saved as the ROM");

const mixed = new TLSession(fast, "right");
t = feed(mixed, syntheticSeated(), 40, 0);
for (let step = 1; step <= 10; step += 1) t = feed(mixed, syntheticSeated({ shoulderYawDeg: step * 4 }), 2, t);
t = feed(mixed, syntheticSeated({ shoulderYawDeg: 40 }), 3, t);
for (let step = 1; step <= 8; step += 1) t = feed(mixed, syntheticSeated({ shoulderYawDeg: 40 + step * 2, leanRightM: 0.22 }), 2, t);
t = feed(mixed, syntheticSeated({ shoulderYawDeg: 56, leanRightM: 0.22 }), 20, t);
const split = mixed.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 56, leanRightM: 0.22 }) }, t);
if (!split.result) throw new Error(`compensated trial did not finish: ${split.state}`);
if ((split.result.rawMaximum ?? 0) < (split.result.measuredRom ?? 0) + 8) {
  throw new Error(`raw ${split.result.rawMaximum} should stay above valid ${split.result.measuredRom}`);
}
if ((split.result.measuredRom ?? 99) > 48) throw new Error(`valid peak followed the lean: ${split.result.measuredRom}`);
const leanCheck = split.checks.find((check) => check.id === "trunk-lateral");
if (leanCheck?.status !== "fail") throw new Error(`trunk lean status ${leanCheck?.status} value ${leanCheck?.value}`);

const loose = normalizeConfig({ ...fast, lateralLeanFailDeg: 40, lateralLeanWarnDeg: 30 });
mixed.setConfig(loose);
const after = mixed.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 56, leanRightM: 0.22 }) }, t + 33);
const leanAfter = after.checks.find((check) => check.id === "trunk-lateral");
if (leanAfter?.status === "fail") throw new Error("raising the lean fail line did not change the live check");

const left = new TLSession(fast, "left");
t = feed(left, syntheticSeated(), 40, 0);
t = feed(left, syntheticSeated({ shoulderYawDeg: -30, pelvisYawDeg: 0 }), 16, t);
const leftSnap = left.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: -30 }) }, t);
if ((leftSnap.rom.current ?? 0) < 20) throw new Error(`left rotation did not read positive for the subject: ${leftSnap.rom.current}`);

console.log("TL math checks passed");
console.log({
  relative: relative.shoulderVsPelvisDeg?.toFixed(1),
  neutralShoulder: relative.shoulderNeutralDeg?.toFixed(1),
  valid: done.result.measuredRom?.toFixed(1),
  raw: split.result.rawMaximum?.toFixed(1),
  validWhilePelvisFailed: split.result.measuredRom?.toFixed(1),
});

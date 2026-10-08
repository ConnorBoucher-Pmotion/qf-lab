import { grade } from "../src/tl/tlCompensation";
import { TL_CONFIG, normalizeConfig } from "../src/tl/tlConfig";
import { TLSession } from "../src/tl/tlStateMachine";
import { OneEuroFilter } from "../src/pose/oneEuro";
import { captureYaws, cameraFacing, detectSigns, leanDegrees, readRotation, subjectYawDeg, syntheticSeated } from "../src/tl/tlRotation";
import { LM } from "../src/pose/types";

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
near(relative.shoulderFromNeutralDeg, 45, 2, "3D shoulder yaw");
near(relative.legacyDeg, 37, 2, "legacy shoulder minus pelvis");
near(relative.torsoPelvisDeg, 37, 3, "shoulder vs pelvis vector");
near(relative.depthWidthDeg, 45, 3, "width foreshortening");
near(relative.pelvisYawDeg, 8, 2, "pelvis yaw");

const lean = syntheticSeated({ leanForwardM: 0.16 });
const leanReading = readRotation(lean.world, lean.image, baseline);
const leanDeg = leanDegrees(lean.world, signs);
if ((leanDeg.forward ?? 0) < 8) throw new Error(`forward lean too small: ${leanDeg.forward}`);
if (Math.abs(leanReading.shoulderFromNeutralDeg ?? 99) > 6) throw new Error(`forward lean created shoulder yaw ${leanReading.shoulderFromNeutralDeg}`);
if (Math.abs(leanReading.depthWidthDeg ?? 99) > 6) throw new Error(`forward lean created width yaw ${leanReading.depthWidthDeg}`);

const turned = syntheticSeated({ shoulderYawDeg: 40 });
const compressed = {
  image: turned.image,
  world: turned.world.map((point) => ({ ...point, z: point.z * 0.5 })),
};
const crushed = readRotation(compressed.world, compressed.image, baseline);
near(crushed.shoulderFromNeutralDeg, 22.8, 2, "compressed Z shoulder yaw");
near(crushed.depthWidthDeg, 40, 3, "width yaw survives compressed Z");
if ((crushed.depthWidthDeg ?? 0) < (crushed.shoulderFromNeutralDeg ?? 0) + 10) {
  throw new Error(`width method did not stay above the compressed yaw (${crushed.depthWidthDeg} vs ${crushed.shoulderFromNeutralDeg})`);
}

const back = readRotation(syntheticSeated().world, syntheticSeated().image, baseline);
near(back.shoulderFromNeutralDeg, 0, 1.5, "shoulder yaw back at neutral");
near(back.legacyDeg, 0, 1.5, "legacy back at neutral");
near(back.depthWidthDeg, 0, 1.5, "width yaw back at neutral");

function mirrorWorld(pose: ReturnType<typeof syntheticSeated>): ReturnType<typeof syntheticSeated> {
  return { image: pose.image, world: pose.world.map((point) => ({ ...point, x: -point.x })) };
}
const mirroredNeutral = mirrorWorld(syntheticSeated());
const mirroredSigns = detectSigns(mirroredNeutral.world);
if (!mirroredSigns) throw new Error("mirrored signs missing");
const mirroredBaseline = captureYaws(mirroredNeutral.world, mirroredNeutral.image, mirroredSigns);
if (!mirroredBaseline) throw new Error("mirrored baseline missing");
const mirroredTurn = readRotation(mirrorWorld(syntheticSeated({ shoulderYawDeg: 30 })).world, mirroredNeutral.image, mirroredBaseline);
near(mirroredTurn.shoulderFromNeutralDeg, 30, 2, "mirrored frame keeps subject's right positive");

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
  countdownMs: 0,
  minActiveMs: 0,
  minPeakRomDeg: 6,
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
if (ready.state !== "READY" || ready.result || ready.movementStarted || ready.rom.rawPeak != null) {
  throw new Error(`neutral pose became ${ready.state}, result ${ready.result?.measuredRom}`);
}
const leaked = feed(clean, syntheticSeated({ shoulderYawDeg: 15 }), 20, t);
const beforeStart = clean.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 15 }) }, leaked);
if (beforeStart.movementStarted || beforeStart.state !== "READY" || beforeStart.rom.rawPeak != null || beforeStart.rom.validPeak != null) {
  throw new Error(`rotation before Start was captured (${beforeStart.state}, peak ${beforeStart.rom.rawPeak})`);
}
clean.arm(leaked);
t = leaked + 33;
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
mixed.arm(t);
t += 33;
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

/** Real MediaPipe puts the subject's left landmarks at +x. The old signed hip yaw then wraps to ~180° when xSign is left at its default. */
const frontalCamera = mirrorWorld(syntheticSeated());
const oldHipYaw = subjectYawDeg(frontalCamera.world[LM.leftHip], frontalCamera.world[LM.rightHip], 1);
if (oldHipYaw == null || Math.abs(Math.abs(oldHipYaw) - 180) > 8) throw new Error(`old face-camera yaw should wrap near 180° on a frontal pose, got ${oldHipYaw}`);
near(cameraFacing(frontalCamera.world).scoreDeg, 0, 2, "frontal facing score");

const facingOf = (yaw: number) => {
  const session = new TLSession(fast, "right");
  return session.push({ width: 1280, height: 720, ...mirrorWorld(syntheticSeated({ shoulderYawDeg: yaw, pelvisYawDeg: yaw })) }, 0).cameraFacing;
};
if (facingOf(0).status !== "pass") throw new Error(`frontal status ${facingOf(0).status} score ${facingOf(0).scoreDeg}`);
if (facingOf(8).status !== "pass") throw new Error(`8° should stay a pass, got ${facingOf(8).status} (${facingOf(8).scoreDeg})`);
near(facingOf(8).scoreDeg, 8, 2, "8° facing score");
if (facingOf(15).status !== "warn") throw new Error(`15° should warn, got ${facingOf(15).status} (${facingOf(15).scoreDeg})`);
if (facingOf(70).status !== "fail") throw new Error(`70° should fail, got ${facingOf(70).status} (${facingOf(70).scoreDeg})`);

const frontalSession = new TLSession(fast, "right");
let tf = feed(frontalSession, frontalCamera, 40, 0);
const frontalReady = frontalSession.push({ width: 1280, height: 720, ...frontalCamera }, tf);
if (frontalReady.state !== "READY") {
  const blocking = frontalReady.setupChecks.filter((check) => check.blocking && (check.status === "fail" || check.status === "na")).map((check) => check.id);
  throw new Error(`frontal pose did not reach READY (${frontalReady.state}): ${blocking.join(", ")}`);
}

const sidePose = mirrorWorld(syntheticSeated({ shoulderYawDeg: 70, pelvisYawDeg: 70 }));
const sideSession = new TLSession(fast, "right");
feed(sideSession, sidePose, 40, 0);
const sideStuck = sideSession.push({ width: 1280, height: 720, ...sidePose }, 2000);
if (sideStuck.state !== "POSITIONING") throw new Error(`side-on pose advanced to ${sideStuck.state}`);

const bypassSession = new TLSession(normalizeConfig({ ...fast, bypassFaceCamera: true }), "right");
feed(bypassSession, sidePose, 40, 0);
const bypassReady = bypassSession.push({ width: 1280, height: 720, ...sidePose }, 2000);
if (bypassReady.cameraFacing.status !== "fail") throw new Error("bypass hid the failure");
if (bypassReady.state !== "READY") throw new Error(`bypass did not allow calibration (${bypassReady.state})`);

const life = new TLSession(normalizeConfig({ ...fast, movementConfirmFrames: 2 }), "right");
const roms: number[] = [];
const ids: string[] = [];
let clock = 0;
for (const peak of [28, 16, 34]) {
  clock = feed(life, syntheticSeated(), 40, clock);
  const armed = life.push({ width: 1280, height: 720, ...syntheticSeated() }, clock);
  if (armed.state !== "READY" || armed.movementStarted || armed.rom.active != null || armed.rom.validPeak != null) {
    throw new Error(`trial ${roms.length + 1} was not armed cleanly (${armed.state}, active ${armed.rom.active}, peak ${armed.rom.validPeak})`);
  }
  clock += 33;
  const wobble = life.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 3 }) }, clock);
  if (wobble.movementStarted || wobble.state !== "READY" || wobble.rom.active != null) throw new Error(`a 3° settle started trial ${roms.length + 1}`);
  life.arm(clock);
  clock += 33;
  for (let step = 1; step <= 36; step += 1) clock = feed(life, syntheticSeated({ shoulderYawDeg: (peak * step) / 36 }), 1, clock);
  clock = feed(life, syntheticSeated({ shoulderYawDeg: peak }), 24, clock);
  const finished = life.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: peak }) }, clock);
  if (finished.state !== "COMPLETE" || finished.result?.measuredRom == null) throw new Error(`trial ${roms.length + 1} did not complete (${finished.state})`);
  roms.push(finished.result.measuredRom);
  ids.push(finished.result.id);
  life.nextTrial();
  const cleared = life.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: peak }) }, clock + 33);
  if (cleared.baselineReady || cleared.movementStarted || cleared.rom.active != null) {
    throw new Error(`next trial kept trial ${roms.length} state (${cleared.state})`);
  }
  clock += 66;
}
if (new Set(ids).size !== 3) throw new Error("trial ids were reused");
if (Math.abs(roms[0] - roms[1]) < 5 || Math.abs(roms[1] - roms[2]) < 5) throw new Error(`trials did not keep separate ROM ${roms.join(", ")}`);

const redo = new TLSession(normalizeConfig({ ...fast, movementConfirmFrames: 2 }), "right");
clock = feed(redo, syntheticSeated(), 40, 0);
redo.arm(clock);
clock += 33;
clock = feed(redo, syntheticSeated({ shoulderYawDeg: 20 }), 8, clock);
const mid = redo.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 20 }) }, clock);
if (!mid.movementStarted) throw new Error("reset test never started");
redo.reset();
const again = redo.push({ width: 1280, height: 720, ...syntheticSeated() }, clock + 33);
if (again.movementStarted || again.baselineReady || again.rom.validPeak != null) throw new Error("reset current trial kept the attempt");

const counted = new TLSession(normalizeConfig({ ...fast, countdownMs: 900 }), "right");
clock = feed(counted, syntheticSeated(), 40, 0);
counted.arm(clock);
const during = counted.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 25 }) }, clock + 500);
if (during.state !== "COUNTDOWN" || during.movementStarted || during.rom.rawPeak != null || during.rom.validPeak != null || during.rom.active != null) {
  throw new Error(`countdown counted as a measurement (${during.state}, peak ${during.rom.rawPeak}, label ${during.countdownLabel})`);
}
if (during.countdownLabel !== "2" && during.countdownLabel !== "1" && during.countdownLabel !== "3") {
  throw new Error(`countdown label ${during.countdownLabel}`);
}
const rotateCue = counted.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 25 }) }, clock + 1000);
if (rotateCue.countdownLabel !== "ROTATE" || rotateCue.movementStarted || rotateCue.rom.rawPeak != null) {
  throw new Error(`ROTATE cue started measurement (${rotateCue.countdownLabel}, peak ${rotateCue.rom.rawPeak})`);
}
counted.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 25 }) }, clock + 1300);
const measuring = counted.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 25 }) }, clock + 1333);
if (!measuring.movementStarted || measuring.rom.active == null) throw new Error(`measurement did not begin after ROTATE (${measuring.state})`);

const tiny = new TLSession(normalizeConfig({ ...fast, minPeakRomDeg: 20, minActiveMs: 400, holdMs: 200 }), "right");
clock = feed(tiny, syntheticSeated(), 40, 0);
tiny.arm(clock);
clock = feed(tiny, syntheticSeated({ shoulderYawDeg: 5 }), 40, clock + 33);
const five = tiny.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 5 }) }, clock);
if (five.result || five.state === "COMPLETE" || five.state === "HOLD") throw new Error(`a 5° pause finished the trial (${five.state})`);

const manual = new TLSession(normalizeConfig({ ...fast, minPeakRomDeg: 20 }), "right");
clock = feed(manual, syntheticSeated(), 40, 0);
manual.arm(clock);
clock = feed(manual, syntheticSeated({ shoulderYawDeg: 12 }), 8, clock + 33);
manual.acceptPeak();
const accepted = manual.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 12 }) }, clock);
if (accepted.state !== "COMPLETE" || accepted.result?.measuredRom == null) throw new Error(`accept peak did not store the trial (${accepted.state})`);

const tester = new TLSession(normalizeConfig({ ...fast, romTestMode: true, minPeakRomDeg: 5, holdMs: 100 }), "right");
clock = feed(tester, syntheticSeated(), 40, 0);
if (!tester.push({ width: 1280, height: 720, ...syntheticSeated() }, clock).movementStarted) throw new Error("test mode did not start after calibration");
clock = feed(tester, syntheticSeated({ shoulderYawDeg: 35 }), 30, clock);
clock = feed(tester, syntheticSeated({ shoulderYawDeg: -28 }), 20, clock);
const free = tester.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: -28 }) }, clock);
if (free.result) throw new Error("test mode completed a trial on its own");
const shoulderRow = free.algorithmsLive.find((row) => row.id === "shoulderYaw");
if ((shoulderRow?.rightPeak ?? 0) < 25 || (shoulderRow?.leftPeak ?? 0) < 20) {
  throw new Error(`test mode peaks right ${shoulderRow?.rightPeak} left ${shoulderRow?.leftPeak}`);
}

const oldFilter = new OneEuroFilter(1.2, 0.04);
const newFilter = new OneEuroFilter(3, 0.35);
let oldValue = 0;
let newValue = 0;
for (let i = 1; i <= 30; i += 1) {
  const target = (40 * i) / 30;
  oldValue = oldFilter.filter(target, i * 33, 1);
  newValue = newFilter.filter(target, i * 33, 1);
}
for (let i = 31; i <= 60; i += 1) {
  oldValue = oldFilter.filter(40, i * 33, 1);
  newValue = newFilter.filter(40, i * 33, 1);
}

console.log("TL math checks passed");
console.log({
  legacy: relative.legacyDeg?.toFixed(1),
  shoulderYaw: relative.shoulderFromNeutralDeg?.toFixed(1),
  torsoPelvis: relative.torsoPelvisDeg?.toFixed(1),
  depthWidth: relative.depthWidthDeg?.toFixed(1),
  compressedYaw: crushed.shoulderFromNeutralDeg?.toFixed(1),
  compressedWidth: crushed.depthWidthDeg?.toFixed(1),
  neutralReturn: back.shoulderFromNeutralDeg?.toFixed(1),
  mirroredRight: mirroredTurn.shoulderFromNeutralDeg?.toFixed(1),
  oldFilterAfterHold: oldValue.toFixed(1),
  newFilterAfterHold: newValue.toFixed(1),
  valid: done.result.measuredRom?.toFixed(1),
  raw: split.result.rawMaximum?.toFixed(1),
});

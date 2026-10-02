import { PROVISIONAL_QF_CONFIG, configProblems, type QFConfig } from "../src/qf/qfConfig";
import { recordingIntent } from "../src/recording/recordingIntent";
import { buildMeasurementChecks, buildSetupChecks, hardFailures } from "../src/qf/qfConstraints";
import { emptyMetrics, extractMetrics, sharedPelvisShift } from "../src/qf/qfMeasurement";
import { computeAngles, pelvisFrameShankDeg, shankLateralDeg } from "../src/qf/qfMeasurementEngine";
import { scoreQuality } from "../src/qf/qfQuality";
import { describe } from "../src/qf/qfRepeatability";
import { emptyTracking } from "../src/qf/qfTracking";
import {
  BODY_NEUTRAL,
  CAMERAS,
  bodyPoints,
  mulberry32,
  newSession,
  project,
  run,
  trialPhases,
  type Noise,
} from "./qfSynthetic";

const quiet: Noise = { px: 0.15, world: 0.002, worldZ: 0.006 };
const config: QFConfig = {
  ...PROVISIONAL_QF_CONFIG,
  hardFailPersistMs: 80,
  trackingLostMs: 400,
  searchGraceMs: 200,
  confidenceGraceMs: 40,
  setupGraceMs: 80,
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const knee = { x: 460, y: 590, z: 0, visibility: 1 };
const down = { x: 460, y: 860, z: 0, visibility: 1 };
const outRight = { x: 390, y: 860, z: 0, visibility: 1 };
const outLeft = { x: 530, y: 860, z: 0, visibility: 1 };
assert(Math.abs(shankLateralDeg(knee, down, "right")) < 0.01, "vertical right shank should be 0");
assert(shankLateralDeg(knee, outRight, "right") > 10, "right foot moving to the athlete's right is positive");
assert(shankLateralDeg(knee, outLeft, "left") > 10, "left foot moving to the athlete's left is positive");
assert(shankLateralDeg(knee, outLeft, "right") < -10, "right foot moving medially is negative");

const hipL = { x: 640, y: 500, z: 0, visibility: 1 };
const hipR = { x: 440, y: 500, z: 0, visibility: 1 };
assert(Math.abs(pelvisFrameShankDeg(knee, down, hipL, hipR, "right")) < 0.5, "level pelvis + vertical shank is ~0 in the pelvis frame");

const captured = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  phases: trialPhases(30),
  noise: quiet,
  seed: 7,
});
assert(captured.states.includes("READY"), `should reach READY, got ${captured.states.join("→")}`);
assert(captured.final.state === "RESULT", `stable hold should capture, got ${captured.final.state} ${captured.final.instruction}`);
assert(captured.final.result?.accepted === true, "result should be accepted");
const rom = captured.final.result?.measuredRom ?? 0;
assert(rom > 20 && rom < 40, `accepted ROM should be near 30°, got ${rom.toFixed(2)}`);
assert((captured.final.quality ?? 0) > 0, "an accepted trial should not have a zero quality score");
assert(captured.final.result?.rawMaximum != null, "raw max is stored for comparison and is never the capture rule");

const medial = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  phases: trialPhases(-18),
  noise: quiet,
  seed: 3,
});
assert(medial.final.state === "READY" || medial.final.state === "ARMED", `medial pull must not start a measurement, got ${medial.final.state}`);
assert((medial.final.primary.filtered ?? 0) < 0, "medial angle should be negative");

const hiked = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 11,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: (u) => ({ irDeg: 28 * u, hipHikeDeg: 18 * u }) },
    { durationS: 1.6, body: () => ({ irDeg: 28, hipHikeDeg: 18 }) },
  ],
});
assert(hiked.final.state === "INVALID", `hip hike should reject, got ${hiked.final.state}`);
assert(hiked.final.result?.failedConstraints.includes("pelvis-tilt") === true, `expected pelvis-tilt, got ${hiked.final.result?.failedConstraints.join(",")}`);
assert(hiked.final.quality === 0, "hard failure must zero quality");

const shifted = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 13,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: (u) => ({ irDeg: 28 * u, pelvisShiftM: 0.12 * u }) },
    { durationS: 1.8, body: () => ({ irDeg: 28, pelvisShiftM: 0.12 }) },
  ],
});
assert(shifted.final.state === "RESULT", `a whole-body scoot is a soft warning, not a hard fail, got ${shifted.final.state}`);
assert(shifted.final.result?.accepted === true, "scoot should still capture");
const scoot = shifted.final.checks.find((c) => c.id === "pelvis-translation");
assert(scoot != null && scoot.category === "soft", "pelvis translation is a soft check");
if (!scoot) throw new Error("missing pelvis translation check");
assert((scoot.value ?? 0) > 0.12, `a 12 cm scoot should read well above still, got ${scoot.value}`);

const base = captured.final.baseline;
assert(base != null, "calibration should store a baseline");
if (!base) throw new Error("missing baseline");
assert(sharedPelvisShift(base.leftHip, base.rightHip, base).ratio < 0.001, "hips on their baseline are zero translation");
const slide = sharedPelvisShift({ ...base.leftHip, x: base.leftHip.x + base.hipWidthPx * 0.4 }, base.rightHip, base);
assert(slide.ratio < 0.001, "one hip sliding must not count as pelvis translation");
const apart = sharedPelvisShift(
  { ...base.leftHip, x: base.leftHip.x - base.hipWidthPx * 0.15 },
  { ...base.rightHip, x: base.rightHip.x + base.hipWidthPx * 0.15 },
  base
);
assert(apart.ratio < 0.001, "hips moving apart (rotation or depth) must not count as translation");
const both = sharedPelvisShift(
  { ...base.leftHip, x: base.leftHip.x + base.hipWidthPx * 0.2 },
  { ...base.rightHip, x: base.rightHip.x + base.hipWidthPx * 0.2 },
  base
);
assert(Math.abs(both.ratio - 0.2) < 0.01, `a shared scoot of 20% of hip width should read 0.2, got ${both.ratio.toFixed(3)}`);

const still = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 5,
  keep: true,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: () => ({ irDeg: 0 }) },
  ],
});
const readyStill = still.snapshots.filter((s) => (s.state === "READY" || s.state === "ARMED") && s.metrics.pelvisTranslation != null);
assert(readyStill.length > 5, "still trial should finish calibration");
const stillMax = Math.max(...readyStill.map((s) => s.metrics.pelvisTranslation ?? 0));
assert(stillMax < 0.03, `standing still should stay near zero, max ${stillMax.toFixed(3)}`);
assert(readyStill.every((s) => s.checks.find((c) => c.id === "pelvis-translation")?.status === "pass"), "still pelvis translation should pass");

const moved = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 5,
  t0: still.t,
  keep: true,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: (u) => ({ pelvisShiftM: 0.08 * u }) },
    { durationS: 0.6, body: () => ({ pelvisShiftM: 0.08 }) },
  ],
});
const shiftedFrames = moved.snapshots.filter((s) => (s.state === "READY" || s.state === "ARMED") && (s.metrics.pelvisTranslation ?? 0) > 0.1);
assert(shiftedFrames.length > 0, "a sideways pelvis shift should raise the metric");
const shiftedSession = newSession(config, "right");
const heldShift = run(shiftedSession, {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 9,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: (u) => ({ pelvisShiftM: 0.08 * u }) },
    { durationS: 0.5, body: () => ({ pelvisShiftM: 0.08 }) },
  ],
});
const beforeStatus = heldShift.final.checks.find((c) => c.id === "pelvis-translation")?.status;
assert(beforeStatus === "fail", `default fail should catch an 8 cm shift, got ${beforeStatus} value=${heldShift.final.metrics.pelvisTranslation}`);
shiftedSession.setConfig({ ...config, pelvisTranslationWarn: 0.5, pelvisTranslationFail: 0.9 });
const loose = run(shiftedSession, {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 9,
  t0: heldShift.t,
  phases: [{ durationS: 0.2, body: () => ({ pelvisShiftM: 0.08 }) }],
});
const looseStatus = loose.final.checks.find((c) => c.id === "pelvis-translation")?.status;
assert(looseStatus === "pass", `raising the fail line above the live value should pass immediately, got ${looseStatus}`);
shiftedSession.setConfig({ ...config, pelvisTranslationWarn: 0.05, pelvisTranslationFail: 0.1 });
const tight = run(shiftedSession, {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 9,
  t0: heldShift.t + 1000,
  phases: [{ durationS: 0.2, body: () => ({ pelvisShiftM: 0.08 }) }],
});
assert(tight.final.checks.find((c) => c.id === "pelvis-translation")?.status === "fail", "lowering the fail line should fail immediately");

function statusFor(patch: Partial<QFConfig>, metric: Partial<ReturnType<typeof emptyMetrics>>, id: string): string | undefined {
  const metrics = { ...emptyMetrics(), ...metric };
  return buildMeasurementChecks(metrics, { ...config, ...patch }, false).find((c) => c.id === id)?.status;
}
assert(statusFor({ pelvisRotationWarnDeg: 5, pelvisRotationFailDeg: 20 }, { pelvisRotationDeg: 8 }, "pelvis-rotation") === "warn", "8° rotation warns at 5°");
assert(statusFor({ pelvisRotationWarnDeg: 10, pelvisRotationFailDeg: 20 }, { pelvisRotationDeg: 8 }, "pelvis-rotation") === "pass", "8° rotation passes when warning moves to 10°");
assert(statusFor({ pelvisRotationWarnDeg: 5, pelvisRotationFailDeg: 7 }, { pelvisRotationDeg: 8 }, "pelvis-rotation") === "fail", "8° rotation fails when fail is 7°");
assert(statusFor({ torsoLeanWarnDeg: 5, torsoLeanFailDeg: 20 }, { torsoLeanDeltaDeg: 8 }, "torso-lean") === "warn", "torso lean uses the live warning");
assert(statusFor({ torsoLeanWarnDeg: 10, torsoLeanFailDeg: 20 }, { torsoLeanDeltaDeg: 8 }, "torso-lean") === "pass", "torso lean warning change clears the warning");
assert(statusFor({ torsoRotationWarnDeg: 5, torsoRotationFailDeg: 12 }, { torsoRotationDeg: 9 }, "torso-rotation") === "warn", "torso rotation uses the live warning");
assert(statusFor({ torsoRotationWarnDeg: 12, torsoRotationFailDeg: 20 }, { torsoRotationDeg: 9 }, "torso-rotation") === "pass", "torso rotation warning change clears the warning");
assert(statusFor({ femurPositionWarn: 0.05, femurPositionFail: 0.2 }, { femurDeviation: 0.08 }, "femur-position") === "warn", "femur tolerance uses the live warning");
assert(statusFor({ femurPositionWarn: 0.12, femurPositionFail: 0.2 }, { femurDeviation: 0.08 }, "femur-position") === "pass", "femur warning change clears the warning");
assert(statusFor({ pelvisTranslationWarn: 0.05, pelvisTranslationFail: 0.2 }, { pelvisTranslation: 0.08 }, "pelvis-translation") === "warn", "translation warning is a fraction of hip width");
assert(statusFor({ pelvisTranslationWarn: 0.1, pelvisTranslationFail: 0.2 }, { pelvisTranslation: 0.08 }, "pelvis-translation") === "pass", "translation warning change clears the warning");
assert(configProblems({ ...config, pelvisTranslationWarn: 0.2, pelvisTranslationFail: 0.1 }).some((p) => p.startsWith("Pelvis translation")), "warning above fail is rejected");
assert(configProblems(config).length === 0, "default thresholds are ordered");

const spike = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 17,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 0 }) },
    { durationS: 0.8, body: (u) => ({ irDeg: 30 * u }) },
    { durationS: 2.0, body: () => ({ irDeg: 30 }), spike: (_u, frame) => frame === 8 },
  ],
});
assert(spike.final.state === "RESULT", `one bad frame must not kill the hold, got ${spike.final.state}`);
const spiked = spike.final.result?.measuredRom ?? 0;
assert(Math.abs(spiked - rom) < 4, `outlier should not become the ROM (got ${spiked.toFixed(2)} vs ${rom.toFixed(2)})`);

const repeats: number[] = [];
for (let i = 0; i < 5; i += 1) {
  const trial = run(newSession(config, "right"), {
    side: "right",
    camera: CAMERAS["A ideal"],
    phases: trialPhases(30),
    noise: quiet,
    seed: 20 + i,
  });
  const value = trial.final.result?.measuredRom;
  if (trial.final.state !== "RESULT" || value == null) throw new Error(`repeat ${i + 1} failed: ${trial.final.state}`);
  repeats.push(value);
}
const stats = describe(repeats);
assert(stats.sd != null && stats.sd < 1.5, `same motion 5× should be tight, SD ${stats.sd?.toFixed(3)} values=${repeats.map((v) => v.toFixed(2)).join(",")}`);
assert(stats.range != null && stats.range < 4, `range ${stats.range?.toFixed(2)} should be small`);

function measure(camera: keyof typeof CAMERAS, method: "pelvis2d" | "absolute2d" | "relative2d"): number {
  const trial = run(newSession({ ...config, primaryMethod: method }, "right"), {
    side: "right",
    camera: CAMERAS[camera],
    phases: trialPhases(30),
    noise: quiet,
    seed: 40,
  });
  if (trial.final.state !== "RESULT" || trial.final.result?.measuredRom == null) {
    throw new Error(`${method} @ ${camera} did not capture: ${trial.final.state} ${trial.final.instruction}`);
  }
  return trial.final.result.measuredRom;
}

const pelvisIdeal = measure("A ideal", "pelvis2d");
const pelvisRoll = measure("A + 6° roll", "pelvis2d");
const absIdeal = measure("A ideal", "absolute2d");
const absRoll = measure("A + 6° roll", "absolute2d");
assert(
  Math.abs(pelvisRoll - pelvisIdeal) < Math.abs(absRoll - absIdeal) - 1,
  `pelvis frame should cancel camera roll better than image vertical (pelvis Δ ${Math.abs(pelvisRoll - pelvisIdeal).toFixed(2)} vs abs Δ ${Math.abs(absRoll - absIdeal).toFixed(2)})`
);

const rng = mulberry32(1);
const obs = project(bodyPoints("right", { ...BODY_NEUTRAL, irDeg: 0 }), CAMERAS["A ideal"], rng, quiet);
const setup = buildSetupChecks(extractMetrics(obs, "right", null), emptyTracking(), config);
const blocking = setup.filter((c) => c.blocking && c.status === "fail").map((c) => c.id);
assert(!blocking.includes("shank-hang"), "a slightly off hang must not block start");
assert(!blocking.includes("facing"), "noisy/imperfect facing must not block start");
assert(!blocking.includes("torso-upright"), "torso is advisory");
assert(!blocking.includes("camera-roll"), "camera roll is advisory");

const live = extractMetrics(obs, "right", captured.final.baseline);
const measurement = buildMeasurementChecks(live, config, captured.final.baseline?.worldFlexionTrusted ?? false);
assert(hardFailures(measurement).every((c) => ["pelvis-tilt", "knee-lateral", "shank-short"].includes(c.id) || c.status !== "fail"), "only chosen hard ids can reject");
const quality = scoreQuality(measurement, emptyTracking());
assert(quality.hardFailed === false || quality.score === 0, "a hard failure cannot be averaged into a passing score");

const angles = computeAngles(obs.image, obs.world, "right", captured.final.baseline?.angleRef ?? null);
assert(angles.pelvis2d != null, "pelvis2d should exist after calibration");

const resting = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 8,
  keep: true,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 9 }) },
    { durationS: 3, body: () => ({ irDeg: 9 }) },
  ],
});
assert(resting.final.result == null, "a still starting position must not produce a ROM result");
assert(resting.final.movement.started === false, "standing still must not count as movement");
assert(resting.final.state === "ARMED", `a held start should arm, got ${resting.final.state} ${resting.final.instruction}`);
const armedStill = resting.snapshots.filter((s) => s.state === "ARMED");
assert(armedStill.length > 20, "the start should stay armed while the athlete is still");
const stillExcursion = Math.max(...armedStill.map((s) => Math.abs(s.movement.excursionDeg ?? 0)));
assert(stillExcursion < 3, `still excursion should stay near zero, max ${stillExcursion.toFixed(2)}`);
assert(resting.snapshots.every((s) => s.state !== "RESULT"), "no frame of a still start may be a result");

const performed = run(newSession(config, "right"), {
  side: "right",
  camera: CAMERAS["A ideal"],
  noise: quiet,
  seed: 8,
  keep: true,
  phases: [
    { durationS: 2.2, body: () => ({ irDeg: 9 }) },
    { durationS: 1.2, body: () => ({ irDeg: 9 }) },
    { durationS: 1, body: (u) => ({ irDeg: 9 + 26 * u }) },
    { durationS: 2, body: () => ({ irDeg: 35 }) },
  ],
});
assert(performed.snapshots.filter((s) => !s.movement.started).every((s) => s.state !== "RESULT" && s.result == null), "frames before movement cannot be a result");
assert(performed.final.state === "RESULT", `moving from the start to end range should capture, got ${performed.final.state} ${performed.final.instruction}`);
const performedRom = performed.final.result?.measuredRom ?? 0;
assert(performedRom > 18, `end-range ROM should follow the movement, got ${performedRom.toFixed(2)} (baseline ${performed.final.movement.baselineDeg})`);
assert(performed.final.movement.started === true, "a captured trial must have detected movement");
const startReading = performed.final.movement.baselineDeg ?? 0;
assert(Math.abs(performedRom - startReading) > 10, `the result must not be the starting angle (result ${performedRom.toFixed(2)}, baseline ${startReading.toFixed(2)})`);

assert(recordingIntent("off", "ARMED", 0, 1500) === "start-preroll", "armed start should pre-roll");
assert(recordingIntent("preroll", "MEASURING", 400, 1500) === "promote", "movement should keep the pre-roll");
assert(recordingIntent("keep", "RESULT", 0, 1500) === "arm-post", "a result should finish after the post-roll");

console.log(
  `qf math checks passed  rom=${rom.toFixed(2)}  repeats=${repeats.map((v) => v.toFixed(1)).join(",")}  SD=${stats.sd?.toFixed(2)}  pelvisRollΔ=${Math.abs(pelvisRoll - pelvisIdeal).toFixed(2)}  absRollΔ=${Math.abs(absRoll - absIdeal).toFixed(2)}`
);

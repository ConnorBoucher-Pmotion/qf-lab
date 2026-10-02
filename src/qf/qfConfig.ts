import { ANGLE_METHODS, ANGLE_METHOD_INFO, type AngleMethod } from "./qfMeasurementEngine";

/**
 * Every threshold the QF lab uses.
 *
 * DEVELOPMENT PARAMETERS. Starting values from the reference video, frontal
 * geometry, and synthetic tests. Not validated against a goniometer or a
 * clinical cutoff. Tune them in the debug panel and export the config with
 * your trial data.
 *
 * Lengths are body-normalized: hip widths (pelvis) or shank lengths (knee,
 * ankle). None of them are pixels, so camera distance does not change them.
 */

export type AngleFilterKind = "oneEuro" | "ema" | "none";

export type QFConfig = {
  primaryMethod: AngleMethod;
  /** How far the angle must move past the starting baseline before a trial can begin. */
  startMovementDeg: number;
  /** Still time in the starting position after calibration, before the trial is armed. */
  readyHoldMs: number;
  /** Peak-to-peak allowed while that starting position is recorded. */
  readyHoldToleranceDeg: number;
  /** The start threshold must stay exceeded this long before movement counts. */
  movementConfirmMs: number;
  /** A result is refused until the end position is at least this far from the starting baseline. */
  minimumMovementExcursionDeg: number;
  /** Outward speed used to ignore a reversal while movement is being confirmed. Shown in debug. */
  movementVelocityDegPerSec: number;

  holdMs: number;
  /** Max peak-to-peak of the filtered angle inside the hold. */
  holdToleranceDeg: number;
  /** Max drift speed inside the hold. Rejects a slow pull being mistaken for a hold. */
  maxHoldVelocityDegPerSec: number;
  /** The hold must sit within this of the furthest angle reached in the attempt. */
  endRangeToleranceDeg: number;
  validateMs: number;
  /** A gap in valid frames longer than this restarts the hold. */
  maxHoldGapMs: number;
  minHoldFrames: number;

  calibrationMs: number;
  minCalibrationFrames: number;
  maxCalibrationAngleSdDeg: number;
  /** Mid-hip scatter during calibration, hip widths. */
  maxCalibrationPelvisJitter: number;
  /** A setup check may fail this long during calibration without restarting it. */
  setupGraceMs: number;

  landmarkMinCutoffHz: number;
  landmarkBeta: number;
  outlierJumpHipWidths: number;
  reacquireFrames: number;
  angleFilter: AngleFilterKind;
  angleMinCutoffHz: number;
  angleBeta: number;
  angleEmaAlpha: number;
  /** Floor for the angle outlier gate. The gate also widens with the recent spread (3 × MAD). */
  angleOutlierDeg: number;
  angleOutlierWindow: number;

  kneeConfidence: number;
  ankleConfidence: number;
  hipConfidence: number;
  shoulderConfidence: number;
  /** A critical landmark may be weak this long with no effect. */
  confidenceGraceMs: number;
  /** Weak this long during a trial: "Measurement unavailable — reposition camera." */
  trackingLostMs: number;
  /** No person this long before the baseline is dropped. */
  searchGraceMs: number;

  setupShankWarnDeg: number;
  setupShankFailDeg: number;
  setupTorsoWarnDeg: number;
  setupTorsoFailDeg: number;
  setupFacingWarnDeg: number;
  setupFacingFailDeg: number;
  setupRollWarnDeg: number;
  setupRollFailDeg: number;
  setupShankFracWarn: number;
  setupShankFracFail: number;
  setupEdgeWarn: number;

  pelvisTiltWarnDeg: number;
  pelvisTiltFailDeg: number;
  pelvisTranslationWarn: number;
  pelvisTranslationFail: number;
  pelvisRotationWarnDeg: number;
  pelvisRotationFailDeg: number;
  torsoLeanWarnDeg: number;
  torsoLeanFailDeg: number;
  torsoRotationWarnDeg: number;
  torsoRotationFailDeg: number;
  kneeLateralWarn: number;
  kneeLateralFail: number;
  femurPositionWarn: number;
  femurPositionFail: number;
  shankShortWarn: number;
  shankShortFail: number;
  shankLongWarn: number;
  shankLongFail: number;
  movementPlaneWarn: number;
  movementPlaneFail: number;
  kneeFlexionWarnDeg: number;
  kneeFlexionFailDeg: number;
  cameraDistanceWarn: number;
  cameraDistanceFail: number;
  otherLegWarn: number;
  otherLegFail: number;

  /** A hard check must fail this long during a trial before the trial is rejected. */
  hardFailPersistMs: number;
  /** Pelvis this far from the baseline in READY means the start position is gone. */
  baselineLostHipWidths: number;
  /** Pelvis translation is the median of this many milliseconds, so one bad frame cannot fail it. */
  pelvisTranslationWindowMs: number;
  /** A hard check failing this long in READY triggers a fresh calibration. */
  readyRecalibrateMs: number;
  /** Measurement check ids that reject a trial. Everything else only lowers confidence. */
  hardConstraints: string[];
};

export const DEFAULT_HARD_CONSTRAINTS = ["pelvis-tilt", "knee-lateral", "shank-short"];

export const PROVISIONAL_QF_CONFIG: QFConfig = {
  // Pelvis frame: hang-relative shank from the hip-line perpendicular.
  // Camera roll and a constant hip hike cancel each frame, which is more
  // repeatable than measuring from image vertical when the phone is not level.
  primaryMethod: "pelvis2d",
  startMovementDeg: 5,
  readyHoldMs: 700,
  readyHoldToleranceDeg: 3,
  movementConfirmMs: 200,
  minimumMovementExcursionDeg: 5,
  movementVelocityDegPerSec: 8,

  holdMs: 800,
  holdToleranceDeg: 2.5,
  maxHoldVelocityDegPerSec: 4,
  endRangeToleranceDeg: 6,
  validateMs: 250,
  maxHoldGapMs: 250,
  minHoldFrames: 8,

  calibrationMs: 1200,
  minCalibrationFrames: 15,
  maxCalibrationAngleSdDeg: 2.5,
  maxCalibrationPelvisJitter: 0.12,
  setupGraceMs: 500,

  landmarkMinCutoffHz: 1.2,
  landmarkBeta: 1.5,
  outlierJumpHipWidths: 0.35,
  reacquireFrames: 3,
  angleFilter: "oneEuro",
  angleMinCutoffHz: 1,
  angleBeta: 0.05,
  angleEmaAlpha: 0.3,
  angleOutlierDeg: 5,
  angleOutlierWindow: 7,

  kneeConfidence: 0.15,
  ankleConfidence: 0.35,
  hipConfidence: 0.4,
  shoulderConfidence: 0.3,
  confidenceGraceMs: 150,
  trackingLostMs: 1500,
  searchGraceMs: 700,

  setupShankWarnDeg: 18,
  setupShankFailDeg: 40,
  setupTorsoWarnDeg: 18,
  setupTorsoFailDeg: 35,
  setupFacingWarnDeg: 30,
  setupFacingFailDeg: 55,
  setupRollWarnDeg: 12,
  setupRollFailDeg: 25,
  setupShankFracWarn: 0.09,
  setupShankFracFail: 0.05,
  setupEdgeWarn: 0.015,

  pelvisTiltWarnDeg: 6,
  pelvisTiltFailDeg: 12,
  pelvisTranslationWarn: 0.08,
  pelvisTranslationFail: 0.16,
  pelvisRotationWarnDeg: 12,
  pelvisRotationFailDeg: 22,
  torsoLeanWarnDeg: 12,
  torsoLeanFailDeg: 22,
  torsoRotationWarnDeg: 14,
  torsoRotationFailDeg: 28,
  kneeLateralWarn: 0.12,
  kneeLateralFail: 0.22,
  femurPositionWarn: 0.18,
  femurPositionFail: 0.35,
  shankShortWarn: 0.85,
  shankShortFail: 0.7,
  shankLongWarn: 1.15,
  shankLongFail: 1.3,
  movementPlaneWarn: 0.25,
  movementPlaneFail: 0.45,
  kneeFlexionWarnDeg: 15,
  kneeFlexionFailDeg: 30,
  cameraDistanceWarn: 0.1,
  cameraDistanceFail: 0.2,
  otherLegWarn: 0.25,
  otherLegFail: 0.5,

  hardFailPersistMs: 400,
  baselineLostHipWidths: 0.8,
  pelvisTranslationWindowMs: 300,
  readyRecalibrateMs: 2500,
  hardConstraints: [...DEFAULT_HARD_CONSTRAINTS],
};

type NumericKey = { [K in keyof QFConfig]: QFConfig[K] extends number ? K : never }[keyof QFConfig];

export type ConfigGroup =
  | "Measurement"
  | "Stable hold"
  | "Calibration"
  | "Smoothing & outliers"
  | "Tracking confidence"
  | "Setup tolerances"
  | "Pelvis"
  | "Torso"
  | "Knee & femur"
  | "Shank & plane"
  | "Other";

export type RangeField = {
  kind: "range";
  key: NumericKey;
  label: string;
  group: ConfigGroup;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type SelectField = {
  kind: "select";
  key: "primaryMethod" | "angleFilter";
  label: string;
  group: ConfigGroup;
  options: Array<{ value: string; label: string }>;
};

export type ConfigField = RangeField | SelectField;

const r = (key: NumericKey, label: string, group: ConfigGroup, min: number, max: number, step: number, unit: string): RangeField => ({
  kind: "range",
  key,
  label,
  group,
  min,
  max,
  step,
  unit,
});

export const QF_CONFIG_GROUPS: ConfigGroup[] = [
  "Measurement",
  "Stable hold",
  "Calibration",
  "Smoothing & outliers",
  "Tracking confidence",
  "Setup tolerances",
  "Pelvis",
  "Torso",
  "Knee & femur",
  "Shank & plane",
  "Other",
];

export const QF_CONFIG_FIELDS: ConfigField[] = [
  {
    kind: "select",
    key: "primaryMethod",
    label: "Primary angle method",
    group: "Measurement",
    options: ANGLE_METHODS.map((method) => ({ value: method, label: ANGLE_METHOD_INFO[method].label })),
  },
  r("startMovementDeg", "Excursion from start to begin movement", "Measurement", 2, 15, 0.5, "deg"),
  r("readyHoldMs", "Hold the start before arming", "Measurement", 300, 2000, 50, "ms"),
  r("readyHoldToleranceDeg", "Start-hold stability", "Measurement", 0.5, 8, 0.5, "deg"),
  r("movementConfirmMs", "Movement must last", "Measurement", 50, 800, 50, "ms"),
  r("minimumMovementExcursionDeg", "Minimum excursion for a result", "Measurement", 2, 15, 0.5, "deg"),
  r("movementVelocityDegPerSec", "Outward speed used during confirmation", "Measurement", 2, 40, 1, "deg/s"),

  r("holdMs", "Stable hold duration", "Stable hold", 300, 3000, 50, "ms"),
  r("holdToleranceDeg", "Stable angle tolerance (peak-to-peak)", "Stable hold", 0.5, 6, 0.1, "deg"),
  r("maxHoldVelocityDegPerSec", "Max drift during hold", "Stable hold", 0.5, 15, 0.5, "deg/s"),
  r("endRangeToleranceDeg", "Hold within this of the peak", "Stable hold", 1, 20, 0.5, "deg"),
  r("validateMs", "Validation dwell", "Stable hold", 0, 1500, 50, "ms"),
  r("maxHoldGapMs", "Max gap inside a hold", "Stable hold", 50, 600, 10, "ms"),
  r("minHoldFrames", "Min frames in a hold", "Stable hold", 3, 60, 1, "frames"),

  r("calibrationMs", "Calibration duration", "Calibration", 500, 3000, 50, "ms"),
  r("minCalibrationFrames", "Min calibration frames", "Calibration", 5, 90, 1, "frames"),
  r("maxCalibrationAngleSdDeg", "Max shank SD while calibrating", "Calibration", 0.3, 5, 0.1, "deg"),
  r("maxCalibrationPelvisJitter", "Max pelvis jitter while calibrating", "Calibration", 0.01, 0.2, 0.005, "hip widths"),
  r("setupGraceMs", "Setup miss allowed while calibrating", "Calibration", 0, 1500, 50, "ms"),

  {
    kind: "select",
    key: "angleFilter",
    label: "Angle smoothing",
    group: "Smoothing & outliers",
    options: [
      { value: "oneEuro", label: "One Euro" },
      { value: "ema", label: "Exponential moving average" },
      { value: "none", label: "None (outlier gate only)" },
    ],
  },
  r("landmarkMinCutoffHz", "Landmark smoothing (min cutoff; lower = smoother)", "Smoothing & outliers", 0.1, 8, 0.1, "Hz"),
  r("landmarkBeta", "Landmark speed response (beta)", "Smoothing & outliers", 0, 10, 0.1, "per hip width/s"),
  r("angleMinCutoffHz", "Angle smoothing (min cutoff)", "Smoothing & outliers", 0.1, 8, 0.1, "Hz"),
  r("angleBeta", "Angle speed response (beta)", "Smoothing & outliers", 0, 0.5, 0.005, "per deg/s"),
  r("angleEmaAlpha", "Angle EMA alpha", "Smoothing & outliers", 0.02, 1, 0.01, ""),
  r("angleOutlierDeg", "Angle outlier floor", "Smoothing & outliers", 1, 20, 0.5, "deg"),
  r("angleOutlierWindow", "Angle outlier window", "Smoothing & outliers", 3, 21, 1, "frames"),
  r("outlierJumpHipWidths", "Landmark jump gate", "Smoothing & outliers", 0.05, 1.5, 0.01, "hip widths/frame"),
  r("reacquireFrames", "Accept a sustained jump after", "Smoothing & outliers", 1, 10, 1, "frames"),

  r("kneeConfidence", "Tested knee confidence", "Tracking confidence", 0.02, 0.9, 0.01, ""),
  r("ankleConfidence", "Tested ankle confidence", "Tracking confidence", 0.05, 0.95, 0.01, ""),
  r("hipConfidence", "Hip confidence", "Tracking confidence", 0.05, 0.95, 0.01, ""),
  r("shoulderConfidence", "Shoulder confidence (non-critical)", "Tracking confidence", 0.05, 0.95, 0.01, ""),
  r("confidenceGraceMs", "Weak tracking ignored for", "Tracking confidence", 0, 800, 10, "ms"),
  r("trackingLostMs", "Weak tracking rejects after", "Tracking confidence", 300, 5000, 50, "ms"),
  r("searchGraceMs", "No person before reset", "Tracking confidence", 100, 3000, 50, "ms"),

  r("setupShankWarnDeg", "Shank hang: warn", "Setup tolerances", 2, 40, 0.5, "deg"),
  r("setupShankFailDeg", "Shank hang: fail", "Setup tolerances", 5, 60, 0.5, "deg"),
  r("setupTorsoWarnDeg", "Torso upright: warn (advisory)", "Setup tolerances", 2, 40, 0.5, "deg"),
  r("setupTorsoFailDeg", "Torso upright: limit (advisory)", "Setup tolerances", 5, 60, 0.5, "deg"),
  r("setupFacingWarnDeg", "Camera orientation (facing): warn", "Setup tolerances", 5, 60, 1, "deg"),
  r("setupFacingFailDeg", "Camera orientation (facing): fail", "Setup tolerances", 10, 80, 1, "deg"),
  r("setupRollWarnDeg", "Camera roll / hip level: warn (advisory)", "Setup tolerances", 2, 30, 0.5, "deg"),
  r("setupRollFailDeg", "Camera roll / hip level: limit (advisory)", "Setup tolerances", 5, 45, 0.5, "deg"),
  r("setupShankFracWarn", "Body size (shank / frame height): warn", "Setup tolerances", 0.03, 0.4, 0.005, ""),
  r("setupShankFracFail", "Body size (shank / frame height): fail", "Setup tolerances", 0.02, 0.3, 0.005, ""),
  r("setupEdgeWarn", "Frame edge margin: warn", "Setup tolerances", 0, 0.15, 0.005, "frame"),

  r("pelvisTiltWarnDeg", "Pelvis tilt: warn", "Pelvis", 1, 20, 0.5, "deg"),
  r("pelvisTiltFailDeg", "Pelvis tilt: fail", "Pelvis", 2, 30, 0.5, "deg"),
  r("pelvisTranslationWarn", "Pelvis translation: warn", "Pelvis", 0.02, 1, 0.01, "% of hip width"),
  r("pelvisTranslationFail", "Pelvis translation: fail", "Pelvis", 0.04, 1, 0.01, "% of hip width"),
  r("pelvisTranslationWindowMs", "Pelvis translation median window", "Pelvis", 0, 800, 50, "ms"),
  r("pelvisRotationWarnDeg", "Pelvis rotation: warn", "Pelvis", 1, 40, 0.5, "deg"),
  r("pelvisRotationFailDeg", "Pelvis rotation: fail", "Pelvis", 2, 60, 0.5, "deg"),
  r("baselineLostHipWidths", "Start position lost (READY)", "Pelvis", 0.2, 3, 0.05, "hip widths"),

  r("torsoLeanWarnDeg", "Torso lean: warn", "Torso", 1, 40, 0.5, "deg"),
  r("torsoLeanFailDeg", "Torso lean: fail", "Torso", 2, 60, 0.5, "deg"),
  r("torsoRotationWarnDeg", "Torso rotation: warn", "Torso", 1, 45, 0.5, "deg"),
  r("torsoRotationFailDeg", "Torso rotation: fail", "Torso", 2, 60, 0.5, "deg"),

  r("kneeLateralWarn", "Knee lateral drift: warn", "Knee & femur", 0.01, 0.5, 0.005, "shank lengths"),
  r("kneeLateralFail", "Knee lateral drift: fail", "Knee & femur", 0.02, 0.8, 0.005, "shank lengths"),
  r("femurPositionWarn", "Femur (knee) position: warn", "Knee & femur", 0.02, 0.8, 0.01, "shank lengths"),
  r("femurPositionFail", "Femur (knee) position: fail", "Knee & femur", 0.05, 1.2, 0.01, "shank lengths"),
  r("kneeFlexionWarnDeg", "Knee bend change (world): warn", "Knee & femur", 2, 60, 1, "deg"),
  r("kneeFlexionFailDeg", "Knee bend change (world): fail", "Knee & femur", 5, 90, 1, "deg"),

  r("shankShortWarn", "Shank foreshortening: warn below", "Shank & plane", 0.5, 1, 0.01, "× hang"),
  r("shankShortFail", "Shank foreshortening: fail below", "Shank & plane", 0.3, 1, 0.01, "× hang"),
  r("shankLongWarn", "Shank lengthening: warn above", "Shank & plane", 1, 2, 0.01, "× hang"),
  r("shankLongFail", "Shank lengthening: fail above", "Shank & plane", 1, 2.5, 0.01, "× hang"),
  r("movementPlaneWarn", "Movement plane (world depth): warn", "Shank & plane", 0.05, 1, 0.01, "shank lengths"),
  r("movementPlaneFail", "Movement plane (world depth): fail", "Shank & plane", 0.05, 1.5, 0.01, "shank lengths"),

  r("cameraDistanceWarn", "Camera distance change: warn", "Other", 0.02, 0.6, 0.01, "fraction"),
  r("cameraDistanceFail", "Camera distance change: fail", "Other", 0.05, 1, 0.01, "fraction"),
  r("otherLegWarn", "Other leg drift: warn", "Other", 0.05, 1.5, 0.01, "shank lengths"),
  r("otherLegFail", "Other leg drift: fail", "Other", 0.1, 2, 0.01, "shank lengths"),
  r("hardFailPersistMs", "Hard failure must last", "Other", 0, 1500, 10, "ms"),
  r("readyRecalibrateMs", "Recalibrate if a hard check fails in READY for", "Other", 500, 8000, 100, "ms"),
];

/** Fills gaps and clamps ranges so an imported or stored config can't break the session. */
export function normalizeConfig(input: unknown): QFConfig {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: QFConfig = { ...PROVISIONAL_QF_CONFIG, hardConstraints: [...PROVISIONAL_QF_CONFIG.hardConstraints] };
  for (const field of QF_CONFIG_FIELDS) {
    const value = source[field.key];
    if (field.kind === "range") {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[field.key] = Math.max(field.min, Math.min(field.max, value));
      }
    } else if (typeof value === "string" && field.options.some((option) => option.value === value)) {
      (out as Record<string, unknown>)[field.key] = value;
    }
  }
  if (Array.isArray(source.hardConstraints)) {
    out.hardConstraints = source.hardConstraints.filter((id): id is string => typeof id === "string");
  }
  return out;
}

/** Warning must trip before fail. For "below this" checks (shank shortening), the warning number is the higher one. */
const THRESHOLD_PAIRS: Array<{ warn: NumericKey; fail: NumericKey; label: string; warnIsLower: boolean }> = [
  { warn: "pelvisTiltWarnDeg", fail: "pelvisTiltFailDeg", label: "Pelvis tilt", warnIsLower: true },
  { warn: "pelvisTranslationWarn", fail: "pelvisTranslationFail", label: "Pelvis translation", warnIsLower: true },
  { warn: "pelvisRotationWarnDeg", fail: "pelvisRotationFailDeg", label: "Pelvis rotation", warnIsLower: true },
  { warn: "torsoLeanWarnDeg", fail: "torsoLeanFailDeg", label: "Torso lean", warnIsLower: true },
  { warn: "torsoRotationWarnDeg", fail: "torsoRotationFailDeg", label: "Torso rotation", warnIsLower: true },
  { warn: "kneeLateralWarn", fail: "kneeLateralFail", label: "Knee lateral drift", warnIsLower: true },
  { warn: "femurPositionWarn", fail: "femurPositionFail", label: "Femur position", warnIsLower: true },
  { warn: "shankLongWarn", fail: "shankLongFail", label: "Shank lengthening", warnIsLower: true },
  { warn: "shankShortWarn", fail: "shankShortFail", label: "Shank foreshortening", warnIsLower: false },
  { warn: "movementPlaneWarn", fail: "movementPlaneFail", label: "Movement plane", warnIsLower: true },
  { warn: "kneeFlexionWarnDeg", fail: "kneeFlexionFailDeg", label: "Knee bend", warnIsLower: true },
  { warn: "cameraDistanceWarn", fail: "cameraDistanceFail", label: "Camera distance", warnIsLower: true },
  { warn: "otherLegWarn", fail: "otherLegFail", label: "Other leg", warnIsLower: true },
  { warn: "setupShankWarnDeg", fail: "setupShankFailDeg", label: "Shank hang", warnIsLower: true },
  { warn: "setupTorsoWarnDeg", fail: "setupTorsoFailDeg", label: "Torso upright", warnIsLower: true },
  { warn: "setupFacingWarnDeg", fail: "setupFacingFailDeg", label: "Facing the camera", warnIsLower: true },
  { warn: "setupRollWarnDeg", fail: "setupRollFailDeg", label: "Camera roll", warnIsLower: true },
];

export function configProblems(config: QFConfig): string[] {
  const problems: string[] = [];
  for (const pair of THRESHOLD_PAIRS) {
    const warn = config[pair.warn];
    const fail = config[pair.fail];
    const invalid = pair.warnIsLower ? warn >= fail : warn <= fail;
    if (invalid) problems.push(`${pair.label}: the warning line must come before the fail line.`);
  }
  return problems;
}

export function configExport(config: QFConfig): string {
  return JSON.stringify({ kind: "qf-lab-config", version: 3, savedAt: new Date().toISOString(), config }, null, 2);
}

export function configImport(text: string): QFConfig {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return normalizeConfig(parsed.config ?? parsed);
}

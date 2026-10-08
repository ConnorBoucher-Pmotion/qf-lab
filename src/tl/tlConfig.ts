import { ALGORITHM_INFO, ROTATION_ALGORITHMS, type RotationAlgorithm } from "./tlRotation";

export type AngleFilterKind = "oneEuro" | "ema" | "none";

/**
 * Development thresholds. Not clinically validated. Every field is read on the
 * frame it is used, so a slider change affects the next pose sample.
 */
export type TLConfig = {
  algorithm: RotationAlgorithm;
  angleFilter: AngleFilterKind;
  minMovementDeg: number;
  minVelocityDegPerSec: number;
  movementConfirmMs: number;
  /** Consecutive frames that must stay past the start threshold before ROTATING. */
  movementConfirmFrames: number;
  stableMs: number;
  calibrationMs: number;
  minCalibrationFrames: number;
  neutralYawToleranceDeg: number;
  maxCalibrationYawSdDeg: number;
  maxCalibrationPelvisJitter: number;
  holdMs: number;
  peakWindowDeg: number;
  peakVelocityDegPerSec: number;
  landmarkMinCutoffHz: number;
  landmarkBeta: number;
  outlierJumpHipWidths: number;
  reacquireFrames: number;
  angleMinCutoffHz: number;
  angleBeta: number;
  angleEmaAlpha: number;
  angleOutlierDeg: number;
  landmarkConfidence: number;
  confidenceGraceMs: number;
  trackingLostMs: number;
  trackingResetMs: number;
  pelvisRotationWarnDeg: number;
  pelvisRotationFailDeg: number;
  pelvisTranslationWarnPct: number;
  pelvisTranslationFailPct: number;
  lateralLeanWarnDeg: number;
  lateralLeanFailDeg: number;
  forwardLeanWarnDeg: number;
  forwardLeanFailDeg: number;
  kneeShiftWarnPct: number;
  kneeShiftFailPct: number;
  hipShiftWarnPct: number;
  hipShiftFailPct: number;
  setupLeanWarnDeg: number;
  setupLeanFailDeg: number;
  setupFacingWarnDeg: number;
  setupFacingFailDeg: number;
  /** When true, Face the camera is still shown but does not block calibration. */
  bypassFaceCamera: boolean;
  /** Internal. Stops the one-time 12°/25° → 10°/20° default migration from repeating. */
  facingThresholdVersion: number;
  hardFailPersistMs: number;
};

export const TL_CONFIG: TLConfig = {
  algorithm: "shoulderVsPelvis",
  angleFilter: "oneEuro",
  minMovementDeg: 8,
  minVelocityDegPerSec: 10,
  movementConfirmMs: 250,
  movementConfirmFrames: 4,
  stableMs: 600,
  calibrationMs: 1000,
  minCalibrationFrames: 12,
  neutralYawToleranceDeg: 8,
  maxCalibrationYawSdDeg: 1.8,
  maxCalibrationPelvisJitter: 0.08,
  holdMs: 1750,
  peakWindowDeg: 3,
  peakVelocityDegPerSec: 6,
  landmarkMinCutoffHz: 1.4,
  landmarkBeta: 0.8,
  outlierJumpHipWidths: 0.45,
  reacquireFrames: 3,
  angleMinCutoffHz: 1.2,
  angleBeta: 0.04,
  angleEmaAlpha: 0.35,
  angleOutlierDeg: 12,
  landmarkConfidence: 0.4,
  confidenceGraceMs: 150,
  trackingLostMs: 400,
  trackingResetMs: 2500,
  pelvisRotationWarnDeg: 3,
  pelvisRotationFailDeg: 5,
  pelvisTranslationWarnPct: 4,
  pelvisTranslationFailPct: 8,
  lateralLeanWarnDeg: 6,
  lateralLeanFailDeg: 10,
  forwardLeanWarnDeg: 8,
  forwardLeanFailDeg: 14,
  kneeShiftWarnPct: 6,
  kneeShiftFailPct: 12,
  hipShiftWarnPct: 5,
  hipShiftFailPct: 10,
  setupLeanWarnDeg: 8,
  setupLeanFailDeg: 16,
  setupFacingWarnDeg: 10,
  setupFacingFailDeg: 20,
  bypassFaceCamera: false,
  facingThresholdVersion: 2,
  hardFailPersistMs: 300,
};

export type ConfigGroup = "Measurement" | "Neutral calibration" | "Peak hold" | "Smoothing" | "Tracking" | "Pelvis" | "Trunk" | "Lower body" | "Setup";

export type RangeField = {
  kind: "range";
  key: { [K in keyof TLConfig]: TLConfig[K] extends number ? K : never }[keyof TLConfig];
  label: string;
  group: ConfigGroup;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type SelectField = {
  kind: "select";
  key: "algorithm" | "angleFilter";
  label: string;
  group: ConfigGroup;
  options: Array<{ value: string; label: string }>;
};

export type ToggleField = {
  kind: "toggle";
  key: "bypassFaceCamera";
  label: string;
  group: ConfigGroup;
};

export type ConfigField = RangeField | SelectField | ToggleField;

const r = (
  key: RangeField["key"],
  label: string,
  group: ConfigGroup,
  min: number,
  max: number,
  step: number,
  unit: string
): RangeField => ({ kind: "range", key, label, group, min, max, step, unit });

export const TL_CONFIG_GROUPS: ConfigGroup[] = [
  "Measurement",
  "Neutral calibration",
  "Peak hold",
  "Smoothing",
  "Tracking",
  "Pelvis",
  "Trunk",
  "Lower body",
  "Setup",
];

export const TL_CONFIG_FIELDS: ConfigField[] = [
  {
    kind: "select",
    key: "algorithm",
    label: "Rotation algorithm",
    group: "Measurement",
    options: ROTATION_ALGORITHMS.map((id) => ({ value: id, label: ALGORITHM_INFO[id].label })),
  },
  r("minMovementDeg", "Minimum rotation to begin", "Measurement", 2, 25, 0.5, "deg"),
  r("minVelocityDegPerSec", "Minimum speed to begin", "Measurement", 1, 40, 1, "deg/s"),
  r("movementConfirmMs", "Movement must last", "Measurement", 50, 800, 50, "ms"),
  r("movementConfirmFrames", "Movement must last", "Measurement", 1, 15, 1, "frames"),
  r("stableMs", "Neutral stillness before calibration", "Neutral calibration", 200, 2000, 50, "ms"),
  r("calibrationMs", "Neutral calibration duration", "Neutral calibration", 400, 3000, 50, "ms"),
  r("minCalibrationFrames", "Minimum calibration frames", "Neutral calibration", 4, 60, 1, "frames"),
  r("neutralYawToleranceDeg", "Neutral shoulders-vs-pelvis tolerance", "Neutral calibration", 2, 20, 0.5, "deg"),
  r("maxCalibrationYawSdDeg", "Max yaw jitter while calibrating", "Neutral calibration", 0.3, 6, 0.1, "deg"),
  r("maxCalibrationPelvisJitter", "Max pelvis jitter while calibrating", "Neutral calibration", 0.01, 0.2, 0.005, "hip widths"),
  r("holdMs", "Peak hold duration", "Peak hold", 500, 3000, 50, "ms"),
  r("peakWindowDeg", "Peak stability window", "Peak hold", 0.5, 10, 0.5, "deg"),
  r("peakVelocityDegPerSec", "Max speed during the hold", "Peak hold", 1, 20, 0.5, "deg/s"),
  {
    kind: "select",
    key: "angleFilter",
    label: "Angle smoothing",
    group: "Smoothing",
    options: [
      { value: "oneEuro", label: "One Euro" },
      { value: "ema", label: "Exponential moving average" },
      { value: "none", label: "None" },
    ],
  },
  r("landmarkMinCutoffHz", "Landmark smoothing cutoff", "Smoothing", 0.2, 8, 0.1, "Hz"),
  r("landmarkBeta", "Landmark speed response", "Smoothing", 0, 5, 0.1, ""),
  r("angleMinCutoffHz", "Angle smoothing cutoff", "Smoothing", 0.2, 8, 0.1, "Hz"),
  r("angleBeta", "Angle speed response", "Smoothing", 0, 0.4, 0.01, ""),
  r("angleEmaAlpha", "Angle EMA alpha", "Smoothing", 0.05, 1, 0.05, ""),
  r("angleOutlierDeg", "Angle outlier reject above", "Smoothing", 4, 40, 1, "deg"),
  r("outlierJumpHipWidths", "Landmark jump gate", "Smoothing", 0.1, 1.5, 0.05, "hip widths"),
  r("reacquireFrames", "Accept a sustained jump after", "Smoothing", 1, 8, 1, "frames"),
  r("landmarkConfidence", "Landmark confidence minimum", "Tracking", 0.05, 0.95, 0.01, ""),
  r("confidenceGraceMs", "Weak tracking ignored for", "Tracking", 0, 800, 50, "ms"),
  r("trackingLostMs", "Show tracking lost after", "Tracking", 100, 2000, 50, "ms"),
  r("trackingResetMs", "Reset the trial after tracking lost for", "Tracking", 500, 6000, 100, "ms"),
  r("pelvisRotationWarnDeg", "Pelvic rotation warning", "Pelvis", 1, 20, 0.5, "deg"),
  r("pelvisRotationFailDeg", "Pelvic rotation failure", "Pelvis", 2, 30, 0.5, "deg"),
  r("pelvisTranslationWarnPct", "Pelvic translation warning", "Pelvis", 1, 20, 0.5, "% of hip width"),
  r("pelvisTranslationFailPct", "Pelvic translation failure", "Pelvis", 2, 30, 0.5, "% of hip width"),
  r("lateralLeanWarnDeg", "Lateral trunk lean warning", "Trunk", 2, 25, 0.5, "deg"),
  r("lateralLeanFailDeg", "Lateral trunk lean failure", "Trunk", 4, 35, 0.5, "deg"),
  r("forwardLeanWarnDeg", "Forward / back lean warning", "Trunk", 2, 25, 0.5, "deg"),
  r("forwardLeanFailDeg", "Forward / back lean failure", "Trunk", 4, 40, 0.5, "deg"),
  r("kneeShiftWarnPct", "Knee movement warning", "Lower body", 2, 30, 0.5, "% of hip width"),
  r("kneeShiftFailPct", "Knee movement failure", "Lower body", 4, 40, 0.5, "% of hip width"),
  r("hipShiftWarnPct", "Individual hip movement warning", "Lower body", 2, 25, 0.5, "% of hip width"),
  r("hipShiftFailPct", "Individual hip movement failure", "Lower body", 4, 35, 0.5, "% of hip width"),
  r("setupLeanWarnDeg", "Upright warning", "Setup", 3, 25, 0.5, "deg"),
  r("setupLeanFailDeg", "Upright failure", "Setup", 6, 40, 0.5, "deg"),
  r("setupFacingWarnDeg", "Facing camera warning threshold", "Setup", 5, 40, 1, "deg"),
  r("setupFacingFailDeg", "Facing camera failure threshold", "Setup", 10, 60, 1, "deg"),
  { kind: "toggle", key: "bypassFaceCamera", label: "Bypass Face Camera constraint", group: "Setup" },
  r("hardFailPersistMs", "Compensation must last before it counts", "Setup", 0, 1000, 50, "ms"),
];

type NumericKey = RangeField["key"];

export function normalizeConfig(input: unknown): TLConfig {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: TLConfig = { ...TL_CONFIG };
  for (const field of TL_CONFIG_FIELDS) {
    const value = source[field.key];
    if (field.kind === "range") {
      if (typeof value === "number" && Number.isFinite(value)) out[field.key] = Math.max(field.min, Math.min(field.max, value));
    } else if (field.kind === "toggle") {
      if (typeof value === "boolean") out[field.key] = value;
    } else if (typeof value === "string" && field.options.some((option) => option.value === value)) {
      (out as Record<string, unknown>)[field.key] = value;
    }
  }
  if (source.facingThresholdVersion !== 2 && out.setupFacingWarnDeg === 12 && out.setupFacingFailDeg === 25) {
    out.setupFacingWarnDeg = 10;
    out.setupFacingFailDeg = 20;
  }
  return out;
}

const PAIRS: Array<{ warn: NumericKey; fail: NumericKey; label: string }> = [
  { warn: "pelvisRotationWarnDeg", fail: "pelvisRotationFailDeg", label: "Pelvic rotation" },
  { warn: "pelvisTranslationWarnPct", fail: "pelvisTranslationFailPct", label: "Pelvic translation" },
  { warn: "lateralLeanWarnDeg", fail: "lateralLeanFailDeg", label: "Lateral trunk lean" },
  { warn: "forwardLeanWarnDeg", fail: "forwardLeanFailDeg", label: "Forward lean" },
  { warn: "kneeShiftWarnPct", fail: "kneeShiftFailPct", label: "Knee movement" },
  { warn: "hipShiftWarnPct", fail: "hipShiftFailPct", label: "Hip movement" },
  { warn: "setupLeanWarnDeg", fail: "setupLeanFailDeg", label: "Upright" },
  { warn: "setupFacingWarnDeg", fail: "setupFacingFailDeg", label: "Facing the camera" },
];

export function configProblems(config: TLConfig): string[] {
  return PAIRS.filter((pair) => config[pair.warn] >= config[pair.fail]).map((pair) => `${pair.label}: warning must be below failure.`);
}

export function configExport(config: TLConfig): string {
  return JSON.stringify({ kind: "tl-lab-config", version: 1, savedAt: new Date().toISOString(), config }, null, 2);
}

export function configImport(text: string): TLConfig {
  const parsed = JSON.parse(text) as { config?: unknown };
  return normalizeConfig(parsed.config ?? parsed);
}

export const CAMERA_NOTE =
  "Protocol camera: sit facing the camera so the head, shoulders, hips, and knees are all in frame. Axial rotation is taken from MediaPipe world-landmark depth, not from the flat shoulder-line angle, because a straight-on camera keeps that line nearly horizontal. If world-depth yaw disagrees with a goniometer, test the same seated movement with the camera at chest height and about 20–30° off pure frontal. That is a measurement test, not a protocol change.";

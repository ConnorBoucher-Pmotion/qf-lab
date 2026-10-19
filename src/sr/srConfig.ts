export type AngleFilterKind = "oneEuro" | "ema" | "none";

/**
 * Development thresholds. Not clinically validated. Every field is read on the
 * frame it is used, so a slider change affects the next pose sample.
 */
export type SRConfig = {
  angleFilter: AngleFilterKind;
  minMovementDeg: number;
  movementConfirmFrames: number;
  countdownMs: number;
  thumbStableMs: number;
  captureWindowMs: number;
  minActiveMs: number;
  minPeakRomDeg: number;
  romTestMode: boolean;
  stableMs: number;
  calibrationMs: number;
  minCalibrationFrames: number;
  maxCalibrationJitterDeg: number;
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
  maxAngleJumpDeg: number;
  maxAngularVelocityDegPerSec: number;
  trackingLostMs: number;
  trackingResetMs: number;
  shoulderAbductionTargetDeg: number;
  shoulderAbductionWarnDeg: number;
  shoulderAbductionFailDeg: number;
  elbowFlexionTargetDeg: number;
  elbowFlexionWarnDeg: number;
  elbowFlexionFailDeg: number;
  elbowHeightWarnDeg: number;
  elbowHeightFailDeg: number;
  elbowDriftWarnPct: number;
  elbowDriftFailPct: number;
  shoulderShrugWarnPct: number;
  shoulderShrugFailPct: number;
  lateralLeanWarnDeg: number;
  lateralLeanFailDeg: number;
  forwardLeanWarnDeg: number;
  forwardLeanFailDeg: number;
  setupLeanWarnDeg: number;
  setupLeanFailDeg: number;
  setupFacingWarnDeg: number;
  setupFacingFailDeg: number;
  bypassFaceCamera: boolean;
  hardFailPersistMs: number;
  peakPersistMs: number;
  smoothingWindow: number;
};

export const SR_CONFIG: SRConfig = {
  angleFilter: "oneEuro",
  minMovementDeg: 12,
  movementConfirmFrames: 4,
  countdownMs: 3000,
  thumbStableMs: 2000,
  captureWindowMs: 10000,
  minActiveMs: 2000,
  minPeakRomDeg: 15,
  romTestMode: false,
  stableMs: 600,
  calibrationMs: 800,
  minCalibrationFrames: 12,
  maxCalibrationJitterDeg: 4,
  holdMs: 1500,
  peakWindowDeg: 2.5,
  peakVelocityDegPerSec: 6,
  landmarkMinCutoffHz: 2.2,
  landmarkBeta: 1.6,
  outlierJumpHipWidths: 0.45,
  reacquireFrames: 3,
  angleMinCutoffHz: 3,
  angleBeta: 0.35,
  angleEmaAlpha: 0.35,
  angleOutlierDeg: 30,
  landmarkConfidence: 0.4,
  confidenceGraceMs: 150,
  maxAngleJumpDeg: 18,
  maxAngularVelocityDegPerSec: 220,
  trackingLostMs: 400,
  trackingResetMs: 2500,
  shoulderAbductionTargetDeg: 90,
  shoulderAbductionWarnDeg: 10,
  shoulderAbductionFailDeg: 20,
  elbowFlexionTargetDeg: 90,
  elbowFlexionWarnDeg: 10,
  elbowFlexionFailDeg: 20,
  elbowHeightWarnDeg: 8,
  elbowHeightFailDeg: 16,
  elbowDriftWarnPct: 12,
  elbowDriftFailPct: 22,
  shoulderShrugWarnPct: 8,
  shoulderShrugFailPct: 16,
  lateralLeanWarnDeg: 6,
  lateralLeanFailDeg: 12,
  forwardLeanWarnDeg: 8,
  forwardLeanFailDeg: 16,
  setupLeanWarnDeg: 8,
  setupLeanFailDeg: 16,
  setupFacingWarnDeg: 10,
  setupFacingFailDeg: 20,
  bypassFaceCamera: false,
  hardFailPersistMs: 400,
  peakPersistMs: 180,
  smoothingWindow: 5,
};

export type ConfigGroup =
  | "Measurement"
  | "Neutral calibration"
  | "Peak hold"
  | "Smoothing"
  | "Tracking"
  | "Shoulder"
  | "Elbow"
  | "Trunk"
  | "Setup";

export type RangeField = {
  kind: "range";
  key: { [K in keyof SRConfig]: SRConfig[K] extends number ? K : never }[keyof SRConfig];
  label: string;
  group: ConfigGroup;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type SelectField = {
  kind: "select";
  key: "angleFilter";
  label: string;
  group: ConfigGroup;
  options: Array<{ value: string; label: string }>;
};

export type ToggleField = {
  kind: "toggle";
  key: "bypassFaceCamera" | "romTestMode";
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

export const SR_CONFIG_GROUPS: ConfigGroup[] = [
  "Measurement",
  "Neutral calibration",
  "Peak hold",
  "Smoothing",
  "Tracking",
  "Shoulder",
  "Elbow",
  "Trunk",
  "Setup",
];

export const SR_CONFIG_FIELDS: ConfigField[] = [
  r("countdownMs", "Start countdown", "Measurement", 0, 3000, 100, "ms"),
  r("thumbStableMs", "Thumbs-up must hold", "Measurement", 1000, 3000, 100, "ms"),
  r("captureWindowMs", "Capture window", "Measurement", 5000, 15000, 500, "ms"),
  r("minMovementDeg", "Minimum movement before ROM capture", "Measurement", 5, 30, 1, "deg"),
  { kind: "toggle", key: "romTestMode", label: "ROM algorithm test mode", group: "Measurement" },
  r("stableMs", "Neutral stillness before calibration", "Neutral calibration", 200, 2000, 50, "ms"),
  r("calibrationMs", "Baseline capture duration", "Neutral calibration", 400, 3000, 50, "ms"),
  r("minCalibrationFrames", "Minimum baseline frames", "Neutral calibration", 4, 60, 1, "frames"),
  r("maxCalibrationJitterDeg", "Max baseline jitter", "Neutral calibration", 1, 12, 0.5, "deg"),
  r("holdMs", "Peak hold duration", "Peak hold", 200, 4000, 50, "ms"),
  r("peakWindowDeg", "Peak stability tolerance", "Peak hold", 0.5, 10, 0.5, "deg"),
  r("peakPersistMs", "Peak persistence", "Peak hold", 50, 500, 10, "ms"),
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
  r("smoothingWindow", "Smoothing window", "Smoothing", 1, 15, 1, "frames"),
  r("landmarkMinCutoffHz", "Landmark smoothing cutoff", "Smoothing", 0.2, 8, 0.1, "Hz"),
  r("landmarkBeta", "Landmark speed response", "Smoothing", 0, 5, 0.1, ""),
  r("angleMinCutoffHz", "Angle smoothing cutoff", "Smoothing", 0.2, 8, 0.1, "Hz"),
  r("angleBeta", "Angle speed response", "Smoothing", 0, 0.4, 0.01, ""),
  r("angleEmaAlpha", "Angle EMA alpha", "Smoothing", 0.05, 1, 0.05, ""),
  r("angleOutlierDeg", "Angle outlier reject above", "Smoothing", 4, 40, 1, "deg"),
  r("outlierJumpHipWidths", "Landmark jump gate", "Smoothing", 0.1, 1.5, 0.05, "hip widths"),
  r("reacquireFrames", "Accept a sustained jump after", "Smoothing", 1, 8, 1, "frames"),
  r("landmarkConfidence", "Minimum tracking confidence", "Tracking", 0.05, 0.95, 0.01, ""),
  r("confidenceGraceMs", "Weak tracking ignored for", "Tracking", 0, 800, 50, "ms"),
  r("trackingLostMs", "Show tracking lost after", "Tracking", 100, 2000, 50, "ms"),
  r("trackingResetMs", "Reset the trial after tracking lost for", "Tracking", 500, 6000, 100, "ms"),
  r("maxAngleJumpDeg", "Max ROM jump per frame", "Tracking", 6, 40, 1, "deg"),
  r("maxAngularVelocityDegPerSec", "Max angular velocity", "Tracking", 80, 400, 10, "deg/s"),
  r("shoulderAbductionTargetDeg", "Shoulder abduction target", "Shoulder", 60, 120, 1, "deg"),
  r("shoulderAbductionWarnDeg", "Shoulder abduction warning tolerance", "Shoulder", 4, 25, 1, "deg"),
  r("shoulderAbductionFailDeg", "Shoulder abduction fail tolerance", "Shoulder", 8, 40, 1, "deg"),
  r("shoulderShrugWarnPct", "Shoulder shrug warning", "Shoulder", 2, 25, 0.5, "% torso"),
  r("shoulderShrugFailPct", "Shoulder shrug failure", "Shoulder", 4, 40, 0.5, "% torso"),
  r("elbowFlexionTargetDeg", "Elbow flexion target", "Elbow", 60, 120, 1, "deg"),
  r("elbowFlexionWarnDeg", "Elbow warning tolerance", "Elbow", 4, 25, 1, "deg"),
  r("elbowFlexionFailDeg", "Elbow fail tolerance", "Elbow", 8, 40, 1, "deg"),
  r("elbowHeightWarnDeg", "Elbow height warning", "Elbow", 2, 20, 0.5, "deg"),
  r("elbowHeightFailDeg", "Elbow height failure", "Elbow", 4, 30, 0.5, "deg"),
  r("elbowDriftWarnPct", "Maximum elbow drift warning", "Elbow", 4, 40, 0.5, "% arm"),
  r("elbowDriftFailPct", "Maximum elbow drift failure", "Elbow", 8, 50, 0.5, "% arm"),
  r("lateralLeanWarnDeg", "Lateral trunk lean warning", "Trunk", 2, 25, 0.5, "deg"),
  r("lateralLeanFailDeg", "Lateral trunk lean failure", "Trunk", 4, 35, 0.5, "deg"),
  r("forwardLeanWarnDeg", "Forward / back lean warning", "Trunk", 2, 25, 0.5, "deg"),
  r("forwardLeanFailDeg", "Forward / back lean failure", "Trunk", 4, 40, 0.5, "deg"),
  r("setupLeanWarnDeg", "Upright warning", "Setup", 3, 25, 0.5, "deg"),
  r("setupLeanFailDeg", "Upright failure", "Setup", 6, 40, 0.5, "deg"),
  r("setupFacingWarnDeg", "Facing camera warning threshold", "Setup", 5, 40, 1, "deg"),
  r("setupFacingFailDeg", "Facing camera failure threshold", "Setup", 10, 60, 1, "deg"),
  { kind: "toggle", key: "bypassFaceCamera", label: "Bypass Face Camera constraint", group: "Setup" },
  r("hardFailPersistMs", "Constraint must last before it counts", "Setup", 0, 1000, 50, "ms"),
];

type NumericKey = RangeField["key"];

export function normalizeConfig(input: unknown): SRConfig {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SRConfig = { ...SR_CONFIG };
  for (const field of SR_CONFIG_FIELDS) {
    const value = source[field.key];
    if (field.kind === "range") {
      if (typeof value === "number" && Number.isFinite(value)) out[field.key] = Math.max(field.min, Math.min(field.max, value));
    } else if (field.kind === "toggle") {
      if (typeof value === "boolean") out[field.key] = value;
    } else if (typeof value === "string" && field.options.some((option) => option.value === value)) {
      (out as Record<string, unknown>)[field.key] = value;
    }
  }
  return out;
}

const PAIRS: Array<{ warn: NumericKey; fail: NumericKey; label: string }> = [
  { warn: "shoulderAbductionWarnDeg", fail: "shoulderAbductionFailDeg", label: "Shoulder abduction" },
  { warn: "elbowFlexionWarnDeg", fail: "elbowFlexionFailDeg", label: "Elbow flexion" },
  { warn: "elbowHeightWarnDeg", fail: "elbowHeightFailDeg", label: "Elbow height" },
  { warn: "elbowDriftWarnPct", fail: "elbowDriftFailPct", label: "Elbow drift" },
  { warn: "shoulderShrugWarnPct", fail: "shoulderShrugFailPct", label: "Shoulder shrug" },
  { warn: "lateralLeanWarnDeg", fail: "lateralLeanFailDeg", label: "Lateral trunk lean" },
  { warn: "forwardLeanWarnDeg", fail: "forwardLeanFailDeg", label: "Forward lean" },
  { warn: "setupLeanWarnDeg", fail: "setupLeanFailDeg", label: "Upright" },
  { warn: "setupFacingWarnDeg", fail: "setupFacingFailDeg", label: "Facing the camera" },
];

export function configProblems(config: SRConfig): string[] {
  return PAIRS.filter((pair) => config[pair.warn] >= config[pair.fail]).map((pair) => `${pair.label}: warning must be below failure.`);
}

export function configExport(config: SRConfig): string {
  return JSON.stringify({ kind: "sr-lab-config", version: 1, savedAt: new Date().toISOString(), config }, null, 2);
}

export function configImport(text: string): SRConfig {
  const parsed = JSON.parse(text) as { config?: unknown };
  return normalizeConfig(parsed.config ?? parsed);
}

export const CAMERA_NOTE =
  "Protocol camera: sit facing the camera in a goalpost position — arms abducted ~90°, elbows bent ~90°, forearms pointing up. Keep the upper arms still while rotating the forearms for external and internal rotation. Head, shoulders, elbows, wrists, and hips should stay in frame.";

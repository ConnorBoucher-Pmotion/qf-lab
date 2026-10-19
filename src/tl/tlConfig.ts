import { ALGORITHM_ALIASES, ALGORITHM_INFO, ROTATION_ALGORITHMS, type RotationAlgorithm } from "./tlRotation";

export type AngleFilterKind = "oneEuro" | "ema" | "none";

/**
 * Development thresholds. Not clinically validated. Every field is read on the
 * frame it is used, so a slider change affects the next pose sample.
 */
export type TLConfig = {
  algorithm: RotationAlgorithm;
  angleFilter: AngleFilterKind;
  /** Kept so older saved configs still load. Movement no longer starts from this threshold. */
  minMovementDeg: number;
  minVelocityDegPerSec: number;
  movementConfirmMs: number;
  /** Kept so older saved configs still load. Completion is the capture window, not a hold. */
  movementConfirmFrames: number;
  /** 3-2-1 length. Measurement begins after this, plus a short ROTATE cue. 0 skips the countdown. */
  countdownMs: number;
  /** How long the thumbs-up must stay detected before the countdown starts. */
  thumbStableMs: number;
  /** Active capture length after the countdown. The best valid angle in this window is saved. */
  captureWindowMs: number;
  /** Hold cannot finish a trial before the active measurement has lasted this long. */
  minActiveMs: number;
  /** Hold cannot finish a trial before the rotation has reached this far from neutral. */
  minPeakRomDeg: number;
  /** Free rotation after one calibration. Trials do not finish on their own. */
  romTestMode: boolean;
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
  /** How long a dim far shoulder may stay held before confidence drops to LOW. */
  occlusionHoldMs: number;
  /** Reject a single-frame ROM change larger than this. */
  maxAngleJumpDeg: number;
  /** Reject angular speed above this (°/s). Natural rotation is usually well below. */
  maxAngularVelocityDegPerSec: number;
  /** Shoulder-to-ear distance below this fraction of calibration → SHOULDER_CORRUPTED. */
  shoulderEarCollapseRatio: number;
  /** Shoulder-to-nose distance below this fraction of calibration → SHOULDER_CORRUPTED. */
  shoulderNoseCollapseRatio: number;
  /** Upper-arm length |Δ| above this % of calibration → SHOULDER_CORRUPTED. */
  upperArmLengthTolPct: number;
  /** Shoulder width |Δ| above this % of calibration → SHOULDER_CORRUPTED. */
  shoulderWidthTolPct: number;
  /** Vertical jump (in shoulder-widths, after torso cancel) → SHOULDER_CORRUPTED. */
  shoulderVerticalJumpRatio: number;
  /** Lateral distance below this fraction of calibration → near centerline/head. */
  shoulderLateralCollapseRatio: number;
  /** Frame-to-frame shoulder-axis jump above this → suspicious. */
  shoulderAxisJumpDeg: number;
  /** Consecutive anatomically-ok frames before leaving OCCLUSION_ASSISTED. */
  shoulderRecoverFrames: number;
  /** Blend reconstructed → MediaPipe over this many ms when recovering. */
  shoulderBlendMs: number;
  /** Development-only camera offset guide. Does not change the angle math. */
  cameraGuideOffsetDeg: number;
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
  /** Internal. Stops the one-time smoothing and hold-default migration from repeating. */
  filterVersion: number;
  /** Internal. Stops the one-time pelvis-threshold migration from repeating. */
  constraintVersion: number;
  /** Internal. Moves the old 0.75s thumb hold and 1.5s countdown up to the 2s / 3s flow once. */
  flowVersion: number;
  hardFailPersistMs: number;
};

export const TL_CONFIG: TLConfig = {
  algorithm: "torsoPelvis",
  angleFilter: "oneEuro",
  minMovementDeg: 8,
  minVelocityDegPerSec: 10,
  movementConfirmMs: 250,
  movementConfirmFrames: 4,
  countdownMs: 3000,
  thumbStableMs: 2000,
  captureWindowMs: 8000,
  minActiveMs: 2000,
  minPeakRomDeg: 20,
  romTestMode: false,
  stableMs: 600,
  calibrationMs: 1000,
  minCalibrationFrames: 12,
  neutralYawToleranceDeg: 8,
  maxCalibrationYawSdDeg: 1.8,
  maxCalibrationPelvisJitter: 0.08,
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
  occlusionHoldMs: 550,
  maxAngleJumpDeg: 18,
  maxAngularVelocityDegPerSec: 220,
  shoulderEarCollapseRatio: 0.45,
  shoulderNoseCollapseRatio: 0.5,
  upperArmLengthTolPct: 35,
  shoulderWidthTolPct: 35,
  shoulderVerticalJumpRatio: 0.28,
  shoulderLateralCollapseRatio: 0.4,
  shoulderAxisJumpDeg: 22,
  shoulderRecoverFrames: 4,
  shoulderBlendMs: 300,
  cameraGuideOffsetDeg: 0,
  trackingLostMs: 400,
  trackingResetMs: 2500,
  pelvisRotationWarnDeg: 7,
  pelvisRotationFailDeg: 12,
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
  filterVersion: 2,
  constraintVersion: 3,
  flowVersion: 2,
  hardFailPersistMs: 400,
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
  r("countdownMs", "Start countdown", "Measurement", 0, 3000, 100, "ms"),
  r("thumbStableMs", "Thumbs-up must hold", "Measurement", 1000, 3000, 100, "ms"),
  r("captureWindowMs", "Capture window", "Measurement", 5000, 10000, 500, "ms"),
  { kind: "toggle", key: "romTestMode", label: "ROM algorithm test mode", group: "Measurement" },
  r("stableMs", "Neutral stillness before calibration", "Neutral calibration", 200, 2000, 50, "ms"),
  r("calibrationMs", "Neutral calibration duration", "Neutral calibration", 400, 3000, 50, "ms"),
  r("minCalibrationFrames", "Minimum calibration frames", "Neutral calibration", 4, 60, 1, "frames"),
  r("neutralYawToleranceDeg", "Neutral shoulders-vs-pelvis tolerance", "Neutral calibration", 2, 20, 0.5, "deg"),
  r("maxCalibrationYawSdDeg", "Max yaw jitter while calibrating", "Neutral calibration", 0.3, 6, 0.1, "deg"),
  r("maxCalibrationPelvisJitter", "Max pelvis jitter while calibrating", "Neutral calibration", 0.01, 0.2, 0.005, "hip widths"),
  r("holdMs", "Peak hold duration", "Peak hold", 200, 4000, 50, "ms"),
  r("peakWindowDeg", "Peak stability tolerance", "Peak hold", 0.5, 10, 0.5, "deg"),
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
  r("occlusionHoldMs", "Far-shoulder occlusion hold", "Tracking", 200, 1000, 50, "ms"),
  r("maxAngleJumpDeg", "Max ROM jump per frame", "Tracking", 6, 40, 1, "deg"),
  r("maxAngularVelocityDegPerSec", "Max angular velocity", "Tracking", 80, 400, 10, "deg/s"),
  r("shoulderEarCollapseRatio", "Shoulder-ear collapse ratio", "Tracking", 0.2, 0.8, 0.05, ""),
  r("shoulderNoseCollapseRatio", "Shoulder-nose collapse ratio", "Tracking", 0.2, 0.8, 0.05, ""),
  r("upperArmLengthTolPct", "Upper-arm length tolerance", "Tracking", 15, 70, 1, "%"),
  r("shoulderWidthTolPct", "Shoulder width tolerance", "Tracking", 15, 70, 1, "%"),
  r("shoulderVerticalJumpRatio", "Vertical jump (shoulder widths)", "Tracking", 0.1, 0.6, 0.02, ""),
  r("shoulderLateralCollapseRatio", "Lateral collapse ratio", "Tracking", 0.2, 0.8, 0.05, ""),
  r("shoulderAxisJumpDeg", "Shoulder-axis jump gate", "Tracking", 8, 45, 1, "deg"),
  r("shoulderRecoverFrames", "Frames to trust MediaPipe again", "Tracking", 2, 12, 1, "frames"),
  r("shoulderBlendMs", "Reconstructed→real blend", "Tracking", 100, 600, 50, "ms"),
  r("cameraGuideOffsetDeg", "Camera offset guide (dev)", "Setup", 0, 20, 5, "deg"),
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
  if (typeof source.algorithm === "string" && ALGORITHM_ALIASES[source.algorithm]) out.algorithm = ALGORITHM_ALIASES[source.algorithm];
  if (source.facingThresholdVersion !== 2 && out.setupFacingWarnDeg === 12 && out.setupFacingFailDeg === 25) {
    out.setupFacingWarnDeg = 10;
    out.setupFacingFailDeg = 20;
  }
  if (source.filterVersion !== 2) {
    if (out.angleBeta === 0.04) out.angleBeta = TL_CONFIG.angleBeta;
    if (out.angleMinCutoffHz === 1.2) out.angleMinCutoffHz = TL_CONFIG.angleMinCutoffHz;
    if (out.angleOutlierDeg === 12) out.angleOutlierDeg = TL_CONFIG.angleOutlierDeg;
    if (out.landmarkBeta === 0.8) out.landmarkBeta = TL_CONFIG.landmarkBeta;
    if (out.landmarkMinCutoffHz === 1.4) out.landmarkMinCutoffHz = TL_CONFIG.landmarkMinCutoffHz;
    if (out.holdMs === 1750) out.holdMs = TL_CONFIG.holdMs;
    if (out.peakWindowDeg === 3) out.peakWindowDeg = TL_CONFIG.peakWindowDeg;
  }
  if (source.constraintVersion !== 3) {
    if (out.pelvisRotationFailDeg === 5) out.pelvisRotationFailDeg = 12;
    if (out.pelvisRotationWarnDeg === 3 && out.pelvisRotationWarnDeg < out.pelvisRotationFailDeg) out.pelvisRotationWarnDeg = Math.min(7, out.pelvisRotationFailDeg - 0.5);
    if (out.hardFailPersistMs === 300) out.hardFailPersistMs = 400;
  }
  if (source.flowVersion !== 2) {
    if (out.thumbStableMs === 750) out.thumbStableMs = 2000;
    if (out.countdownMs === 1500) out.countdownMs = 3000;
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

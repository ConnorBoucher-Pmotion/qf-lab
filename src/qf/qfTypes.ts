import type { Side, Vec } from "../pose/types";
import type { AngleMethod, QFAngleReference, QFAngleSet } from "./qfMeasurementEngine";

export type QFStateName =
  | "SEARCHING"
  | "POSITIONING"
  | "CALIBRATING"
  | "READY"
  | "ARMED"
  | "MEASURING"
  | "TRACKING_WARNING"
  | "HOLDING"
  | "VALIDATING"
  | "RESULT"
  | "INVALID";

export type Severity = "green" | "yellow" | "red";
export type CheckStatus = "pass" | "warn" | "fail" | "na";
/**
 * setup: decides whether the athlete can start (tolerant).
 * hard: a measurement compensation that rejects the trial.
 * soft: lowers confidence, never rejects on its own.
 * info: displayed only.
 */
export type CheckCategory = "setup" | "hard" | "soft" | "info";

export type ConstraintCheck = {
  id: string;
  label: string;
  category: CheckCategory;
  /** Compared against warn/fail. Absolute value for symmetric quantities. */
  value: number | null;
  warn: number | null;
  fail: number | null;
  unit: string;
  /** "max": larger is worse. "min": smaller is worse. */
  direction: "max" | "min";
  status: CheckStatus;
  /** Setup checks only: false means advisory, it can warn but never blocks. */
  blocking: boolean;
  message: string;
};

export type TrackingGroupId = "knee" | "ankle" | "hips" | "shoulders";

export type TrackingGroup = {
  id: TrackingGroupId;
  label: string;
  critical: boolean;
  confidence: number;
  threshold: number;
  inFrame: boolean;
  ok: boolean;
  badMs: number;
};

export type TrackingStatus = {
  present: boolean;
  absentMs: number;
  groups: TrackingGroup[];
  criticalOk: boolean;
  criticalBadMs: number;
  worstCritical: TrackingGroup | null;
  /** 0–1. Lowest critical confidence relative to its threshold. */
  score: number;
};

export type Stillness = {
  shankSdDeg: number;
  pelvisJitter: number;
  kneeJitter: number;
  ankleJitter: number;
  frames: number;
  spanMs: number;
};

/** Camera/body relationship. Recorded so setup differences can be tied to systematic error. */
export type CameraBodyMetrics = {
  /** Hip line from image horizontal. Camera roll plus any pelvic obliquity. */
  rollProxyDeg: number;
  torsoFromVerticalDeg: number | null;
  facingYawDeg: number | null;
  /** Image thigh length / shank length. Grows as the camera sits higher. */
  pitchProxy: number;
  /** Shank length / frame height. Grows as the camera gets closer. */
  distanceProxy: number;
  bodyX: number;
  bodyY: number;
  hangAbsoluteDeg: number;
  femurElevationDeg: number | null;
  femurAzimuthDeg: number | null;
};

export type QFBaseline = {
  frameCount: number;
  durationMs: number;
  stability: Stillness;
  hipWidthPx: number;
  shankLenPx: number;
  torsoLenPx: number | null;
  pelvisTiltDeg: number;
  pelvisYawDeg: number | null;
  torsoLeanDeg: number | null;
  torsoYawDeg: number | null;
  femurImageDeg: number;
  worldShankDepth: number;
  worldShankLen: number;
  worldKneeFlexionDeg: number | null;
  worldFlexionTrusted: boolean;
  midHip: Vec;
  /** Median left and right hips from the calibration window. Translation uses both. */
  leftHip: Vec;
  rightHip: Vec;
  testedHip: Vec;
  testedKnee: Vec;
  testedAnkle: Vec;
  otherKnee: Vec;
  angleRef: QFAngleReference;
  camera: CameraBodyMetrics;
  confidence: { knee: number; ankle: number; hips: number; shoulders: number };
};

export type QFMetrics = {
  present: boolean;
  confidence: { knee: number; ankle: number; hips: number; shoulders: number };
  /** Smallest distance from a critical landmark to the frame edge, as a fraction of the frame. Negative is outside. */
  inFrameMargin: number | null;
  shankFrac: number | null;
  absoluteShankDeg: number | null;
  hipLineTiltDeg: number | null;
  torsoFromVerticalDeg: number | null;
  facingYawDeg: number | null;
  pitchProxy: number | null;
  kneeOnTestedSide: boolean;
  worldKneeFlexionDeg: number | null;
  bodyX: number | null;
  bodyY: number | null;

  /** Shared hip shift, as a fraction of baseline hip width, after a short median. This is what the check uses. */
  pelvisTranslation: number | null;
  /** Same quantity on this frame, before the median. */
  pelvisTranslationRaw: number | null;
  /** Shared shift in pixels, before dividing by hip width. */
  pelvisShiftPx: number | null;
  /** Gated pelvis center used for the translation check. */
  pelvisCenter: Vec | null;
  pelvisTiltDeltaDeg: number | null;
  pelvisRotationDeg: number | null;
  torsoLeanDeltaDeg: number | null;
  torsoRotationDeg: number | null;
  femurOrientationDeg: number | null;
  femurDeviation: number | null;
  /** Signed: positive is lateral. Relative to the mid-hip. */
  kneeLateralDeviation: number | null;
  shankLengthRatio: number | null;
  movementPlaneDeviation: number | null;
  kneeFlexionDeltaDeg: number | null;
  cameraScaleChange: number | null;
  otherLegDeviation: number | null;

  testedHip: Vec | null;
  testedKnee: Vec | null;
  testedAnkle: Vec | null;
  midHip: Vec | null;
};

export type HoldAnalysis = {
  runMs: number;
  runFrames: number;
  rangeDeg: number;
  slopeDegPerSec: number | null;
  slopeOk: boolean;
  peakDeg: number | null;
  runMedianDeg: number | null;
  nearPeak: boolean;
  stable: boolean;
  progress: number;
};

export type HoldSummary = {
  angles: QFAngleSet;
  frames: number;
  durationMs: number;
  sdDeg: number;
  rangeDeg: number;
  slopeDegPerSec: number | null;
  outlierFrames: number;
  cleanFraction: number;
  peakDeg: number | null;
  softWarnings: Record<string, { warn: number; fail: number }>;
};

export type QFResult = {
  version: 2;
  id: string;
  timestamp: string;
  side: Side;
  series: string;
  trialNumber: number;
  accepted: boolean;
  primaryMethod: AngleMethod;
  /** Primary method: median of the clean frames in the stable hold. */
  measuredRom: number | null;
  /** Same hold, every method. */
  angles: QFAngleSet;
  hold: HoldSummary | null;
  /** Largest unfiltered primary angle seen. Stored for comparison, never used as the result. */
  rawMaximum: number | null;
  confidence: number;
  failedConstraints: string[];
  camera: CameraBodyMetrics | null;
  baseline: QFBaseline | null;
  constraintValues: Record<string, number | null>;
  thresholds: Record<string, unknown>;
  instruction: string;
};

/** Small metadata only. The video file lives in IndexedDB under the trial id. */
export type TrialRecording = {
  durationMs: number;
  mimeType: string;
  bytes: number;
};

export type Trial = QFResult & {
  goniometer: number | null;
  absoluteError: number | null;
  signedError: number | null;
  percentError: number | null;
  recording?: TrialRecording | null;
};

export type QFSnapshot = {
  state: QFStateName;
  instruction: string;
  side: Side;
  primaryMethod: AngleMethod;
  metrics: QFMetrics;
  tracking: TrackingStatus;
  setupChecks: ConstraintCheck[];
  checks: ConstraintCheck[];
  angles: { raw: QFAngleSet; clean: QFAngleSet; filtered: QFAngleSet };
  primary: { raw: number | null; filtered: number | null; stable: number | null; final: number | null };
  hold: HoldAnalysis | null;
  baseline: QFBaseline | null;
  result: QFResult | null;
  quality: number;
  hardFailed: boolean;
  calibrationProgress: number;
  calibrationStillness: Stillness | null;
  /** Filtered image pose in pixels. Empty when nobody is tracked. */
  imagePose: Vec[];
  /** Unfiltered MediaPipe image pose in pixels. */
  rawPose: Vec[];
  filterStats: { rejectedLandmarks: number; reacquired: number; angleOutliers: number };
  /** Start-position angle and the movement gate. A result requires `started`. */
  movement: {
    baselineDeg: number | null;
    excursionDeg: number | null;
    velocityDegPerSec: number | null;
    started: boolean;
  };
};

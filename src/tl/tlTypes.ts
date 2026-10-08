import type { Vec } from "../pose/types";
import type { CameraFacing, RotationAlgorithm } from "./tlRotation";

export type RotationDirection = "left" | "right";

export type TLStateName =
  | "SEARCHING"
  | "POSITIONING"
  | "STABLE"
  | "CALIBRATING"
  | "READY"
  | "ROTATING"
  | "PEAK"
  | "HOLD"
  | "TRACKING_LOST"
  | "COMPLETE"
  | "INVALID";

export type CheckStatus = "pass" | "warn" | "fail" | "na";
export type CheckCategory = "setup" | "hard" | "info";

export type ConstraintCheck = {
  id: string;
  label: string;
  category: CheckCategory;
  value: number | null;
  warn: number | null;
  fail: number | null;
  unit: string;
  status: CheckStatus;
  blocking: boolean;
  message: string;
};

export type TrackingStatus = {
  present: boolean;
  criticalOk: boolean;
  score: number;
  absentMs: number;
  criticalBadMs: number;
  shoulders: number;
  hips: number;
  knees: number;
  ears: number;
};

export type TLEvent = {
  label: string;
  /** Milliseconds after rotation started. Negative events happened during calibration. */
  offsetMs: number;
};

export type CompensationSnapshot = {
  pelvisRotationDeg: number | null;
  pelvisTranslationPct: number | null;
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  kneeShiftPct: number | null;
  hipShiftPct: number | null;
  shoulderTiltDeg: number | null;
  headLeadDeg: number | null;
};

export type TLResult = {
  version: 1;
  id: string;
  timestamp: string;
  direction: RotationDirection;
  series: string;
  trialNumber: number;
  accepted: boolean;
  algorithm: RotationAlgorithm;
  /** Highest rotation while every hard constraint was inside its fail line. */
  measuredRom: number | null;
  /** Highest rotation whether or not compensation had failed. */
  rawMaximum: number | null;
  confidence: number;
  holdMs: number | null;
  failedConstraints: string[];
  warningEvents: string[];
  failureEvents: string[];
  events: TLEvent[];
  atValid: CompensationSnapshot | null;
  atRaw: CompensationSnapshot | null;
  thresholds: Record<string, number>;
  endChecks: ConstraintCheck[];
  instruction: string;
  preRollMs: number;
};

export type TrialRecording = {
  durationMs: number;
  mimeType: string;
  bytes: number;
};

export type TLTrial = TLResult & {
  goniometer: number | null;
  absoluteError: number | null;
  signedError: number | null;
  recording?: TrialRecording | null;
};

export type TLSnapshot = {
  state: TLStateName;
  instruction: string;
  direction: RotationDirection;
  algorithm: RotationAlgorithm;
  metrics: TLMetrics;
  tracking: TrackingStatus;
  setupChecks: ConstraintCheck[];
  checks: ConstraintCheck[];
  /** Live values behind the Face the camera check. Not a clinical measurement. */
  cameraFacing: CameraFacing;
  rom: {
    /** Live rotation from the calibrated neutral. Updates whenever landmarks are present. Not a trial result. */
    current: number | null;
    raw: number | null;
    filtered: number | null;
    /** Trial ROM. Empty until a real rotation has started. */
    active: number | null;
    validPeak: number | null;
    rawPeak: number | null;
  };
  holdProgress: number;
  calibrationProgress: number;
  baselineReady: boolean;
  /** Neutral baseline exists. Positioning is finished. */
  calibrationComplete: boolean;
  /** READY or measuring. Not during positioning or after the trial is stored. */
  assessmentArmed: boolean;
  movementStarted: boolean;
  /** Why the state machine is not advancing. */
  blockedBy: string;
  movementStartFrames: number;
  movementStartFramesRequired: number;
  cameraActive: boolean;
  poseLoop: "active" | "stopped";
  lastPoseAt: number | null;
  hardFailed: boolean;
  quality: number;
  result: TLResult | null;
  events: TLEvent[];
  imagePose: Vec[];
  rawPose: Vec[];
  /** Calibrated shoulder axis, drawn through the current shoulder midpoint. */
  reference: { x1: number; y1: number; x2: number; y2: number } | null;
  fps: number;
  cameraNote: string;
};

export type TLMetrics = {
  present: boolean;
  shoulderYawDeg: number | null;
  pelvisYawDeg: number | null;
  headYawDeg: number | null;
  algorithms: Record<RotationAlgorithm, number | null>;
  pelvisRotationDeg: number | null;
  pelvisTranslationPct: number | null;
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  kneeShiftPct: number | null;
  hipShiftPct: number | null;
  shoulderTiltDeg: number | null;
  headLeadDeg: number | null;
  imageLineDeltaDeg: number | null;
  velocityDegPerSec: number | null;
  leftShoulder: Vec | null;
  rightShoulder: Vec | null;
  leftHip: Vec | null;
  rightHip: Vec | null;
  leftKnee: Vec | null;
  rightKnee: Vec | null;
  shoulderMid: Vec | null;
  hipMid: Vec | null;
  shoulderVector: { x: number; y: number; z: number } | null;
  pelvisVector: { x: number; y: number; z: number } | null;
};

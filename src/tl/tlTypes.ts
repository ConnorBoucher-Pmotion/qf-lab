import type { Vec } from "../pose/types";
import type { CameraFacing, RotationAlgorithm } from "./tlRotation";

export type RotationDirection = "left" | "right";

export type ShoulderTrustDebug = {
  side: "left" | "right";
  visibility: number;
  anatomicalValid: boolean;
  status: "ok" | "low_visibility" | "corrupted";
  trusted: boolean;
  reasons: string[];
  using: "mediapipe" | "reconstructed";
};

export type TLStateName =
  | "SEARCHING"
  | "POSITIONING"
  | "STABLE"
  | "CALIBRATING"
  | "READY"
  | "READY_CONFIRMING"
  | "COUNTDOWN"
  | "ACTIVE"
  | "MEASURING"
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
  /** Software trial quality. Not a clinical grade. */
  trialQuality?: "Excellent" | "Good" | "Fair" | "Retest Recommended";
  qualityNote?: string;
  cameraGuideOffsetDeg?: number;
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

export type AlgorithmLive = {
  id: RotationAlgorithm;
  /** Signed degrees from neutral. Positive is the subject's right. Updates before the trial starts. */
  current: number | null;
  leftPeak: number | null;
  rightPeak: number | null;
};

export type TLSnapshot = {
  state: TLStateName;
  instruction: string;
  direction: RotationDirection;
  algorithm: RotationAlgorithm;
  /** "3", "2", "1", or "ROTATE RIGHT" / "ROTATE LEFT" while the start countdown is running. */
  countdownLabel: string | null;
  algorithmsLive: AlgorithmLive[];
  neutralShoulderYawDeg: number | null;
  neutralPelvisYawDeg: number | null;
  shoulderSpanRatio: number | null;
  imageWidthDeg: number | null;
  imageShoulderYawDeg: number | null;
  romTestMode: boolean;
  /** Milliseconds left in the active capture window. */
  captureRemainingMs: number | null;
  /** 0–1 while a thumbs-up is being held before the countdown. */
  thumbProgress: number;
  /** True on a frame where a thumbs-up is currently visible. */
  thumbSeen: boolean;
  /** Starting position is valid and a thumbs-up, voice command, or button can start the countdown. */
  canStart: boolean;
  /** What the user should fix during the capture window. "Movement valid" when the angle can count. */
  movementMessage: string;
  movementValid: boolean;
  trackingBand: "high" | "medium" | "low" | "invalid";
  trackingScore: number;
  occlusionState: "none" | "expected-far-shoulder" | "prolonged" | "lost";
  occlusionLabel: string;
  rejectReason: string;
  /** LEFT for right rotation; RIGHT for left rotation. */
  anchorShoulder: "left" | "right";
  /** RIGHT for right rotation; LEFT for left rotation. */
  occludedShoulder: "left" | "right";
  trackingMode: "REAL_BOTH_SHOULDERS" | "OCCLUSION_ASSISTED";
  leftShoulderVisibility: number;
  rightShoulderVisibility: number;
  leftHipVisibility: number;
  rightHipVisibility: number;
  /** Ungated MediaPipe torso–pelvis ROM (may include corrupted shoulder). */
  mediaPipeRawRom: number | null;
  /** ROM after anatomical shoulder reconstruction. */
  hybridRom: number | null;
  leftShoulderTrust: ShoulderTrustDebug | null;
  rightShoulderTrust: ShoulderTrustDebug | null;
  /** Image-space MediaPipe shoulder axis (raw). */
  mediaPipeShoulderAxis: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Image-space corrected shoulder axis used for hybrid ROM. */
  correctedShoulderAxis: { x1: number; y1: number; x2: number; y2: number } | null;
  mediaPipeLeftShoulderImage: { x: number; y: number } | null;
  mediaPipeRightShoulderImage: { x: number; y: number } | null;
  correctedLeftShoulderImage: { x: number; y: number } | null;
  correctedRightShoulderImage: { x: number; y: number } | null;
  depthAssistedRom: number | null;
  /** Same formula as Raw, but from spike-gated landmarks. Diagnostic only. */
  gatedRom: number | null;
  /** Shoulder yaw minus pelvis yaw from ungated landmarks (legacy path). */
  shoulderMinusPelvisRom: number | null;
  relativeRotationDeg: number | null;
  baselineRelativeDeg: number | null;
  rawShoulderYawDeg: number | null;
  rawPelvisYawDeg: number | null;
  smoothedShoulderYawDeg: number | null;
  smoothedPelvisYawDeg: number | null;
  metrics: TLMetrics;
  tracking: TrackingStatus;
  setupChecks: ConstraintCheck[];
  checks: ConstraintCheck[];
  /** Live values behind the Face the camera check. Not a clinical measurement. */
  cameraFacing: CameraFacing;
  rom: {
    /** Live rotation from the calibrated neutral. Updates whenever landmarks are present. Not a trial result. */
    current: number | null;
    /** Ungated MediaPipe world landmarks, torso vs pelvis, no angle smoothing. */
    raw: number | null;
    /** Same angle after the landmark smoother, before the angle smoother. */
    landmarkSmoothed: number | null;
    /** Light angle smoothing of Raw. Not a different geometry formula. */
    filtered: number | null;
    /** Trial ROM. Empty until ROTATE. */
    active: number | null;
    validPeak: number | null;
    rawPeak: number | null;
    filteredPeak: number | null;
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
  imageLeftShoulder: Vec | null;
  imageRightShoulder: Vec | null;
  imageLeftHip: Vec | null;
  imageRightHip: Vec | null;
};

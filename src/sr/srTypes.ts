import type { Vec } from "../pose/types";
import type { CameraFacing } from "./srGeometry";

export type Side = "left" | "right";

export type SRStateName =
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
  elbows: number;
  wrists: number;
  hips: number;
};

export type SREvent = {
  label: string;
  /** Milliseconds after movement started. Negative events happened during calibration. */
  offsetMs: number;
};

export type SideAngles = {
  abductionDeg: number | null;
  elbowFlexionDeg: number | null;
  /** Signed forearm rotation from baseline. Positive = external rotation. */
  signedRotationDeg: number | null;
  elbowHeightDiff: number | null;
  elbowDriftPct: number | null;
  shoulderShrugPct: number | null;
  confidence: number;
};

export type SideRom = {
  rawEr: number | null;
  rawIr: number | null;
  validEr: number | null;
  validIr: number | null;
  rawArc: number | null;
  validArc: number | null;
  currentSigned: number | null;
};

export type CompensationSnapshot = {
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  leftAbductionDeg: number | null;
  rightAbductionDeg: number | null;
  leftElbowFlexionDeg: number | null;
  rightElbowFlexionDeg: number | null;
  leftElbowDriftPct: number | null;
  rightElbowDriftPct: number | null;
  leftShoulderShrugPct: number | null;
  rightShoulderShrugPct: number | null;
  maxElbowDriftPct: number | null;
  maxShoulderShrugPct: number | null;
};

export type RejectTally = {
  reason: string;
  count: number;
};

export type SRResult = {
  version: 1;
  id: string;
  timestamp: string;
  series: string;
  trialNumber: number;
  accepted: boolean;
  /** Primary validated total arc across both sides (max side). */
  measuredRom: number | null;
  rawMaximum: number | null;
  confidence: number;
  holdMs: number | null;
  failedConstraints: string[];
  warningEvents: string[];
  failureEvents: string[];
  events: SREvent[];
  atValid: CompensationSnapshot | null;
  atRaw: CompensationSnapshot | null;
  thresholds: Record<string, number>;
  endChecks: ConstraintCheck[];
  instruction: string;
  preRollMs: number;
  trialQuality?: "Excellent" | "Good" | "Fair" | "Retest Recommended";
  qualityNote?: string;
  left: SideRom;
  right: SideRom;
  asymmetryDeg: number | null;
  startingLeftAbductionDeg: number | null;
  startingRightAbductionDeg: number | null;
  startingLeftElbowDeg: number | null;
  startingRightElbowDeg: number | null;
  avgLeftAbductionDeg: number | null;
  avgRightAbductionDeg: number | null;
  maxLeftAbductionDevDeg: number | null;
  maxRightAbductionDevDeg: number | null;
  avgLeftElbowDeg: number | null;
  avgRightElbowDeg: number | null;
  maxLeftElbowDevDeg: number | null;
  maxRightElbowDevDeg: number | null;
  torsoLeanDeg: number | null;
  elbowDriftPct: number | null;
  shoulderShrugEvents: number;
  avgTrackingConfidence: number;
  minTrackingConfidence: number;
  rejectedFrameCount: number;
  rejectedReasons: RejectTally[];
  validFrameCount: number;
  durationMs: number;
  configSnapshot: Record<string, number | boolean | string>;
};

export type TrialRecording = {
  durationMs: number;
  mimeType: string;
  bytes: number;
};

export type SRTrial = SRResult & {
  goniometer: number | null;
  absoluteError: number | null;
  signedError: number | null;
  recording?: TrialRecording | null;
};

export type SRMetrics = {
  present: boolean;
  left: SideAngles;
  right: SideAngles;
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  shoulderTiltDeg: number | null;
  shoulderHeightDiff: number | null;
  velocityDegPerSec: number | null;
  leftShoulder: Vec | null;
  rightShoulder: Vec | null;
  leftElbow: Vec | null;
  rightElbow: Vec | null;
  leftWrist: Vec | null;
  rightWrist: Vec | null;
  leftHip: Vec | null;
  rightHip: Vec | null;
  shoulderMid: Vec | null;
  hipMid: Vec | null;
  imageLeftShoulder: Vec | null;
  imageRightShoulder: Vec | null;
  imageLeftElbow: Vec | null;
  imageRightElbow: Vec | null;
  imageLeftWrist: Vec | null;
  imageRightWrist: Vec | null;
};

export type SRSnapshot = {
  state: SRStateName;
  instruction: string;
  countdownLabel: string | null;
  romTestMode: boolean;
  captureRemainingMs: number | null;
  thumbProgress: number;
  thumbSeen: boolean;
  canStart: boolean;
  movementMessage: string;
  movementValid: boolean;
  trackingBand: "high" | "medium" | "low" | "invalid";
  trackingScore: number;
  rejectReason: string;
  leftShoulderVisibility: number;
  rightShoulderVisibility: number;
  leftElbowVisibility: number;
  rightElbowVisibility: number;
  leftWristVisibility: number;
  rightWristVisibility: number;
  leftHipVisibility: number;
  rightHipVisibility: number;
  metrics: SRMetrics;
  tracking: TrackingStatus;
  setupChecks: ConstraintCheck[];
  checks: ConstraintCheck[];
  cameraFacing: CameraFacing;
  left: SideRom;
  right: SideRom;
  asymmetryDeg: number | null;
  holdProgress: number;
  calibrationProgress: number;
  baselineReady: boolean;
  calibrationComplete: boolean;
  assessmentArmed: boolean;
  movementStarted: boolean;
  blockedBy: string;
  movementStartFrames: number;
  movementStartFramesRequired: number;
  cameraActive: boolean;
  poseLoop: "active" | "stopped";
  lastPoseAt: number | null;
  hardFailed: boolean;
  quality: number;
  result: SRResult | null;
  events: SREvent[];
  imagePose: Vec[];
  rawPose: Vec[];
  reference: { x1: number; y1: number; x2: number; y2: number } | null;
  fps: number;
  cameraNote: string;
  rejectedFrameCount: number;
  validFrameCount: number;
  /** Compatibility shim for shared recording helpers that expect rom.* */
  rom: {
    current: number | null;
    raw: number | null;
    landmarkSmoothed: number | null;
    filtered: number | null;
    active: number | null;
    validPeak: number | null;
    rawPeak: number | null;
    filteredPeak: number | null;
  };
  direction: Side;
};

import type { Vec } from "../pose/types";

export type ObliqueCameraMode = "front" | "oblique-45" | "oblique-30";
export type RotationDirection = "left" | "right";
export type ShoulderSide = "left" | "right";

export type ObliqueState =
  | "SEARCHING"
  | "ALIGNMENT"
  | "CALIBRATING"
  | "WAITING_FOR_READY"
  | "READY_CONFIRMING"
  | "COUNTDOWN"
  | "MEASURING"
  | "TRIAL_COMPLETE"
  | "SESSION_COMPLETE"
  | "INVALID";

export type FrameValidity = "valid" | "warn" | "reject";

export type RejectReason =
  | ""
  | "No pose"
  | "Low landmark confidence"
  | "Shoulder chin/head snap"
  | "Shoulder teleport"
  | "Shoulder width collapse"
  | "Pelvis unstable"
  | "Angle spike"
  | "Tracking lost";

export type V3 = { x: number; y: number; z: number };

export type LandmarkSample = {
  leftShoulder: Vec;
  rightShoulder: Vec;
  leftHip: Vec;
  rightHip: Vec;
  leftElbow: Vec;
  rightElbow: Vec;
  leftEar: Vec;
  rightEar: Vec;
  nose: Vec;
};

export type ObliqueBaseline = {
  cameraMode: ObliqueCameraMode;
  frames: number;
  leftShoulder: Vec;
  rightShoulder: Vec;
  leftHip: Vec;
  rightHip: Vec;
  leftElbow: Vec;
  rightElbow: Vec;
  leftEar: Vec;
  rightEar: Vec;
  nose: Vec;
  shoulderVector: V3;
  hipVector: V3;
  shoulderMid: V3;
  hipMid: V3;
  torsoCenter: V3;
  /** Horizontal signed shoulder-vs-pelvis angle at neutral (world landmarks). */
  relativeYawDeg: number;
  /** Legacy shoulder-AXIS yaw at neutral (debug / plateau comparison). */
  shoulderYawDeg: number;
  /** Legacy hip-AXIS yaw at neutral. */
  pelvisYawDeg: number;
  /** Sealed torso-frame forward yaw at neutral (primary). */
  torsoYawDeg: number;
  /** Sealed pelvis-frame forward yaw at neutral. */
  pelvisFrameYawDeg: number;
  shoulderWidth: number;
  leftShoulderToEar: number;
  rightShoulderToEar: number;
  leftShoulderToNose: number;
  rightShoulderToNose: number;
};

export type OcclusionMode = "BOTH_SHOULDERS" | "WEIGHTED" | "SINGLE_SHOULDER_ASSISTED";

export type FrameDebug = {
  leftShoulder: Vec | null;
  rightShoulder: Vec | null;
  leftHip: Vec | null;
  rightHip: Vec | null;
  leftShoulderConfidence: number;
  rightShoulderConfidence: number;
  leftHipConfidence: number;
  rightHipConfidence: number;
  neutralShoulderVector: V3 | null;
  currentShoulderVector: V3 | null;
  neutralHipVector: V3 | null;
  currentHipVector: V3 | null;
  /** Legacy shoulder-AXIS absolute yaw. */
  liveShoulderYawDeg: number | null;
  /** Sealed neutral shoulder-AXIS yaw. */
  neutralShoulderYawDeg: number | null;
  /** OLD shoulder-line / axis change from READY (debug — plateau-prone). */
  oldShoulderLineDeg: number | null;
  /** Upper torso frame yaw (legacy debug). */
  upperTorsoYawDeg: number | null;
  /** Pelvis yaw change from READY. */
  pelvisRotationDeg: number | null;
  /** Primary shoulder change from READY (trial-positive). */
  thoracicRotationDeg: number | null;
  /** Comparison (opposite) shoulder change — validation only. */
  multiLandmarkYawDeg: number | null;
  /** Primary signed change (alias). */
  shoulderRotationDeg: number | null;
  /** Side-specific raw TL ROM (primary − pelvis deadband). */
  rawRom: number | null;
  filteredRom: number | null;
  maxRawRom: number | null;
  maxValidRom: number | null;
  frameValid: FrameValidity;
  rejectReason: RejectReason;
  reliableShoulder: "both" | ShoulderSide | "none";
  occlusionMode: OcclusionMode;
  occlusionActive: boolean;
  leftReconstructed: boolean;
  rightReconstructed: boolean;
  /** True after READY seals the 0° baseline; never rewritten mid-trial. */
  baselineSealed: boolean;
  /** Direction-specific primary landmark. */
  primaryLandmark: ShoulderSide | null;
  comparisonLandmark: ShoulderSide | null;
  primaryConfidence: number;
  comparisonConfidence: number;
  startingPrimaryAngleDeg: number | null;
  currentPrimaryAngleDeg: number | null;
  primaryChangeFromBaselineDeg: number | null;
  comparisonChangeDeg: number | null;
  pelvisSubtractDeg: number;
  readyBaselineCaptured: boolean;
};

export type ObliqueSnapshot = {
  state: ObliqueState;
  instruction: string;
  setupMessage: string;
  cameraMode: ObliqueCameraMode;
  direction: RotationDirection;
  countdownLabel: string | null;
  /** 0–1 fill of the active measurement window only. Null outside MEASURING. */
  captureProgress: number | null;
  captureRemainingMs: number | null;
  captureWindowMs: number;
  thumbProgress: number;
  thumbSeen: boolean;
  canStart: boolean;
  baselineReady: boolean;
  calibrationProgress: number;
  movementStarted: boolean;
  movementValid: boolean;
  measurementConfidence: number;
  /** Signed shoulder rotation from sealed neutral (debug / live). */
  shoulderRawDeg: number | null;
  pelvisRawDeg: number | null;
  thoracicRawDeg: number | null;
  /** Directional current raw ROM (trial direction). */
  rawRom: number | null;
  filteredRom: number | null;
  /** Running max of rawRom during MEASURING; frozen after TRIAL_COMPLETE. */
  maxRawRom: number | null;
  maxValidRom: number | null;
  leftResult: number | null;
  rightResult: number | null;
  asymmetryDeg: number | null;
  bothDirectionsComplete: boolean;
  frame: FrameDebug;
  imagePose: Vec[];
  rawPose: Vec[];
  fps: number;
  events: Array<{ label: string; offsetMs: number }>;
  comparison: ComparisonRecord | null;
  result: ObliqueResult | null;
};

export type ObliqueResult = {
  id: string;
  timestamp: string;
  cameraMode: ObliqueCameraMode;
  direction: RotationDirection;
  accepted: boolean;
  rawMaximum: number | null;
  validatedMaximum: number | null;
  measurementConfidence: number;
  invalidFramePct: number;
  occlusionEvents: number;
  maxPelvisRotationDeg: number | null;
  instruction: string;
};

export type ComparisonRecord = {
  cameraMode: ObliqueCameraMode;
  direction: RotationDirection;
  leftRom: number | null;
  rightRom: number | null;
  rawRom: number | null;
  validatedRom: number | null;
  measurementConfidence: number;
  poseConfidence: number;
  invalidFramePct: number;
  shoulderOcclusionEvents: number;
  maxPelvisRotationDeg: number | null;
};

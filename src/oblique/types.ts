import type { Vec } from "../pose/types";

export type ObliqueCameraMode = "front" | "oblique-45" | "oblique-30";
export type RotationDirection = "left" | "right";
export type ShoulderSide = "left" | "right";

export type ObliqueState =
  | "SEARCHING"
  | "POSITIONING"
  | "CALIBRATING"
  | "READY"
  | "READY_CONFIRMING"
  | "COUNTDOWN"
  | "ACTIVE"
  | "COMPLETE"
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
  shoulderYawDeg: number;
  pelvisYawDeg: number;
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
  shoulderRotationDeg: number | null;
  pelvisRotationDeg: number | null;
  thoracicRotationDeg: number | null;
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
};

export type ObliqueSnapshot = {
  state: ObliqueState;
  instruction: string;
  setupMessage: string;
  cameraMode: ObliqueCameraMode;
  direction: RotationDirection;
  countdownLabel: string | null;
  captureRemainingMs: number | null;
  thumbProgress: number;
  thumbSeen: boolean;
  canStart: boolean;
  baselineReady: boolean;
  calibrationProgress: number;
  movementStarted: boolean;
  movementValid: boolean;
  measurementConfidence: number;
  rawRom: number | null;
  filteredRom: number | null;
  maxRawRom: number | null;
  maxValidRom: number | null;
  leftResult: number | null;
  rightResult: number | null;
  asymmetryDeg: number | null;
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

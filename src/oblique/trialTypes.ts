import type { ObliqueCameraMode, RotationDirection } from "./types";

export type ConfidenceBand = "excellent" | "good" | "moderate" | "low";

export type TrialCompletionStatus = "completed" | "low_confidence" | "incomplete" | "invalid";

export type TrialFrameSample = {
  /** ms from trial measurement start */
  tMs: number;
  timestamp: number;
  rawRom: number | null;
  filteredRom: number | null;
  rawMaxSoFar: number | null;
  filteredMaxSoFar: number | null;
  leftShoulderX: number;
  leftShoulderY: number;
  leftShoulderZ: number;
  rightShoulderX: number;
  rightShoulderY: number;
  rightShoulderZ: number;
  leftHipX: number;
  leftHipY: number;
  leftHipZ: number;
  rightHipX: number;
  rightHipY: number;
  rightHipZ: number;
  leftShoulderConfidence: number;
  rightShoulderConfidence: number;
  leftHipConfidence: number;
  rightHipConfidence: number;
  measurementMode: string;
  trustedShoulder: string;
  isOutlier: boolean;
  occlusionState: string;
  rejectReason: string;
  estimatorHybridDeg: number | null;
  estimator2dLineDeg: number | null;
  estimatorWorldYawDeg: number | null;
  estimatorImageOrbitDeg: number | null;
  estimatorSelectedSource: string;
  worldSignedUnclampedDeg: number | null;
};

export type TlTrialRecord = {
  trialId: string;
  assessmentId: string;
  timestamp: string;
  trialNumber: number;
  direction: RotationDirection;
  durationMs: number;
  cameraMode: ObliqueCameraMode;
  rawMaxRom: number | null;
  filteredMaxRom: number | null;
  validatedMaxRom: number | null;
  confidence: number;
  confidenceBand: ConfidenceBand;
  completionStatus: TrialCompletionStatus;
  videoId: string | null;
  samples: TrialFrameSample[];
  occlusionEventCount: number;
  rejectedFrameCount: number;
  totalFrameCount: number;
  algorithmPrimary: string;
  leftResult: number | null;
  rightResult: number | null;
};

export type TlAssessmentSummary = {
  assessmentId: string;
  createdAt: string;
  trialIds: string[];
  leftRawMax: number | null;
  rightRawMax: number | null;
};

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 90) return "excellent";
  if (score >= 80) return "good";
  if (score >= 65) return "moderate";
  return "low";
}

export function confidenceLabel(band: ConfidenceBand): string {
  if (band === "excellent") return "Excellent";
  if (band === "good") return "Good";
  if (band === "moderate") return "Moderate";
  return "Low Confidence";
}

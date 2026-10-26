import type { ObliqueCameraMode } from "./types";

export type ObliqueConfig = {
  cameraMode: ObliqueCameraMode;
  /** Neutral stillness before averaging baseline. */
  stableMs: number;
  /** Baseline averaging window. */
  calibrationMs: number;
  minCalibrationFrames: number;
  countdownMs: number;
  thumbStableMs: number;
  captureWindowMs: number;
  landmarkConfidence: number;
  softLandmarkConfidence: number;
  /** Pelvis rotation warn/fail relative to neutral (degrees). */
  pelvisWarnDeg: number;
  pelvisFailDeg: number;
  pelvisTranslationWarnPct: number;
  pelvisTranslationFailPct: number;
  maxAngleJumpDeg: number;
  maxAngularVelocityDegPerSec: number;
  shoulderEarCollapseRatio: number;
  shoulderNoseCollapseRatio: number;
  shoulderWidthTolPct: number;
  shoulderTeleportHipWidths: number;
  occlusionHoldMs: number;
  trackingLostMs: number;
  angleEmaAlpha: number;
  /** Legacy unused for ROM (kept for config compatibility). */
  pelvisDeadbandDeg: number;
  /** Live hip deviation from frozen READY axis that triggers a hips-forward warning. */
  hipDeviationWarnDeg: number;
};

export const OBLIQUE_CONFIG: ObliqueConfig = {
  /** Synthetic lab favors ~35–40° for near-shoulder visibility; 45° remains supported. */
  cameraMode: "oblique-35",
  stableMs: 500,
  calibrationMs: 800,
  minCalibrationFrames: 10,
  countdownMs: 3000,
  thumbStableMs: 2000,
  captureWindowMs: 5000,
  landmarkConfidence: 0.4,
  softLandmarkConfidence: 0.18,
  pelvisWarnDeg: 8,
  pelvisFailDeg: 14,
  pelvisTranslationWarnPct: 6,
  pelvisTranslationFailPct: 12,
  maxAngleJumpDeg: 16,
  maxAngularVelocityDegPerSec: 200,
  shoulderEarCollapseRatio: 0.45,
  shoulderNoseCollapseRatio: 0.5,
  shoulderWidthTolPct: 40,
  shoulderTeleportHipWidths: 0.55,
  occlusionHoldMs: 700,
  trackingLostMs: 500,
  angleEmaAlpha: 0.35,
  pelvisDeadbandDeg: 2.5,
  hipDeviationWarnDeg: 8,
};

export function cameraModeLabel(mode: ObliqueCameraMode): string {
  if (mode === "front") return "Front";
  if (mode === "oblique-30") return "30° Oblique";
  if (mode === "oblique-35") return "35° Oblique";
  if (mode === "oblique-40") return "40° Oblique";
  return "45° Oblique";
}

export function setupCameraCopy(mode: ObliqueCameraMode): string {
  if (mode === "front") {
    return "Position the camera directly in front. Keep your head, shoulders, hips, and upper body visible.";
  }
  const deg =
    mode === "oblique-30"
      ? "30°"
      : mode === "oblique-35"
        ? "35°"
        : mode === "oblique-40"
          ? "40°"
          : "45°";
  return `Position the camera approximately ${deg} to your body. Make sure your head, shoulders, hips, and upper body remain visible throughout the movement.`;
}

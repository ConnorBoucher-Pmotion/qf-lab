import type { ObliqueBaseline, RotationDirection, V3 } from "./types";
import { angleDelta, subjectHorizontalYawDeg, thoracicRelativeYawDeg } from "./vectors";

export type RotationReading = {
  /** Absolute horizontal yaw of the current shoulder vector (subject-right positive). */
  liveShoulderYawDeg: number | null;
  livePelvisYawDeg: number | null;
  liveRelativeYawDeg: number | null;
  /**
   * Primary raw signal for the 45° experiment:
   * change in shoulder XZ yaw from the sealed neutral baseline.
   * Positive = subject's right.
   */
  shoulderFromNeutralDeg: number | null;
  /** Pelvis/hip XZ yaw change from neutral. */
  pelvisFromNeutralDeg: number | null;
  /**
   * Thoracic = change in (shoulder vs pelvis) relative yaw from baseline.
   * Kept for comparison — can stay near 0° if hips track the shoulders.
   */
  thoracicFromNeutralDeg: number | null;
  /** Neutral shoulder yaw sealed at calibration (for debug). */
  neutralShoulderYawDeg: number | null;
};

/**
 * Prefer MediaPipe world landmarks (x, y, z).
 *
 * Horizontal shoulder angle uses atan2(z, x) on (right − left), then a
 * subject-right-positive convention. ROM is ALWAYS current − sealed baseline,
 * never the absolute angle vs the camera/screen.
 */
export function computeRotation(shoulderVec: V3, hipVec: V3, baseline: ObliqueBaseline | null): RotationReading {
  const liveShoulderYaw = subjectHorizontalYawDeg(shoulderVec);
  const livePelvisYaw = subjectHorizontalYawDeg(hipVec);
  const liveRelative = thoracicRelativeYawDeg(shoulderVec, hipVec);
  if (!baseline) {
    return {
      liveShoulderYawDeg: liveShoulderYaw,
      livePelvisYawDeg: livePelvisYaw,
      liveRelativeYawDeg: liveRelative,
      shoulderFromNeutralDeg: null,
      pelvisFromNeutralDeg: null,
      thoracicFromNeutralDeg: null,
      neutralShoulderYawDeg: null,
    };
  }
  return {
    liveShoulderYawDeg: liveShoulderYaw,
    livePelvisYawDeg: livePelvisYaw,
    liveRelativeYawDeg: liveRelative,
    shoulderFromNeutralDeg: liveShoulderYaw == null ? null : angleDelta(liveShoulderYaw, baseline.shoulderYawDeg),
    pelvisFromNeutralDeg: livePelvisYaw == null ? null : angleDelta(livePelvisYaw, baseline.pelvisYawDeg),
    thoracicFromNeutralDeg: liveRelative == null ? null : angleDelta(liveRelative, baseline.relativeYawDeg),
    neutralShoulderYawDeg: baseline.shoulderYawDeg,
  };
}

/** Positive magnitude in the active trial direction (right-positive input). */
export function directionalRom(signedRightPositive: number | null, direction: RotationDirection): number | null {
  if (signedRightPositive == null || !Number.isFinite(signedRightPositive)) return null;
  return direction === "right" ? Math.max(0, signedRightPositive) : Math.max(0, -signedRightPositive);
}

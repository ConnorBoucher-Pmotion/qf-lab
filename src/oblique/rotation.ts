import type { ObliqueBaseline, RotationDirection, V3 } from "./types";
import { angleDelta, subjectHorizontalYawDeg, thoracicRelativeYawDeg } from "./vectors";

export type RotationReading = {
  /** Shoulder yaw change from neutral (world horizontal). */
  shoulderFromNeutralDeg: number | null;
  /** Pelvis yaw change from neutral (world horizontal). */
  pelvisFromNeutralDeg: number | null;
  /**
   * Thoracic rotation = change in (shoulder vs pelvis) relative yaw from baseline.
   * This is pelvis-relative, not camera/screen-relative.
   */
  thoracicFromNeutralDeg: number | null;
  liveRelativeYawDeg: number | null;
  liveShoulderYawDeg: number | null;
  livePelvisYawDeg: number | null;
};

/**
 * Prefer MediaPipe world landmarks (x,y,z).
 * ROM is change from the calibrated neutral pose — never absolute screen angle.
 */
export function computeRotation(shoulderVec: V3, hipVec: V3, baseline: ObliqueBaseline | null): RotationReading {
  const liveShoulderYaw = subjectHorizontalYawDeg(shoulderVec);
  const livePelvisYaw = subjectHorizontalYawDeg(hipVec);
  const liveRelative = thoracicRelativeYawDeg(shoulderVec, hipVec);
  if (!baseline) {
    return {
      shoulderFromNeutralDeg: null,
      pelvisFromNeutralDeg: null,
      thoracicFromNeutralDeg: null,
      liveRelativeYawDeg: liveRelative,
      liveShoulderYawDeg: liveShoulderYaw,
      livePelvisYawDeg: livePelvisYaw,
    };
  }
  return {
    shoulderFromNeutralDeg: liveShoulderYaw == null ? null : angleDelta(liveShoulderYaw, baseline.shoulderYawDeg),
    pelvisFromNeutralDeg: livePelvisYaw == null ? null : angleDelta(livePelvisYaw, baseline.pelvisYawDeg),
    thoracicFromNeutralDeg: liveRelative == null ? null : angleDelta(liveRelative, baseline.relativeYawDeg),
    liveRelativeYawDeg: liveRelative,
    liveShoulderYawDeg: liveShoulderYaw,
    livePelvisYawDeg: livePelvisYaw,
  };
}

/** Positive magnitude in the active trial direction. */
export function directionalRom(signedRightPositive: number | null, direction: RotationDirection): number | null {
  if (signedRightPositive == null || !Number.isFinite(signedRightPositive)) return null;
  return direction === "right" ? Math.max(0, signedRightPositive) : Math.max(0, -signedRightPositive);
}

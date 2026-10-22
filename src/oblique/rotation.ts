import type { LandmarkSample, ObliqueBaseline, RotationDirection } from "./types";
import { LM } from "../pose/types";
import type { Vec } from "../pose/types";
import { computeOrientation, type OrientationReading } from "./torsoOrientation";

export type { OrientationReading };

export type RotationReading = OrientationReading;

/**
 * Primary ROM source for the 45° experiment:
 * world-landmark torso-frame yaw vs pelvis-frame yaw, relative to sealed neutral.
 *
 * The old shoulder-AXIS / screen-line angle is computed only for debug comparison.
 */
export function computeRotation(
  sample: LandmarkSample,
  baseline: ObliqueBaseline | null,
  image?: Vec[] | null
): OrientationReading {
  const imageLeft = image && image.length > LM.leftShoulder ? image[LM.leftShoulder] : null;
  const imageRight = image && image.length > LM.rightShoulder ? image[LM.rightShoulder] : null;
  return computeOrientation(sample, baseline, imageLeft, imageRight);
}

/** Positive magnitude in the active trial direction (right-positive input). */
export function directionalRom(signedRightPositive: number | null, direction: RotationDirection): number | null {
  if (signedRightPositive == null || !Number.isFinite(signedRightPositive)) return null;
  return direction === "right" ? Math.max(0, signedRightPositive) : Math.max(0, -signedRightPositive);
}

/**
 * Primary signed TL ROM (subject-right +).
 *
 * Torso-frame forward from (shoulderAxis × torsoUp) has the same horizontal yaw
 * delta as the shoulder AXIS — so it inherits MediaPipe shoulder-Z saturation (~12–15°).
 * Upper-body Kabsch (shoulders + elbows, hips excluded) keeps tracking through end range.
 * Raw Max therefore uses: multiLandmarkYaw − pelvisFromNeutral when Kabsch is available.
 */
export function primarySignedRom(reading: OrientationReading): number | null {
  const pelvis = reading.pelvisFromNeutralDeg ?? 0;
  if (reading.multiLandmarkFromNeutralDeg != null) {
    return reading.multiLandmarkFromNeutralDeg - pelvis;
  }
  return reading.thoracicRomDeg;
}

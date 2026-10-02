import { angleDelta, dist2, interiorAngle, midpoint, safeRatio } from "../pose/coordinateNormalization";
import { LM, jointIndex, otherSide, type Side, type Vec } from "../pose/types";
import { hipLineTiltDeg, lateralSignX } from "./qfMeasurementEngine";
import type { QFBaseline, QFMetrics } from "./qfTypes";

export { shankLateralDeg } from "./qfMeasurementEngine";

/**
 * Body metrics for the setup and measurement constraints.
 * The QF angle itself is in qfMeasurementEngine.
 */

export type QFObservation = {
  width: number;
  height: number;
  image: Vec[];
  world: Vec[];
};

/** Below this, the shoulders are treated as unseen and torso checks report N/A. */
const SHOULDER_SEEN = 0.2;

export function emptyMetrics(): QFMetrics {
  return {
    present: false,
    confidence: { knee: 0, ankle: 0, hips: 0, shoulders: 0 },
    inFrameMargin: null,
    shankFrac: null,
    absoluteShankDeg: null,
    hipLineTiltDeg: null,
    torsoFromVerticalDeg: null,
    facingYawDeg: null,
    pitchProxy: null,
    kneeOnTestedSide: false,
    worldKneeFlexionDeg: null,
    bodyX: null,
    bodyY: null,
    pelvisTranslation: null,
    pelvisTranslationRaw: null,
    pelvisShiftPx: null,
    pelvisCenter: null,
    pelvisTiltDeltaDeg: null,
    pelvisRotationDeg: null,
    torsoLeanDeltaDeg: null,
    torsoRotationDeg: null,
    femurOrientationDeg: null,
    femurDeviation: null,
    kneeLateralDeviation: null,
    shankLengthRatio: null,
    movementPlaneDeviation: null,
    kneeFlexionDeltaDeg: null,
    cameraScaleChange: null,
    otherLegDeviation: null,
    testedHip: null,
    testedKnee: null,
    testedAnkle: null,
    midHip: null,
  };
}

/** Segment angle from image-down, signed toward image +x. */
export function angleFromDownDeg(proximal: Vec, distal: Vec): number {
  return (Math.atan2(distal.x - proximal.x, distal.y - proximal.y) * 180) / Math.PI;
}

/** Upward segment from image-up. 0 when the shoulders sit directly above the hips. */
export function angleFromUpDeg(proximal: Vec, distal: Vec): number {
  return (Math.atan2(distal.x - proximal.x, proximal.y - distal.y) * 180) / Math.PI;
}

/** Yaw of a left/right pair from world depth. Only changes from baseline are trusted. */
export function pairYawDeg(left: Vec, right: Vec): number {
  const width = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
  if (width < 1e-6) return 0;
  const ratio = Math.max(-1, Math.min(1, (left.z - right.z) / width));
  return (Math.asin(ratio) * 180) / Math.PI;
}

export function kneeFlexionDeg(hip: Vec, knee: Vec, ankle: Vec): number | null {
  const interior = interiorAngle(hip, knee, ankle);
  return interior == null ? null : 180 - interior;
}

/**
 * Translation is the shift both hips share, in units of the calibrated hip width.
 * Motion of only one hip (a landmark sliding as the thigh turns) does not count.
 * Opposite motion (yaw, hip hike, leaning closer) does not count; those have their own checks.
 */
export function sharedPelvisShift(leftHip: Vec, rightHip: Vec, baseline: QFBaseline): { ratio: number; pixels: number; center: Vec } {
  const baseL = baseline.leftHip ?? { ...baseline.midHip, x: baseline.midHip.x - baseline.hipWidthPx / 2 };
  const baseR = baseline.rightHip ?? { ...baseline.midHip, x: baseline.midHip.x + baseline.hipWidthPx / 2 };
  const dxL = leftHip.x - baseL.x;
  const dyL = leftHip.y - baseL.y;
  const dxR = rightHip.x - baseR.x;
  const dyR = rightHip.y - baseR.y;
  const sx = sharedAxis(dxL, dxR);
  const sy = sharedAxis(dyL, dyR);
  const pixels = Math.hypot(sx, sy);
  return {
    pixels,
    ratio: safeRatio(pixels, baseline.hipWidthPx),
    center: midpoint(leftHip, rightHip),
  };
}

function sharedAxis(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (a === 0 || b === 0) return 0;
  if (Math.sign(a) !== Math.sign(b)) return 0;
  return Math.sign(a) * Math.min(Math.abs(a), Math.abs(b));
}

export function extractMetrics(obs: QFObservation, side: Side, baseline: QFBaseline | null): QFMetrics {
  const { image, world, width, height } = obs;
  if (image.length < 33 || world.length < 33) return emptyMetrics();

  const testedHip = image[jointIndex(side, "hip")];
  const testedKnee = image[jointIndex(side, "knee")];
  const testedAnkle = image[jointIndex(side, "ankle")];
  const otherKnee = image[jointIndex(otherSide(side), "knee")];
  const leftHip = image[LM.leftHip];
  const rightHip = image[LM.rightHip];
  const leftShoulder = image[LM.leftShoulder];
  const rightShoulder = image[LM.rightShoulder];
  const midHip = midpoint(leftHip, rightHip);
  const midShoulder = midpoint(leftShoulder, rightShoulder);
  const worldHip = world[jointIndex(side, "hip")];
  const worldKnee = world[jointIndex(side, "knee")];
  const worldAnkle = world[jointIndex(side, "ankle")];

  const confidence = {
    knee: testedKnee.visibility,
    ankle: testedAnkle.visibility,
    hips: Math.min(leftHip.visibility, rightHip.visibility),
    shoulders: Math.min(leftShoulder.visibility, rightShoulder.visibility),
  };
  const shouldersSeen = confidence.shoulders >= SHOULDER_SEEN;
  const hipWidth = dist2(leftHip, rightHip);
  const shankLen = dist2(testedKnee, testedAnkle);
  const lateral = lateralSignX(side);
  const critical = [testedHip, testedKnee, testedAnkle, leftHip, rightHip];
  const inFrameMargin = Math.min(
    ...critical.map((p) => Math.min(p.x / width, 1 - p.x / width, p.y / height, 1 - p.y / height))
  );
  const torsoFromVerticalDeg = shouldersSeen ? angleFromUpDeg(midHip, midShoulder) : null;
  const tilt = hipLineTiltDeg(leftHip, rightHip);
  const flexion = kneeFlexionDeg(worldHip, worldKnee, worldAnkle);

  const metrics: QFMetrics = {
    ...emptyMetrics(),
    present: true,
    confidence,
    inFrameMargin,
    shankFrac: safeRatio(shankLen, height),
    absoluteShankDeg: (lateral * Math.atan2(testedAnkle.x - testedKnee.x, testedAnkle.y - testedKnee.y) * 180) / Math.PI,
    hipLineTiltDeg: tilt,
    torsoFromVerticalDeg,
    facingYawDeg: Math.abs(pairYawDeg(world[LM.leftHip], world[LM.rightHip])),
    pitchProxy: safeRatio(dist2(testedHip, testedKnee), shankLen),
    kneeOnTestedSide: (testedKnee.x - midHip.x) * lateral > -hipWidth * 0.55,
    worldKneeFlexionDeg: flexion,
    bodyX: midHip.x / width,
    bodyY: midHip.y / height,
    testedHip,
    testedKnee,
    testedAnkle,
    midHip,
  };
  if (!baseline) return metrics;

  const kneeRel = { x: testedKnee.x - midHip.x, y: testedKnee.y - midHip.y };
  const baseRel = { x: baseline.testedKnee.x - baseline.midHip.x, y: baseline.testedKnee.y - baseline.midHip.y };
  const otherRel = { x: otherKnee.x - midHip.x, y: otherKnee.y - midHip.y };
  const baseOtherRel = { x: baseline.otherKnee.x - baseline.midHip.x, y: baseline.otherKnee.y - baseline.midHip.y };

  const shared = sharedPelvisShift(leftHip, rightHip, baseline);
  metrics.pelvisTranslationRaw = shared.ratio;
  metrics.pelvisShiftPx = shared.pixels;
  metrics.pelvisCenter = shared.center;
  metrics.pelvisTranslation = shared.ratio;
  metrics.pelvisTiltDeltaDeg = angleDelta(tilt, baseline.pelvisTiltDeg);
  metrics.pelvisRotationDeg =
    baseline.pelvisYawDeg != null ? angleDelta(pairYawDeg(world[LM.leftHip], world[LM.rightHip]), baseline.pelvisYawDeg) : null;
  metrics.torsoLeanDeltaDeg =
    torsoFromVerticalDeg != null && baseline.torsoLeanDeg != null ? angleDelta(torsoFromVerticalDeg, baseline.torsoLeanDeg) : null;
  metrics.torsoRotationDeg =
    shouldersSeen && baseline.torsoYawDeg != null
      ? angleDelta(pairYawDeg(world[LM.leftShoulder], world[LM.rightShoulder]), baseline.torsoYawDeg)
      : null;
  metrics.femurOrientationDeg = angleDelta(angleFromDownDeg(testedHip, testedKnee), baseline.femurImageDeg);
  metrics.femurDeviation = safeRatio(Math.hypot(kneeRel.x - baseRel.x, kneeRel.y - baseRel.y), baseline.shankLenPx);
  metrics.kneeLateralDeviation = safeRatio((kneeRel.x - baseRel.x) * lateral, baseline.shankLenPx);
  metrics.shankLengthRatio = safeRatio(shankLen, baseline.shankLenPx);
  metrics.cameraScaleChange = safeRatio(hipWidth, baseline.hipWidthPx) - 1;
  metrics.otherLegDeviation = safeRatio(Math.hypot(otherRel.x - baseOtherRel.x, otherRel.y - baseOtherRel.y), baseline.shankLenPx);
  metrics.movementPlaneDeviation =
    baseline.worldShankLen > 1e-4 ? (worldAnkle.z - worldKnee.z - baseline.worldShankDepth) / baseline.worldShankLen : null;
  metrics.kneeFlexionDeltaDeg =
    flexion != null && baseline.worldFlexionTrusted && baseline.worldKneeFlexionDeg != null
      ? flexion - baseline.worldKneeFlexionDeg
      : null;
  return metrics;
}

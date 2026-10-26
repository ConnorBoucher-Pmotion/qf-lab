/**
 * Parallel TL estimators for live diagnosis.
 *
 * Coordinate systems (do not mix):
 * - WORLD: MediaPipe Pose world landmarks (meters, hip-centered; we use XZ for yaw).
 * - IMAGE: pixel landmarks from MediaPipe image space (NOT CSS-mirrored).
 *   Preview CSS scaleX(-1) is display-only and must not enter math.
 *
 * Estimators:
 * A Existing hybrid (world frozen-hip / visible-shoulder)
 * B 2D shoulder-line slope delta (often ~0 for pure axial yaw — diagnostic)
 * C World shoulder-axis yaw vs frozen hip (same core as hybrid both-mode)
 * D Image-space primary-shoulder orbit around frozen hip mid (yaw proxy)
 */

import { axisYawDeg, signedAngleXZ, xzAxis } from "./axisYawRom";
import { mid } from "./landmarks";
import type { HybridReadyBaseline } from "./hybridRom";
import type { LandmarkSample, RotationDirection, V3 } from "./types";
import { LM, type Vec } from "../pose/types";

export type ImageBaseline = {
  hipMid: V3;
  primary: V3;
  comparison: V3;
  leftShoulder: V3;
  rightShoulder: V3;
  shoulderLineDeg: number;
  primaryBearingDeg: number;
  sealedAtMs: number;
};

export type CvEstimatorSet = {
  existingHybridDeg: number | null;
  shoulderLine2dDeg: number | null;
  worldAxisYawDeg: number | null;
  imagePrimaryOrbitDeg: number | null;
  /** Unclamped signed world TL (right+). Reveals sign/direction bugs. */
  worldSignedUnclampedDeg: number | null;
  selectedDeg: number | null;
  selectedSource: "hybrid_world" | "image_primary_orbit" | "world_axis" | "none";
  baselineLocked: boolean;
  frozenHipRefDeg: number | null;
  currentWorldShoulderYawDeg: number | null;
  baselineWorldShoulderYawDeg: number | null;
  imageCoords: {
    leftShoulder: V3;
    rightShoulder: V3;
    leftHip: V3;
    rightHip: V3;
  } | null;
  worldCoords: {
    leftShoulder: V3;
    rightShoulder: V3;
    leftHip: V3;
    rightHip: V3;
  } | null;
};

export function sealImageBaseline(imageSample: LandmarkSample, direction: RotationDirection, now: number): ImageBaseline | null {
  const hipMid = mid(imageSample.leftHip, imageSample.rightHip);
  const primary = direction === "right" ? imageSample.leftShoulder : imageSample.rightShoulder;
  const comparison = direction === "right" ? imageSample.rightShoulder : imageSample.leftShoulder;
  const line = imageShoulderLineDeg(imageSample);
  const bearing = imageBearingDeg(primary, hipMid);
  if (line == null || bearing == null) return null;
  return {
    hipMid: { x: hipMid.x, y: hipMid.y, z: hipMid.z },
    primary: { x: primary.x, y: primary.y, z: primary.z },
    comparison: { x: comparison.x, y: comparison.y, z: comparison.z },
    leftShoulder: { x: imageSample.leftShoulder.x, y: imageSample.leftShoulder.y, z: imageSample.leftShoulder.z },
    rightShoulder: { x: imageSample.rightShoulder.x, y: imageSample.rightShoulder.y, z: imageSample.rightShoulder.z },
    shoulderLineDeg: line,
    primaryBearingDeg: bearing,
    sealedAtMs: now,
  };
}

export function computeCvDiagnostics(input: {
  worldSample: LandmarkSample;
  imageSample: LandmarkSample | null;
  worldBaseline: HybridReadyBaseline | null;
  imageBaseline: ImageBaseline | null;
  direction: RotationDirection;
  hybridSelectedDeg: number | null;
}): CvEstimatorSet {
  const { worldSample, imageSample, worldBaseline, imageBaseline, direction, hybridSelectedDeg } = input;

  const worldAxis = worldBaseline
    ? worldAxisRom(worldSample, worldBaseline, direction)
    : { directional: null as number | null, signed: null as number | null, currentYaw: null as number | null };

  const line2d =
    imageSample && imageBaseline
      ? shortest(imageShoulderLineDeg(imageSample)! - imageBaseline.shoulderLineDeg)
      : imageSample
        ? imageShoulderLineDeg(imageSample)
        : null;

  const imageOrbit =
    imageSample && imageBaseline ? imagePrimaryOrbitRom(imageSample, imageBaseline, direction) : null;

  // Selection: prefer world hybrid when it reports meaningful motion.
  // Catch wrong-sign clamp: large |signed| but directional ~0 → use |signed|.
  // If world under-reports vs image primary orbit during clear motion, use image orbit.
  // Axial yaw often barely changes 2D shoulder-line slope — never select B for ROM.
  let selected = hybridSelectedDeg;
  let source: CvEstimatorSet["selectedSource"] = hybridSelectedDeg != null ? "hybrid_world" : "none";
  const worldSignedAbs = Math.abs(worldAxis.signed ?? 0);
  const worldMag = Math.abs(hybridSelectedDeg ?? worldAxis.directional ?? 0);
  const imageMag = Math.abs(imageOrbit ?? 0);

  if (worldAxis.signed != null && worldSignedAbs >= 10 && worldMag < worldSignedAbs * 0.35) {
    selected = worldSignedAbs;
    source = "world_axis";
  } else if (imageOrbit != null && imageMag >= 10 && worldMag < imageMag * 0.45) {
    selected = imageOrbit;
    source = "image_primary_orbit";
  } else if (hybridSelectedDeg == null && worldAxis.directional != null) {
    selected = worldAxis.directional;
    source = "world_axis";
  } else if (hybridSelectedDeg == null && imageOrbit != null) {
    selected = imageOrbit;
    source = "image_primary_orbit";
  }

  return {
    existingHybridDeg: hybridSelectedDeg,
    shoulderLine2dDeg: line2d,
    worldAxisYawDeg: worldAxis.directional,
    imagePrimaryOrbitDeg: imageOrbit,
    worldSignedUnclampedDeg: worldAxis.signed,
    selectedDeg: selected,
    selectedSource: source,
    baselineLocked: worldBaseline != null,
    frozenHipRefDeg: worldBaseline?.frozenHipReferenceDeg ?? null,
    currentWorldShoulderYawDeg: worldAxis.currentYaw,
    baselineWorldShoulderYawDeg: worldBaseline?.startingShoulderAngleDeg ?? null,
    imageCoords: imageSample
      ? {
          leftShoulder: xyz(imageSample.leftShoulder),
          rightShoulder: xyz(imageSample.rightShoulder),
          leftHip: xyz(imageSample.leftHip),
          rightHip: xyz(imageSample.rightHip),
        }
      : null,
    worldCoords: {
      leftShoulder: xyz(worldSample.leftShoulder),
      rightShoulder: xyz(worldSample.rightShoulder),
      leftHip: xyz(worldSample.leftHip),
      rightHip: xyz(worldSample.rightHip),
    },
  };
}

function worldAxisRom(
  sample: LandmarkSample,
  baseline: HybridReadyBaseline,
  direction: RotationDirection
): { directional: number | null; signed: number | null; currentYaw: number | null } {
  const curAxis = xzAxis(sample.rightShoulder, sample.leftShoulder);
  const currentYaw = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  if (!curAxis) return { directional: null, signed: null, currentYaw };
  const rel = signedAngleXZ(baseline.frozenHipAxis, curAxis);
  if (rel == null) return { directional: null, signed: null, currentYaw };
  const signed = rel - baseline.startingShoulderToHipOffsetDeg;
  const directional = direction === "right" ? Math.max(0, signed) : Math.max(0, -signed);
  return { directional, signed, currentYaw };
}

/** Image-plane bearing of primary shoulder around frozen hip mid — NOT shoulder-line slope. */
function imagePrimaryOrbitRom(
  sample: LandmarkSample,
  baseline: ImageBaseline,
  direction: RotationDirection
): number | null {
  const primary = direction === "right" ? sample.leftShoulder : sample.rightShoulder;
  const bearing = imageBearingDeg(primary, baseline.hipMid);
  if (bearing == null) return null;
  const delta = shortest(bearing - baseline.primaryBearingDeg);
  // Magnitude of primary-shoulder orbit in the image plane (NOT shoulder-line slope).
  // Sign of image bearing depends on camera obliqueness; trial direction is known, so use |Δ|.
  void direction;
  return Math.abs(delta);
}

function imageShoulderLineDeg(sample: LandmarkSample): number | null {
  const dx = sample.rightShoulder.x - sample.leftShoulder.x;
  const dy = sample.rightShoulder.y - sample.leftShoulder.y;
  if (Math.hypot(dx, dy) < 1e-3) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Bearing of shoulder relative to hip mid in image XY (degrees). */
function imageBearingDeg(shoulder: Vec, hipMid: V3): number | null {
  const dx = shoulder.x - hipMid.x;
  const dy = shoulder.y - hipMid.y;
  if (Math.hypot(dx, dy) < 1e-3) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

function shortest(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

function xyz(p: Vec): V3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function extractImageSample(image: Vec[]): LandmarkSample | null {
  if (image.length < 33) return null;
  return {
    leftShoulder: image[LM.leftShoulder],
    rightShoulder: image[LM.rightShoulder],
    leftHip: image[LM.leftHip],
    rightHip: image[LM.rightHip],
    leftElbow: image[LM.leftElbow],
    rightElbow: image[LM.rightElbow],
    leftEar: image[LM.leftEar],
    rightEar: image[LM.rightEar],
    nose: image[LM.nose],
  };
}

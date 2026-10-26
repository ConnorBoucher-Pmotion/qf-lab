import { vis } from "./landmarks";
import type { LandmarkSample, RotationDirection, V3 } from "./types";
import { computePrimaryRom, type ReadyBaseline as OldReadyBaseline } from "./primaryShoulderRom";

/**
 * MediaPipe Pose world landmarks:
 *   x → subject right
 *   y → down (synthetic tests use Y-up; we only use XZ)
 *   z → toward camera
 *
 * PRIMARY ROM (45° experiment):
 *   TL = signedAngle(FROZEN hipAxis, current shoulderAxis)
 *      − signedAngle(FROZEN hipAxis, baseline shoulderAxis)
 *
 * The hip axis is captured once at READY and NEVER updated.
 * Live hip landmarks do NOT enter the ROM formula.
 */

export type XZ = { x: number; z: number };

export type AxisYawReadyBaseline = {
  direction: RotationDirection;
  /** Frozen hip endpoints at READY (world). Never mutated after seal. */
  baselineLeftHip: V3;
  baselineRightHip: V3;
  /** Frozen hip axis = right − left at READY. */
  frozenHipAxis: XZ;
  /** Shoulder endpoints at READY. */
  baselineLeftShoulder: V3;
  baselineRightShoulder: V3;
  frozenShoulderAxis: XZ;
  /**
   * Absolute bearing of frozen hip axis (debug label only).
   * Subject-right-positive convention.
   */
  frozenHipReferenceDeg: number;
  /** Absolute bearing of starting shoulder axis. */
  startingShoulderAngleDeg: number;
  /** signedAngle(frozenHip, baselineShoulder) — zeroed out of ROM. */
  startingShoulderToHipOffsetDeg: number;
  sealedAtMs: number;
};

export type AxisYawReading = {
  frozenHipReferenceDeg: number | null;
  startingShoulderAngleDeg: number | null;
  startingShoulderToHipOffsetDeg: number | null;
  currentShoulderAngleDeg: number | null;
  currentShoulderVsFrozenHipDeg: number | null;
  /** TL ROM from start (signed, subject-right +). */
  signedTlRotationDeg: number | null;
  /** Magnitude in trial direction. */
  currentRawRomDeg: number | null;
  liveHipAngleDeg: number | null;
  /** Live hip vs frozen hip — quality only, NOT subtracted from ROM. */
  liveHipDeviationDeg: number | null;
  usingWorldLandmarks: true;
  experimentalOldPrimaryDeg: number | null;
  leftShoulderConfidence: number;
  rightShoulderConfidence: number;
  /** Endpoints for drawing the frozen hip reference line (world → project in overlay). */
  frozenLeftHip: V3 | null;
  frozenRightHip: V3 | null;
};

/** Horizontal yaw of an axis (right − left). Subject-right-positive. */
export function axisYawDeg(right: V3, left: V3): number | null {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return (-Math.atan2(dz, dx) * 180) / Math.PI;
}

export function xzAxis(right: V3, left: V3): XZ | null {
  const x = right.x - left.x;
  const z = right.z - left.z;
  if (Math.hypot(x, z) < 1e-6) return null;
  return { x, z };
}

/**
 * Signed angle from axis A → axis B in the XZ plane (degrees).
 * atan2(cross, dot) — NOT unsigned acos.
 */
export function signedAngleXZ(a: XZ, b: XZ): number | null {
  const aMag = Math.hypot(a.x, a.z);
  const bMag = Math.hypot(b.x, b.z);
  if (aMag < 1e-6 || bMag < 1e-6) return null;
  const dot = a.x * b.x + a.z * b.z;
  const cross = a.x * b.z - a.z * b.x;
  // Negate so subject-right shoulder turn relative to hip reads positive
  // (MediaPipe X=right, Z=toward camera; verified with syntheticSeated).
  return (-Math.atan2(cross, dot) * 180) / Math.PI;
}

export function shortestAngleDeltaDeg(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

export function sealAxisYawBaseline(
  sample: LandmarkSample,
  direction: RotationDirection,
  now: number
): AxisYawReadyBaseline | null {
  const frozenHipAxis = xzAxis(sample.rightHip, sample.leftHip);
  const frozenShoulderAxis = xzAxis(sample.rightShoulder, sample.leftShoulder);
  if (!frozenHipAxis || !frozenShoulderAxis) return null;

  const startingOffset = signedAngleXZ(frozenHipAxis, frozenShoulderAxis);
  if (startingOffset == null) return null;

  const frozenHipReferenceDeg = axisYawDeg(sample.rightHip, sample.leftHip);
  const startingShoulderAngleDeg = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  if (frozenHipReferenceDeg == null || startingShoulderAngleDeg == null) return null;

  return {
    direction,
    baselineLeftHip: copyV3(sample.leftHip),
    baselineRightHip: copyV3(sample.rightHip),
    frozenHipAxis: { ...frozenHipAxis },
    baselineLeftShoulder: copyV3(sample.leftShoulder),
    baselineRightShoulder: copyV3(sample.rightShoulder),
    frozenShoulderAxis: { ...frozenShoulderAxis },
    frozenHipReferenceDeg,
    startingShoulderAngleDeg,
    startingShoulderToHipOffsetDeg: startingOffset,
    sealedAtMs: now,
  };
}

/**
 * Primary ROM against FROZEN hip axis.
 * Live hip landmarks are measured only as liveHipDeviationDeg (quality).
 */
export function computeAxisYawRom(
  sample: LandmarkSample,
  baseline: AxisYawReadyBaseline | null,
  direction: RotationDirection,
  oldReady: OldReadyBaseline | null
): AxisYawReading {
  const currentShoulderAxis = xzAxis(sample.rightShoulder, sample.leftShoulder);
  const currentHipAxis = xzAxis(sample.rightHip, sample.leftHip);
  const currentShoulderAngle = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  const liveHipAngle = axisYawDeg(sample.rightHip, sample.leftHip);

  let experimentalOld: number | null = null;
  if (oldReady) {
    experimentalOld = computePrimaryRom(sample, oldReady, direction, 2.5).primaryChangeDeg;
  }

  if (!baseline || baseline.direction !== direction || !currentShoulderAxis) {
    return {
      frozenHipReferenceDeg: baseline?.frozenHipReferenceDeg ?? null,
      startingShoulderAngleDeg: baseline?.startingShoulderAngleDeg ?? null,
      startingShoulderToHipOffsetDeg: baseline?.startingShoulderToHipOffsetDeg ?? null,
      currentShoulderAngleDeg: currentShoulderAngle,
      currentShoulderVsFrozenHipDeg: null,
      signedTlRotationDeg: null,
      currentRawRomDeg: null,
      liveHipAngleDeg: liveHipAngle,
      liveHipDeviationDeg: null,
      usingWorldLandmarks: true,
      experimentalOldPrimaryDeg: experimentalOld,
      leftShoulderConfidence: vis(sample.leftShoulder),
      rightShoulderConfidence: vis(sample.rightShoulder),
      frozenLeftHip: baseline?.baselineLeftHip ?? null,
      frozenRightHip: baseline?.baselineRightHip ?? null,
    };
  }

  // CRITICAL: always compare against baseline.frozenHipAxis — never rebuild from live hips.
  const currentRelative = signedAngleXZ(baseline.frozenHipAxis, currentShoulderAxis);
  if (currentRelative == null) {
    return emptyWithBaseline(baseline, currentShoulderAngle, liveHipAngle, experimentalOld, sample, currentHipAxis);
  }

  // Zero out the READY camera/setup offset.
  const signedTl = currentRelative - baseline.startingShoulderToHipOffsetDeg;
  const currentRaw = direction === "right" ? Math.max(0, signedTl) : Math.max(0, -signedTl);

  // Quality only — NOT subtracted from ROM.
  const liveHipDeviation =
    currentHipAxis == null ? null : signedAngleXZ(baseline.frozenHipAxis, currentHipAxis);

  return {
    frozenHipReferenceDeg: baseline.frozenHipReferenceDeg,
    startingShoulderAngleDeg: baseline.startingShoulderAngleDeg,
    startingShoulderToHipOffsetDeg: baseline.startingShoulderToHipOffsetDeg,
    currentShoulderAngleDeg: currentShoulderAngle,
    currentShoulderVsFrozenHipDeg: currentRelative,
    signedTlRotationDeg: signedTl,
    currentRawRomDeg: currentRaw,
    liveHipAngleDeg: liveHipAngle,
    liveHipDeviationDeg: liveHipDeviation,
    usingWorldLandmarks: true,
    experimentalOldPrimaryDeg: experimentalOld,
    leftShoulderConfidence: vis(sample.leftShoulder),
    rightShoulderConfidence: vis(sample.rightShoulder),
    frozenLeftHip: baseline.baselineLeftHip,
    frozenRightHip: baseline.baselineRightHip,
  };
}

function emptyWithBaseline(
  baseline: AxisYawReadyBaseline,
  currentShoulderAngle: number | null,
  liveHipAngle: number | null,
  experimentalOld: number | null,
  sample: LandmarkSample,
  currentHipAxis: XZ | null
): AxisYawReading {
  return {
    frozenHipReferenceDeg: baseline.frozenHipReferenceDeg,
    startingShoulderAngleDeg: baseline.startingShoulderAngleDeg,
    startingShoulderToHipOffsetDeg: baseline.startingShoulderToHipOffsetDeg,
    currentShoulderAngleDeg: currentShoulderAngle,
    currentShoulderVsFrozenHipDeg: null,
    signedTlRotationDeg: null,
    currentRawRomDeg: null,
    liveHipAngleDeg: liveHipAngle,
    liveHipDeviationDeg:
      currentHipAxis == null ? null : signedAngleXZ(baseline.frozenHipAxis, currentHipAxis),
    usingWorldLandmarks: true,
    experimentalOldPrimaryDeg: experimentalOld,
    leftShoulderConfidence: vis(sample.leftShoulder),
    rightShoulderConfidence: vis(sample.rightShoulder),
    frozenLeftHip: baseline.baselineLeftHip,
    frozenRightHip: baseline.baselineRightHip,
  };
}

function copyV3(p: { x: number; y: number; z: number }): V3 {
  return { x: p.x, y: p.y, z: p.z };
}

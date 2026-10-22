import { vis } from "./landmarks";
import type { LandmarkSample, RotationDirection, V3 } from "./types";
import { computePrimaryRom, type ReadyBaseline as OldReadyBaseline } from "./primaryShoulderRom";

/**
 * MediaPipe Pose world landmarks in this project:
 *   x → subject right
 *   y → down (gravity); synthetic tests use Y-up — axis yaw uses XZ only
 *   z → toward camera
 *
 * Thorax / pelvis orientation = horizontal yaw of (right − left) axes.
 * ALWAYS right − left (never flipped).
 */

export type AxisYawReadyBaseline = {
  direction: RotationDirection;
  /** Absolute atan2(dz, dx) shoulder-axis yaw at READY. */
  baselineShoulderYawDeg: number;
  /** Absolute atan2(dz, dx) hip-axis yaw at READY. */
  baselineHipYawDeg: number;
  sealedAtMs: number;
  /** Seed for continuous unwrapping (same as baseline at seal). */
  unwrappedShoulderYawDeg: number;
  unwrappedHipYawDeg: number;
  lastRawShoulderYawDeg: number;
  lastRawHipYawDeg: number;
};

export type AxisYawReading = {
  absoluteShoulderYawDeg: number | null;
  baselineShoulderYawDeg: number | null;
  shoulderYawChangeDeg: number | null;
  absoluteHipYawDeg: number | null;
  baselineHipYawDeg: number | null;
  hipYawChangeDeg: number | null;
  /** Signed TL = shoulderYawChange − hipYawChange (continuous unwrapped). */
  signedTlRotationDeg: number | null;
  /** Magnitude in the trial direction (for Raw / Raw Max). */
  currentRawRomDeg: number | null;
  usingWorldLandmarks: true;
  /** Experimental old method (shoulder→hipMid arc) for comparison only. */
  experimentalOldPrimaryDeg: number | null;
  leftShoulderConfidence: number;
  rightShoulderConfidence: number;
};

/** Horizontal yaw of an axis vector built as right − left. Degrees. */
export function axisYawDeg(right: V3, left: V3): number | null {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  // Subject-right-positive: negate atan2(dz, dx) so a rightward trunk turn increases yaw
  // (verified against syntheticSeated + MediaPipe X=right / Z=toward-camera).
  return (-Math.atan2(dz, dx) * 180) / Math.PI;
}

/** Shortest signed delta from `from` → `to` in degrees (−180, 180]. */
export function shortestAngleDeltaDeg(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Advance a continuously unwrapped angle given the new raw atan2 reading.
 * Prevents 15° → 0° collapse from re-wrapping / unsigned folding.
 */
export function unwrapAngleDeg(previousUnwrapped: number, previousRaw: number, currentRaw: number): number {
  return previousUnwrapped + shortestAngleDeltaDeg(previousRaw, currentRaw);
}

export function sealAxisYawBaseline(
  sample: LandmarkSample,
  direction: RotationDirection,
  now: number
): AxisYawReadyBaseline | null {
  const shoulder = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  const hip = axisYawDeg(sample.rightHip, sample.leftHip);
  if (shoulder == null || hip == null) return null;
  return {
    direction,
    baselineShoulderYawDeg: shoulder,
    baselineHipYawDeg: hip,
    sealedAtMs: now,
    unwrappedShoulderYawDeg: shoulder,
    unwrappedHipYawDeg: hip,
    lastRawShoulderYawDeg: shoulder,
    lastRawHipYawDeg: hip,
  };
}

/**
 * Update continuous unwrap state on the baseline object (mutates unwrap fields only).
 * Baseline absolute yaw values are NEVER overwritten.
 */
export function advanceUnwrap(baseline: AxisYawReadyBaseline, sample: LandmarkSample): void {
  const shoulderRaw = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  const hipRaw = axisYawDeg(sample.rightHip, sample.leftHip);
  if (shoulderRaw == null || hipRaw == null) return;
  baseline.unwrappedShoulderYawDeg = unwrapAngleDeg(
    baseline.unwrappedShoulderYawDeg,
    baseline.lastRawShoulderYawDeg,
    shoulderRaw
  );
  baseline.unwrappedHipYawDeg = unwrapAngleDeg(
    baseline.unwrappedHipYawDeg,
    baseline.lastRawHipYawDeg,
    hipRaw
  );
  baseline.lastRawShoulderYawDeg = shoulderRaw;
  baseline.lastRawHipYawDeg = hipRaw;
}

export function computeAxisYawRom(
  sample: LandmarkSample,
  baseline: AxisYawReadyBaseline | null,
  direction: RotationDirection,
  oldReady: OldReadyBaseline | null
): AxisYawReading {
  const shoulderRaw = axisYawDeg(sample.rightShoulder, sample.leftShoulder);
  const hipRaw = axisYawDeg(sample.rightHip, sample.leftHip);

  let experimentalOld: number | null = null;
  if (oldReady) {
    const old = computePrimaryRom(sample, oldReady, direction, 2.5);
    experimentalOld = old.primaryChangeDeg;
  }

  if (!baseline || baseline.direction !== direction) {
    return {
      absoluteShoulderYawDeg: shoulderRaw,
      baselineShoulderYawDeg: null,
      shoulderYawChangeDeg: null,
      absoluteHipYawDeg: hipRaw,
      baselineHipYawDeg: null,
      hipYawChangeDeg: null,
      signedTlRotationDeg: null,
      currentRawRomDeg: null,
      usingWorldLandmarks: true,
      experimentalOldPrimaryDeg: experimentalOld,
      leftShoulderConfidence: vis(sample.leftShoulder),
      rightShoulderConfidence: vis(sample.rightShoulder),
    };
  }

  advanceUnwrap(baseline, sample);

  const shoulderChange = baseline.unwrappedShoulderYawDeg - baseline.baselineShoulderYawDeg;
  const hipChange = baseline.unwrappedHipYawDeg - baseline.baselineHipYawDeg;
  const signedTl = shoulderChange - hipChange;

  // Trial-direction magnitude for Raw Max (sign preserved in signedTl).
  const currentRaw =
    direction === "right" ? Math.max(0, signedTl) : Math.max(0, -signedTl);

  return {
    absoluteShoulderYawDeg: shoulderRaw,
    baselineShoulderYawDeg: baseline.baselineShoulderYawDeg,
    shoulderYawChangeDeg: shoulderChange,
    absoluteHipYawDeg: hipRaw,
    baselineHipYawDeg: baseline.baselineHipYawDeg,
    hipYawChangeDeg: hipChange,
    signedTlRotationDeg: signedTl,
    currentRawRomDeg: currentRaw,
    usingWorldLandmarks: true,
    experimentalOldPrimaryDeg: experimentalOld,
    leftShoulderConfidence: vis(sample.leftShoulder),
    rightShoulderConfidence: vis(sample.rightShoulder),
  };
}

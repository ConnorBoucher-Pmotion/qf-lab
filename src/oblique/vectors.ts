import { dist, mag, mid, sub } from "./landmarks";
import type { LandmarkSample, V3 } from "./types";

export function shoulderVector(sample: LandmarkSample): V3 {
  return sub(sample.rightShoulder, sample.leftShoulder);
}

export function hipVector(sample: LandmarkSample): V3 {
  return sub(sample.rightHip, sample.leftHip);
}

export function shoulderMidOf(sample: LandmarkSample) {
  return mid(sample.leftShoulder, sample.rightShoulder);
}

export function hipMidOf(sample: LandmarkSample) {
  return mid(sample.leftHip, sample.rightHip);
}

export function torsoCenterOf(sample: LandmarkSample) {
  return mid(shoulderMidOf(sample), hipMidOf(sample));
}

export function shoulderWidthOf(sample: LandmarkSample): number {
  return Math.max(dist(sample.leftShoulder, sample.rightShoulder), 1e-4);
}

export function hipWidthOf(sample: LandmarkSample): number {
  return Math.max(dist(sample.leftHip, sample.rightHip), 1e-4);
}

/** Horizontal yaw of a vector around vertical (Y-up world landmarks). Degrees. */
export function horizontalYawDeg(vector: V3): number | null {
  const horizontal = Math.hypot(vector.x, vector.z);
  if (horizontal < 1e-6) return null;
  return (Math.atan2(vector.z, vector.x) * 180) / Math.PI;
}

/**
 * Signed angle from hip axis to shoulder axis in the horizontal plane.
 * Uses MediaPipe world landmarks (x,y,z). Positive = subject's right rotation
 * (matches the frontal TL lab convention).
 */
export function thoracicRelativeYawDeg(shoulder: V3, hip: V3): number | null {
  const shMag = Math.hypot(shoulder.x, shoulder.z);
  const hpMag = Math.hypot(hip.x, hip.z);
  if (shMag < 1e-6 || hpMag < 1e-6) return null;
  // Negate cross so a rightward shoulder turn (negative atan2 in +Z-camera frames) reads positive.
  const cross = hip.x * shoulder.z - hip.z * shoulder.x;
  const dot = hip.x * shoulder.x + hip.z * shoulder.z;
  return (-Math.atan2(cross, dot) * 180) / Math.PI;
}

/** Horizontal yaw with +right subject convention for shoulder/hip axes. */
export function subjectHorizontalYawDeg(vector: V3): number | null {
  const yaw = horizontalYawDeg(vector);
  return yaw == null ? null : -yaw;
}

export function angleDelta(current: number, baseline: number): number {
  let value = current - baseline;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

export function vectorMag(v: V3): number {
  return mag(v);
}

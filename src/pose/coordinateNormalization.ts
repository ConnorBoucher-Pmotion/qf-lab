import type { Vec } from "./types";

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function dist2(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

export function sub(a: Vec, b: Vec): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mag3(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Interior angle at B for A–B–C, in degrees. Scale-invariant. */
export function interiorAngle(a: Vec, b: Vec, c: Vec): number | null {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const denom = mag3(ba) * mag3(bc);
  if (denom < 1e-9) return null;
  const cos = clamp(dot3(ba, bc) / denom, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Smallest signed difference, in degrees, wrapped to [-180, 180]. */
export function angleDelta(current: number, baseline: number): number {
  let delta = current - baseline;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) return 0;
  return numerator / denominator;
}

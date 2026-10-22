import { LM, type Vec } from "../pose/types";
import type { LandmarkSample } from "./types";

export function extractLandmarks(world: Vec[]): LandmarkSample | null {
  if (world.length < 33) return null;
  return {
    leftShoulder: world[LM.leftShoulder],
    rightShoulder: world[LM.rightShoulder],
    leftHip: world[LM.leftHip],
    rightHip: world[LM.rightHip],
    leftElbow: world[LM.leftElbow],
    rightElbow: world[LM.rightElbow],
    leftEar: world[LM.leftEar],
    rightEar: world[LM.rightEar],
    nose: world[LM.nose],
  };
}

export function vis(point: Vec | null | undefined): number {
  return point?.visibility ?? 0;
}

export function copyVec(point: Vec): Vec {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility, held: point.held };
}

export function mid(a: Vec, b: Vec): Vec {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

export function sub(a: Vec, b: Vec): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec, b: { x: number; y: number; z: number }, visibility = a.visibility): Vec {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, visibility };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function mag(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function scale(v: { x: number; y: number; z: number }, s: number): { x: number; y: number; z: number } {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function blendIn(target: Vec, sample: Vec, n: number): void {
  const w = 1 / n;
  target.x += (sample.x - target.x) * w;
  target.y += (sample.y - target.y) * w;
  target.z += (sample.z - target.z) * w;
  target.visibility += ((sample.visibility ?? 1) - (target.visibility ?? 1)) * w;
}

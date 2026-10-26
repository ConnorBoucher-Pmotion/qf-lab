/**
 * Candidate TL Junction estimators evaluated against synthetic ground truth.
 * All angles in degrees. Subject-right-positive for signed torso yaw.
 */

import type { LandmarkName, PoseLandmarks, ProjectedPose, V3 } from "./synthetic_rig";

export type AlgoId = "A" | "B" | "C" | "D" | "E" | "F";

export type Calibration = {
  frozenHipAxis: { x: number; z: number };
  frozenHipMid: V3;
  frozenShoulderAxis: { x: number; z: number };
  startingShoulderToHipOffsetDeg: number;
  leftShoulder: V3;
  rightShoulder: V3;
  primaryLeftVec: { x: number; z: number };
  primaryRightVec: { x: number; z: number };
  shoulderWidth: number;
  neck: V3;
  chest: V3;
};

export type Estimate = {
  algo: AlgoId;
  signedDeg: number | null;
  mode: string;
  trustedShoulder: "both" | "left" | "right" | "none";
};

export function sealCalibration(world: PoseLandmarks): Calibration {
  const frozenHipAxis = xz(world.rightHip, world.leftHip)!;
  const frozenShoulderAxis = xz(world.rightShoulder, world.leftShoulder)!;
  const offset = signedAngleXZ(frozenHipAxis, frozenShoulderAxis)!;
  const hipMid = mid(world.leftHip, world.rightHip);
  return {
    frozenHipAxis,
    frozenHipMid: hipMid,
    frozenShoulderAxis,
    startingShoulderToHipOffsetDeg: offset,
    leftShoulder: { ...world.leftShoulder },
    rightShoulder: { ...world.rightShoulder },
    primaryLeftVec: { x: world.leftShoulder.x - hipMid.x, z: world.leftShoulder.z - hipMid.z },
    primaryRightVec: { x: world.rightShoulder.x - hipMid.x, z: world.rightShoulder.z - hipMid.z },
    shoulderWidth: Math.hypot(
      world.rightShoulder.x - world.leftShoulder.x,
      world.rightShoulder.y - world.leftShoulder.y,
      world.rightShoulder.z - world.leftShoulder.z
    ),
    neck: { ...world.neck },
    chest: { ...world.chest },
  };
}

export function estimateAll(
  pose: ProjectedPose,
  cal: Calibration,
  opts: { direction: "left" | "right"; expectOcclusion: boolean }
): Estimate[] {
  const w = pose.world;
  const leftVis = w.leftShoulder.visibility ?? 1;
  const rightVis = w.rightShoulder.visibility ?? 1;
  const leftOcc = pose.image.leftShoulder.occluded || leftVis < 0.45;
  const rightOcc = pose.image.rightShoulder.occluded || rightVis < 0.45;
  const farIsRight = opts.direction === "right";
  const farUnreliable = farIsRight ? rightOcc : leftOcc;
  const anchor: "left" | "right" = farIsRight ? "left" : "right";

  const a = algoA(w, cal);
  const b = algoB(w, cal);
  const c = algoC(w, cal, anchor, opts.direction);
  const d = algoD(w, cal);
  const e = algoE(w, cal, pose);
  const useBoth = !farUnreliable && leftVis >= 0.5 && rightVis >= 0.5;
  const fSigned = useBoth ? b.signedDeg : c.signedDeg;
  const f: Estimate = {
    algo: "F",
    signedDeg: fSigned,
    mode: useBoth ? "BOTH_FROZEN_HIP" : "VISIBLE_SHOULDER",
    trustedShoulder: useBoth ? "both" : directionPrimary(opts.direction),
  };

  void opts.expectOcclusion;
  return [a, b, c, d, e, f];
}

/** A: traditional shoulder-line yaw change from READY (no frozen hip). */
function algoA(w: PoseLandmarks, cal: Calibration): Estimate {
  const cur = axisYaw(w.rightShoulder, w.leftShoulder);
  const base = axisYaw(cal.rightShoulder, cal.leftShoulder);
  if (cur == null || base == null) return { algo: "A", signedDeg: null, mode: "SHOULDER_LINE", trustedShoulder: "both" };
  return { algo: "A", signedDeg: shortest(cur - base), mode: "SHOULDER_LINE", trustedShoulder: "both" };
}

/** B: shoulder axis vs FROZEN hip axis, zeroed at READY. */
function algoB(w: PoseLandmarks, cal: Calibration): Estimate {
  const curAxis = xz(w.rightShoulder, w.leftShoulder);
  if (!curAxis) return { algo: "B", signedDeg: null, mode: "FROZEN_HIP", trustedShoulder: "both" };
  const rel = signedAngleXZ(cal.frozenHipAxis, curAxis);
  if (rel == null) return { algo: "B", signedDeg: null, mode: "FROZEN_HIP", trustedShoulder: "both" };
  return {
    algo: "B",
    signedDeg: rel - cal.startingShoulderToHipOffsetDeg,
    mode: "FROZEN_HIP",
    trustedShoulder: "both",
  };
}

/** C: visible shoulder only vs FROZEN hip midpoint (matches hybridRom.visibleShoulderRom). */
function algoC(
  w: PoseLandmarks,
  cal: Calibration,
  anchor: "left" | "right",
  direction: "left" | "right"
): Estimate {
  const sh = anchor === "left" ? w.leftShoulder : w.rightShoulder;
  // Always use the sealed primary vector for this trial direction (left for right-rot).
  const primaryAnchor: "left" | "right" = direction === "right" ? "left" : "right";
  const baseVec = primaryAnchor === "left" ? cal.primaryLeftVec : cal.primaryRightVec;
  const useSh = primaryAnchor === "left" ? w.leftShoulder : w.rightShoulder;
  void sh;
  void anchor;
  const cur = { x: useSh.x - cal.frozenHipMid.x, z: useSh.z - cal.frozenHipMid.z };
  const geometric = signedXZ(baseVec, cur);
  if (geometric == null) {
    return { algo: "C", signedDeg: null, mode: "VISIBLE_SHOULDER", trustedShoulder: primaryAnchor };
  }
  // Trial-positive, then map back to subject-right-positive signed angle.
  const trialPositive = direction === "right" ? -geometric : geometric;
  const signed = direction === "right" ? Math.max(0, trialPositive) : -Math.max(0, trialPositive);
  return { algo: "C", signedDeg: signed, mode: "VISIBLE_SHOULDER", trustedShoulder: primaryAnchor };
}

/** D: torso plane from shoulders + neck relative to frozen hip axis. */
function algoD(w: PoseLandmarks, cal: Calibration): Estimate {
  const midSh = mid(w.leftShoulder, w.rightShoulder);
  const torsoAxis = { x: midSh.x - cal.frozenHipMid.x + (w.neck.x - midSh.x) * 0.2, z: midSh.z - cal.frozenHipMid.z };
  // Use shoulder axis projected; blend with neck offset for stability.
  const shAxis = xz(w.rightShoulder, w.leftShoulder);
  if (!shAxis) return { algo: "D", signedDeg: null, mode: "TORSO_PLANE", trustedShoulder: "both" };
  const blended = {
    x: shAxis.x * 0.7 + torsoAxis.x * 0.3,
    z: shAxis.z * 0.7 + torsoAxis.z * 0.3,
  };
  const rel = signedAngleXZ(cal.frozenHipAxis, blended);
  if (rel == null) return { algo: "D", signedDeg: null, mode: "TORSO_PLANE", trustedShoulder: "both" };
  return {
    algo: "D",
    signedDeg: rel - cal.startingShoulderToHipOffsetDeg,
    mode: "TORSO_PLANE",
    trustedShoulder: "both",
  };
}

/** E: perspective foreshortening of shoulder span → acos(width ratio), signed by depth. */
function algoE(w: PoseLandmarks, cal: Calibration, pose: ProjectedPose): Estimate {
  const span = Math.hypot(
    w.rightShoulder.x - w.leftShoulder.x,
    w.rightShoulder.z - w.leftShoulder.z
  );
  const ratio = Math.max(-1, Math.min(1, span / Math.max(cal.shoulderWidth, 1e-4)));
  const mag = (Math.acos(ratio) * 180) / Math.PI;
  const dz = pose.image.rightShoulder.depth - pose.image.leftShoulder.depth;
  // If right shoulder closer to camera → subject rotating left (negative) for frontal;
  // for oblique cameras this gets messy — use world Z of shoulders vs hip mid as sign.
  const midZ = cal.frozenHipMid.z;
  const leftFwd = w.leftShoulder.z - midZ;
  const rightFwd = w.rightShoulder.z - midZ;
  const sign = rightFwd - leftFwd;
  const signed = Math.abs(sign) < 1e-4 ? 0 : sign > 0 ? mag : -mag;
  void dz;
  return { algo: "E", signedDeg: signed, mode: "PERSPECTIVE_SPAN", trustedShoulder: "both" };
}

function xz(right: V3, left: V3): { x: number; z: number } | null {
  const x = right.x - left.x;
  const z = right.z - left.z;
  if (Math.hypot(x, z) < 1e-6) return null;
  return { x, z };
}

function signedAngleXZ(a: { x: number; z: number }, b: { x: number; z: number }): number | null {
  const aMag = Math.hypot(a.x, a.z);
  const bMag = Math.hypot(b.x, b.z);
  if (aMag < 1e-6 || bMag < 1e-6) return null;
  const dot = a.x * b.x + a.z * b.z;
  const cross = a.x * b.z - a.z * b.x;
  return (-Math.atan2(cross, dot) * 180) / Math.PI;
}

function signedXZ(baseline: { x: number; z: number }, current: { x: number; z: number }): number | null {
  const bMag = Math.hypot(baseline.x, baseline.z);
  const cMag = Math.hypot(current.x, current.z);
  if (bMag < 1e-6 || cMag < 1e-6) return null;
  const dot = baseline.x * current.x + baseline.z * current.z;
  const cross = baseline.x * current.z - baseline.z * current.x;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function axisYaw(right: V3, left: V3): number | null {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return (-Math.atan2(dz, dx) * 180) / Math.PI;
}

function shortest(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

function mid(a: V3, b: V3): V3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function directionPrimary(direction: "left" | "right"): "left" | "right" {
  return direction === "right" ? "left" : "right";
}

export function algoLabel(id: AlgoId): string {
  const map: Record<AlgoId, string> = {
    A: "Shoulder-line delta",
    B: "Shoulder vs frozen hip",
    C: "Visible shoulder only",
    D: "Torso plane",
    E: "Perspective span",
    F: "Hybrid B→C",
  };
  return map[id];
}

export type { LandmarkName };

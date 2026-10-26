import { mid, vis } from "./landmarks";
import type { LandmarkSample, RotationDirection, ShoulderSide, V3 } from "./types";
import { angleDelta } from "./vectors";
import { buildPelvisFrame, oldShoulderAxisYawDeg } from "./torsoOrientation";

export type XZ = { x: number; z: number };

/**
 * Direction-specific primary shoulder for the 45° experiment.
 * RIGHT trial → LEFT shoulder (stays visible)
 * LEFT trial  → RIGHT shoulder (stays visible)
 */
export function primarySide(direction: RotationDirection): ShoulderSide {
  return direction === "right" ? "left" : "right";
}

export function comparisonSide(direction: RotationDirection): ShoulderSide {
  return direction === "right" ? "right" : "left";
}

export type ReadyBaseline = {
  direction: RotationDirection;
  primarySide: ShoulderSide;
  comparisonSide: ShoulderSide;
  /** Hip midpoint at READY (world). */
  hipMid: V3;
  /** primaryShoulder − hipMid at READY (full 3D; yaw uses XZ). */
  primaryVector: V3;
  comparisonVector: V3;
  /** Absolute bearing of primary vector in XZ at READY (debug). */
  primaryBearingDeg: number;
  comparisonBearingDeg: number;
  pelvisYawDeg: number;
  /** Legacy shoulder-line yaw at READY for plateau diagnosis. */
  oldShoulderLineYawDeg: number | null;
  sealedAtMs: number;
};

export type PrimaryRomReading = {
  primarySide: ShoulderSide;
  comparisonSide: ShoulderSide;
  primaryConfidence: number;
  comparisonConfidence: number;
  /** Absolute bearing of current primary vector (debug — not displayed as ROM). */
  currentPrimaryBearingDeg: number | null;
  startingPrimaryBearingDeg: number | null;
  /**
   * Signed angular change of primary shoulder around torso pivot (XZ).
   * Positive = motion in the trial direction.
   */
  primaryChangeDeg: number | null;
  /** Same metric for the opposite shoulder (validation only — never averaged in). */
  comparisonChangeDeg: number | null;
  /** Pelvis yaw change from READY (signed, trial-positive). */
  pelvisChangeDeg: number | null;
  /** Pelvis contribution after deadband (degrees subtracted from primary). */
  pelvisSubtractDeg: number;
  /**
   * TL ROM = max(0, primaryChange − pelvisSubtract).
   * Primary alone; comparison never pulls this down.
   */
  rawTlRomDeg: number | null;
  /** World-landmark horizontal vectors used (debug). */
  baselinePrimaryVector: XZ | null;
  currentPrimaryVector: XZ | null;
  oldShoulderLineFromReadyDeg: number | null;
  usingWorldLandmarks: true;
};

/** Seal READY baseline from the current world-landmark sample. This IS 0°. */
export function sealReadyBaseline(sample: LandmarkSample, direction: RotationDirection, now: number): ReadyBaseline | null {
  const hipMid = mid(sample.leftHip, sample.rightHip);
  const primary = primarySide(direction);
  const comparison = comparisonSide(direction);
  const primaryLm = primary === "left" ? sample.leftShoulder : sample.rightShoulder;
  const comparisonLm = comparison === "left" ? sample.leftShoulder : sample.rightShoulder;
  const primaryVector = sub3(primaryLm, hipMid);
  const comparisonVector = sub3(comparisonLm, hipMid);
  if (xzMag(primaryVector) < 1e-4) return null;
  const pelvis = buildPelvisFrame(sample);
  return {
    direction,
    primarySide: primary,
    comparisonSide: comparison,
    hipMid: { x: hipMid.x, y: hipMid.y, z: hipMid.z },
    primaryVector,
    comparisonVector,
    primaryBearingDeg: bearingDeg(primaryVector) ?? 0,
    comparisonBearingDeg: bearingDeg(comparisonVector) ?? 0,
    pelvisYawDeg: pelvis?.yawDeg ?? 0,
    oldShoulderLineYawDeg: oldShoulderAxisYawDeg(sample),
    sealedAtMs: now,
  };
}

export function computePrimaryRom(
  sample: LandmarkSample,
  ready: ReadyBaseline | null,
  direction: RotationDirection,
  pelvisDeadbandDeg: number
): PrimaryRomReading {
  const primary = primarySide(direction);
  const comparison = comparisonSide(direction);
  const primaryLm = primary === "left" ? sample.leftShoulder : sample.rightShoulder;
  const comparisonLm = comparison === "left" ? sample.leftShoulder : sample.rightShoulder;
  // Prefer FROZEN hip mid from READY — live hips must not redefine zero.
  const hipMid = ready && ready.direction === direction ? ready.hipMid : mid(sample.leftHip, sample.rightHip);
  const currentPrimary = sub3(primaryLm, hipMid);
  const currentComparison = sub3(comparisonLm, hipMid);
  const currentBearing = bearingDeg(currentPrimary);

  if (!ready || ready.direction !== direction) {
    return {
      primarySide: primary,
      comparisonSide: comparison,
      primaryConfidence: vis(primaryLm),
      comparisonConfidence: vis(comparisonLm),
      currentPrimaryBearingDeg: currentBearing,
      startingPrimaryBearingDeg: null,
      primaryChangeDeg: null,
      comparisonChangeDeg: null,
      pelvisChangeDeg: null,
      pelvisSubtractDeg: 0,
      rawTlRomDeg: null,
      baselinePrimaryVector: null,
      currentPrimaryVector: { x: currentPrimary.x, z: currentPrimary.z },
      oldShoulderLineFromReadyDeg: null,
      usingWorldLandmarks: true,
    };
  }

  // Signed XZ angle from READY primary vector → current (atan2(cross, dot)).
  const geometric = signedXZAngleDeg(ready.primaryVector, currentPrimary);
  const comparisonGeometric = signedXZAngleDeg(ready.comparisonVector, currentComparison);
  // Map so trial direction is positive (verified against syntheticSeated right=+).
  const primaryChange = geometric == null ? null : direction === "right" ? -geometric : geometric;
  const comparisonChange = comparisonGeometric == null ? null : direction === "right" ? -comparisonGeometric : comparisonGeometric;

  const pelvis = buildPelvisFrame(sample);
  const pelvisDeltaAbs = pelvis == null ? null : angleDelta(pelvis.yawDeg, ready.pelvisYawDeg);
  // Pelvis in trial-positive convention (same sign flip as primary for consistency).
  const pelvisChange =
    pelvisDeltaAbs == null ? null : direction === "right" ? -pelvisDeltaAbs : pelvisDeltaAbs;

  let pelvisSubtract = 0;
  if (pelvisChange != null && Math.abs(pelvisChange) >= pelvisDeadbandDeg) {
    // Only subtract pelvis that moves in the same direction as the primary (cheating).
    if (primaryChange != null && Math.sign(pelvisChange) === Math.sign(primaryChange)) {
      pelvisSubtract = Math.abs(pelvisChange);
    } else if (primaryChange == null) {
      pelvisSubtract = Math.abs(pelvisChange);
    }
  }

  const rawTl =
    primaryChange == null ? null : Math.max(0, primaryChange - pelvisSubtract);

  const oldLine = oldShoulderAxisYawDeg(sample);
  const oldFromReady =
    oldLine == null || ready.oldShoulderLineYawDeg == null
      ? null
      : angleDelta(oldLine, ready.oldShoulderLineYawDeg);

  return {
    primarySide: primary,
    comparisonSide: comparison,
    primaryConfidence: vis(primaryLm),
    comparisonConfidence: vis(comparisonLm),
    currentPrimaryBearingDeg: currentBearing,
    startingPrimaryBearingDeg: ready.primaryBearingDeg,
    primaryChangeDeg: primaryChange,
    comparisonChangeDeg: comparisonChange,
    pelvisChangeDeg: pelvisChange,
    pelvisSubtractDeg: pelvisSubtract,
    rawTlRomDeg: rawTl,
    baselinePrimaryVector: { x: ready.primaryVector.x, z: ready.primaryVector.z },
    currentPrimaryVector: { x: currentPrimary.x, z: currentPrimary.z },
    oldShoulderLineFromReadyDeg: oldFromReady,
    usingWorldLandmarks: true,
  };
}

/** Horizontal bearing of a vector in XZ (degrees). Debug only — not ROM. */
export function bearingDeg(v: V3): number | null {
  if (xzMag(v) < 1e-6) return null;
  return (Math.atan2(v.x, v.z) * 180) / Math.PI;
}

/**
 * Signed angle from baseline → current in the XZ plane.
 * atan2(cross, dot) with cross = bx*cz − bz*cx.
 */
export function signedXZAngleDeg(baseline: V3, current: V3): number | null {
  const bx = baseline.x;
  const bz = baseline.z;
  const cx = current.x;
  const cz = current.z;
  const bMag = Math.hypot(bx, bz);
  const cMag = Math.hypot(cx, cz);
  if (bMag < 1e-6 || cMag < 1e-6) return null;
  const dot = bx * cx + bz * cz;
  const cross = bx * cz - bz * cx;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function sub3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function xzMag(v: V3): number {
  return Math.hypot(v.x, v.z);
}

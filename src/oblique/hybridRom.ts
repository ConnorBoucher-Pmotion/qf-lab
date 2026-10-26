/**
 * Hybrid TL ROM (validated against blender-validation synthetic grid).
 *
 * BOTH shoulders reliable → shoulder axis vs FROZEN hip axis (algo B).
 * Far shoulder unreliable → visible-shoulder-only vs FROZEN hip midpoint (algo C).
 *
 * Never uses live hip landmarks as the ROM zero reference.
 * Never lets a chin-snapped far shoulder collapse the shoulder axis.
 */

import {
  computeAxisYawRom,
  sealAxisYawBaseline,
  signedAngleXZ,
  xzAxis,
  type AxisYawReadyBaseline,
  type AxisYawReading,
  type XZ,
} from "./axisYawRom";
import { mid, vis } from "./landmarks";
import type { ReadyBaseline as OldPivotBaseline } from "./primaryShoulderRom";
import type { LandmarkSample, OcclusionMode, RotationDirection, ShoulderSide, V3 } from "./types";

export type HybridMode = "BOTH_FROZEN_HIP" | "VISIBLE_SHOULDER" | "UNAVAILABLE";

export type HybridReadyBaseline = AxisYawReadyBaseline & {
  /** Frozen hip midpoint at READY — used by visible-shoulder mode. */
  frozenHipMid: V3;
  primarySide: ShoulderSide;
  comparisonSide: ShoulderSide;
  primaryVector: V3;
  comparisonVector: V3;
};

export type HybridReading = AxisYawReading & {
  hybridMode: HybridMode;
  trustedShoulder: "both" | ShoulderSide | "none";
  visibleShoulderRomDeg: number | null;
  bothShoulderRomDeg: number | null;
  selectedRawRomDeg: number | null;
};

export function sealHybridBaseline(
  sample: LandmarkSample,
  direction: RotationDirection,
  now: number
): HybridReadyBaseline | null {
  const base = sealAxisYawBaseline(sample, direction, now);
  if (!base) return null;
  const hipMid = mid(sample.leftHip, sample.rightHip);
  const primary: ShoulderSide = direction === "right" ? "left" : "right";
  const comparison: ShoulderSide = primary === "left" ? "right" : "left";
  const primaryLm = primary === "left" ? sample.leftShoulder : sample.rightShoulder;
  const comparisonLm = comparison === "left" ? sample.leftShoulder : sample.rightShoulder;
  return {
    ...base,
    frozenHipMid: { x: hipMid.x, y: hipMid.y, z: hipMid.z },
    primarySide: primary,
    comparisonSide: comparison,
    primaryVector: sub3(primaryLm, hipMid),
    comparisonVector: sub3(comparisonLm, hipMid),
  };
}

export function computeHybridRom(
  sample: LandmarkSample,
  baseline: HybridReadyBaseline | null,
  direction: RotationDirection,
  oldPivot: OldPivotBaseline | null,
  opts: {
    leftChinSnap: boolean;
    rightChinSnap: boolean;
    minConfidence: number;
    softConfidence: number;
  }
): HybridReading {
  const axisReading = computeAxisYawRom(sample, baseline, direction, oldPivot);
  const bothRom = axisReading.currentRawRomDeg;

  const leftOk =
    vis(sample.leftShoulder) >= opts.minConfidence && !opts.leftChinSnap;
  const rightOk =
    vis(sample.rightShoulder) >= opts.minConfidence && !opts.rightChinSnap;
  const leftSoft =
    vis(sample.leftShoulder) >= opts.softConfidence && !opts.leftChinSnap;
  const rightSoft =
    vis(sample.rightShoulder) >= opts.softConfidence && !opts.rightChinSnap;

  const far: ShoulderSide = direction === "right" ? "right" : "left";
  const anchor: ShoulderSide = far === "right" ? "left" : "right";
  const farOk = far === "right" ? rightOk : leftOk;
  const anchorSoft = anchor === "left" ? leftSoft : rightSoft;

  const visibleRom = baseline ? visibleShoulderRom(sample, baseline, direction, anchor) : null;

  let hybridMode: HybridMode = "UNAVAILABLE";
  let trusted: HybridReading["trustedShoulder"] = "none";
  let selected: number | null = null;
  let signed = axisReading.signedTlRotationDeg;

  if (leftOk && rightOk && baseline) {
    hybridMode = "BOTH_FROZEN_HIP";
    trusted = "both";
    selected = bothRom;
  } else if (anchorSoft && baseline && visibleRom != null) {
    hybridMode = "VISIBLE_SHOULDER";
    trusted = anchor;
    selected = visibleRom;
    signed = direction === "right" ? visibleRom : -visibleRom;
  } else if (bothRom != null && !farOk) {
    // Far is bad but both-axis still returned something — prefer visible if available.
    hybridMode = visibleRom != null ? "VISIBLE_SHOULDER" : "BOTH_FROZEN_HIP";
    trusted = visibleRom != null ? anchor : leftSoft || rightSoft ? (leftSoft ? "left" : "right") : "none";
    selected = visibleRom ?? bothRom;
  } else {
    hybridMode = bothRom != null ? "BOTH_FROZEN_HIP" : "UNAVAILABLE";
    trusted = leftOk && rightOk ? "both" : leftSoft ? "left" : rightSoft ? "right" : "none";
    selected = bothRom;
  }

  return {
    ...axisReading,
    signedTlRotationDeg: signed,
    currentRawRomDeg: selected,
    hybridMode,
    trustedShoulder: trusted,
    visibleShoulderRomDeg: visibleRom,
    bothShoulderRomDeg: bothRom,
    selectedRawRomDeg: selected,
  };
}

/**
 * Visible-shoulder ROM vs FROZEN hip midpoint (algo C).
 * Uses sealed primaryVector — live hips never redefine zero.
 */
export function visibleShoulderRom(
  sample: LandmarkSample,
  baseline: HybridReadyBaseline,
  direction: RotationDirection,
  anchor: ShoulderSide
): number | null {
  const sh = anchor === "left" ? sample.leftShoulder : sample.rightShoulder;
  const baseVec = anchor === "left" ? baseline.primaryVector : baseline.comparisonVector;
  // Always measure around frozen hip mid — not live hip mid.
  const current = sub3(sh, baseline.frozenHipMid);
  const geometric = signedXZFromVectors(baseVec, current);
  if (geometric == null) return null;
  // Trial-positive magnitude (verified against syntheticSeated / validation lab).
  const trialPositive = direction === "right" ? -geometric : geometric;
  return Math.max(0, trialPositive);
}

export function occlusionModeFromHybrid(mode: HybridMode): OcclusionMode {
  if (mode === "VISIBLE_SHOULDER") return "SINGLE_SHOULDER_ASSISTED";
  if (mode === "BOTH_FROZEN_HIP") return "BOTH_SHOULDERS";
  return "WEIGHTED";
}

function signedXZFromVectors(baseline: V3, current: V3): number | null {
  const a: XZ = { x: baseline.x, z: baseline.z };
  const b: XZ = { x: current.x, z: current.z };
  // Use same atan2(cross,dot) convention as primaryShoulderRom (not the negated axis form).
  const aMag = Math.hypot(a.x, a.z);
  const bMag = Math.hypot(b.x, b.z);
  if (aMag < 1e-6 || bMag < 1e-6) return null;
  const dot = a.x * b.x + a.z * b.z;
  const cross = a.x * b.z - a.z * b.x;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function sub3(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

// Re-export helpers used by tests / overlay.
export { xzAxis, signedAngleXZ };

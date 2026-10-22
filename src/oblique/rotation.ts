import type { LandmarkSample, RotationDirection } from "./types";
import {
  computePrimaryRom,
  primarySide,
  comparisonSide,
  sealReadyBaseline,
  type PrimaryRomReading,
  type ReadyBaseline,
} from "./primaryShoulderRom";

export type { PrimaryRomReading, ReadyBaseline };
export { primarySide, comparisonSide, computePrimaryRom, sealReadyBaseline };

/** Positive magnitude in the active trial direction (already trial-positive input). */
export function directionalRom(signedTrialPositive: number | null, _direction: RotationDirection): number | null {
  if (signedTrialPositive == null || !Number.isFinite(signedTrialPositive)) return null;
  return Math.max(0, signedTrialPositive);
}

export function computeSideSpecificRom(
  sample: LandmarkSample,
  ready: ReadyBaseline | null,
  direction: RotationDirection,
  pelvisDeadbandDeg: number
): PrimaryRomReading {
  return computePrimaryRom(sample, ready, direction, pelvisDeadbandDeg);
}

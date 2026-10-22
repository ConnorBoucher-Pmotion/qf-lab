import type { LandmarkSample, RotationDirection } from "./types";
import {
  computeAxisYawRom,
  sealAxisYawBaseline,
  type AxisYawReading,
  type AxisYawReadyBaseline,
} from "./axisYawRom";
import {
  computePrimaryRom,
  primarySide,
  comparisonSide,
  sealReadyBaseline,
  type ReadyBaseline as OldPivotBaseline,
} from "./primaryShoulderRom";

export type { AxisYawReading, AxisYawReadyBaseline, OldPivotBaseline };
export { primarySide, comparisonSide, computePrimaryRom, sealReadyBaseline };
export { computeAxisYawRom, sealAxisYawBaseline };

/** Positive magnitude already mapped to the trial direction. */
export function directionalRom(signedTrialPositive: number | null, _direction: RotationDirection): number | null {
  if (signedTrialPositive == null || !Number.isFinite(signedTrialPositive)) return null;
  return Math.max(0, signedTrialPositive);
}

export function computeThoraxPelvisRom(
  sample: LandmarkSample,
  baseline: AxisYawReadyBaseline | null,
  direction: RotationDirection,
  oldPivotBaseline: OldPivotBaseline | null
): AxisYawReading {
  return computeAxisYawRom(sample, baseline, direction, oldPivotBaseline);
}

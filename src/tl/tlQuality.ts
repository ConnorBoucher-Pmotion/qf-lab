import { mean, stdev } from "../pose/coordinateNormalization";
import type { TLTrial } from "./tlTypes";

export function goniometerError(measured: number, goniometer: number): { signedError: number; absoluteError: number } {
  const signedError = measured - goniometer;
  return { signedError, absoluteError: Math.abs(signedError) };
}

export type SeriesStats = {
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  sd: number | null;
};

export function describe(values: number[]): SeriesStats {
  if (values.length === 0) return { n: 0, mean: null, min: null, max: null, range: null, sd: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    n: values.length,
    mean: mean(values),
    min,
    max,
    range: max - min,
    sd: values.length >= 2 ? stdev(values) : null,
  };
}

export function agreement(trials: TLTrial[]): { meanCv: number | null; meanGonio: number | null; meanError: number | null; meanAbsoluteError: number | null; n: number } {
  const pairs = trials.filter((trial) => trial.accepted && trial.measuredRom != null && trial.goniometer != null);
  if (pairs.length === 0) return { meanCv: null, meanGonio: null, meanError: null, meanAbsoluteError: null, n: 0 };
  return {
    n: pairs.length,
    meanCv: mean(pairs.map((trial) => trial.measuredRom ?? 0)),
    meanGonio: mean(pairs.map((trial) => trial.goniometer ?? 0)),
    meanError: mean(pairs.map((trial) => trial.signedError ?? 0)),
    meanAbsoluteError: mean(pairs.map((trial) => trial.absoluteError ?? 0)),
  };
}

/** Software tracking confidence, 0–100. Not a clinical score. */
export function trackingConfidence(score: number, hardWarns: number, hardFails: number, held: boolean): number {
  let value = Math.max(0, Math.min(1, score));
  value *= Math.max(0.35, 1 - hardWarns * 0.06);
  value *= hardFails > 0 ? 0.72 : 1;
  if (held) value *= 0.9;
  return Math.round(value * 100);
}

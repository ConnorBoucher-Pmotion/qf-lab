import { mean, median, stdev } from "../pose/coordinateNormalization";

/**
 * Repeatability and goniometer agreement. Analysis only. Nothing here
 * corrects the measurement. The (CV, goniometer) pairs are collected so a
 * future `corrected = a·CV + b` can be fitted from real data.
 */

export type Stats = {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  range: number | null;
  min: number | null;
  max: number | null;
  /** Coefficient of variation, %. Unstable when the mean is near 0. */
  cvPercent: number | null;
  /** Largest absolute difference between consecutive trials. */
  maxConsecutiveDiff: number | null;
  /** Largest difference between any two trials (= range). */
  maxPairDiff: number | null;
};

export function describe(values: number[]): Stats {
  const n = values.length;
  if (n === 0) {
    return { n, mean: null, median: null, sd: null, range: null, min: null, max: null, cvPercent: null, maxConsecutiveDiff: null, maxPairDiff: null };
  }
  const m = mean(values);
  const sd = n >= 2 ? stdev(values) : null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  let maxConsecutiveDiff: number | null = null;
  for (let i = 1; i < n; i += 1) {
    const d = Math.abs(values[i] - values[i - 1]);
    maxConsecutiveDiff = maxConsecutiveDiff == null ? d : Math.max(maxConsecutiveDiff, d);
  }
  return {
    n,
    mean: m,
    median: median(values),
    sd,
    range: max - min,
    min,
    max,
    cvPercent: sd != null && Math.abs(m) > 1 ? (sd / Math.abs(m)) * 100 : null,
    maxConsecutiveDiff,
    maxPairDiff: n >= 2 ? max - min : null,
  };
}

export type BiasVerdict = "too-few" | "agrees" | "consistent-offset" | "inconsistent";

export type BiasReport = {
  n: number;
  /** Mean of (CV − goniometer). */
  bias: number | null;
  errorSd: number | null;
  meanAbsoluteError: number | null;
  /** Bland–Altman 95% limits of agreement. */
  loaLow: number | null;
  loaHigh: number | null;
  /** Least-squares goniometer ≈ slope·CV + intercept. Reported only; never applied. */
  fit: { slope: number; intercept: number; r2: number } | null;
  verdict: BiasVerdict;
  explanation: string;
};

/**
 * Verdict thresholds (provisional):
 *   agrees             |bias| ≤ 3° and error SD ≤ 3°
 *   consistent-offset  error SD ≤ 3° but |bias| > 3°: a calibration offset (a·CV + b) could fix it
 *   inconsistent       error SD > 3°: random error; a correction would not help, so tracking/setup must improve
 */
export function goniometerBias(pairs: Array<{ cv: number; gonio: number }>): BiasReport {
  const n = pairs.length;
  if (n < 3) {
    const errors = pairs.map((p) => p.cv - p.gonio);
    return {
      n,
      bias: n ? mean(errors) : null,
      errorSd: n >= 2 ? stdev(errors) : null,
      meanAbsoluteError: n ? mean(errors.map(Math.abs)) : null,
      loaLow: null,
      loaHigh: null,
      fit: null,
      verdict: "too-few",
      explanation: "Enter goniometer values for at least 3 accepted trials.",
    };
  }
  const errors = pairs.map((p) => p.cv - p.gonio);
  const bias = mean(errors);
  const errorSd = stdev(errors);
  const verdict: BiasVerdict = errorSd > 3 ? "inconsistent" : Math.abs(bias) > 3 ? "consistent-offset" : "agrees";
  const explanation =
    verdict === "agrees"
      ? "Camera and goniometer agree within about 3°."
      : verdict === "consistent-offset"
        ? `Camera reads ${bias > 0 ? "high" : "low"} by about ${Math.abs(bias).toFixed(1)}° with a consistent error. A future calibration could correct it; nothing is applied now.`
        : "Error varies trial to trial. This is random error, so improve tracking or setup before any correction.";
  return {
    n,
    bias,
    errorSd,
    meanAbsoluteError: mean(errors.map(Math.abs)),
    loaLow: bias - 1.96 * errorSd,
    loaHigh: bias + 1.96 * errorSd,
    fit: linearFit(pairs.map((p) => p.cv), pairs.map((p) => p.gonio)),
    verdict,
    explanation,
  };
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } | null {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx < 1e-9) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy < 1e-9 ? 1 : (sxy * sxy) / (sxx * syy) };
}

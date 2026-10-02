import { median, stdev } from "../pose/coordinateNormalization";
import type { QFConfig } from "./qfConfig";
import { ANGLE_METHODS, emptyAngles, type AngleMethod, type QFAngleSet } from "./qfMeasurementEngine";
import type { CheckStatus, HoldAnalysis, HoldSummary } from "./qfTypes";

/**
 * Stable hold detection.
 *
 * The run is the longest stretch ending at the latest frame where the
 * filtered primary angle stays within `holdToleranceDeg` peak-to-peak, with
 * no gap in valid frames longer than `maxHoldGapMs`. The hold is stable when:
 *   - run duration ≥ holdMs, and frames ≥ minHoldFrames
 *   - |least-squares slope| ≤ maxHoldVelocityDegPerSec (rejects a slow pull)
 *   - run median ≥ attempt peak − endRangeToleranceDeg (the athlete is at end range)
 * The result for each method is the median of its clean (outlier-free,
 * unsmoothed) values over the run.
 */

export type HoldSample = {
  t: number;
  filtered: number;
  clean: QFAngleSet;
  soft: Record<string, CheckStatus>;
};

const KEEP_MS = 10_000;

export class HoldTracker {
  private samples: HoldSample[] = [];
  private peak: number | null = null;

  reset(): void {
    this.samples = [];
    this.peak = null;
  }

  /** Ends the current run (hard fail, tracking warning). The attempt peak is kept. */
  breakRun(): void {
    this.samples = [];
  }

  get peakDeg(): number | null {
    return this.peak;
  }

  push(sample: HoldSample): void {
    this.samples.push(sample);
    this.peak = this.peak == null ? sample.filtered : Math.max(this.peak, sample.filtered);
    const cutoff = sample.t - KEEP_MS;
    while (this.samples.length > 1 && this.samples[0].t < cutoff) this.samples.shift();
  }

  private run(config: QFConfig): HoldSample[] {
    const n = this.samples.length;
    if (n === 0) return [];
    let lo = this.samples[n - 1].filtered;
    let hi = lo;
    let start = n - 1;
    for (let i = n - 2; i >= 0; i -= 1) {
      const s = this.samples[i];
      if (this.samples[i + 1].t - s.t > config.maxHoldGapMs) break;
      const nlo = Math.min(lo, s.filtered);
      const nhi = Math.max(hi, s.filtered);
      if (nhi - nlo > config.holdToleranceDeg) break;
      lo = nlo;
      hi = nhi;
      start = i;
    }
    return this.samples.slice(start);
  }

  analyze(config: QFConfig): HoldAnalysis {
    const run = this.run(config);
    if (run.length === 0) {
      return { runMs: 0, runFrames: 0, rangeDeg: 0, slopeDegPerSec: null, slopeOk: false, peakDeg: this.peak, runMedianDeg: null, nearPeak: false, stable: false, progress: 0 };
    }
    const values = run.map((s) => s.filtered);
    const runMs = run[run.length - 1].t - run[0].t;
    const slope = slopeDegPerSec(run);
    const slopeOk = slope != null && Math.abs(slope) <= config.maxHoldVelocityDegPerSec;
    const runMedianDeg = median(values);
    const nearPeak = this.peak == null || runMedianDeg >= this.peak - config.endRangeToleranceDeg;
    const stable = runMs >= config.holdMs && run.length >= config.minHoldFrames && slopeOk && nearPeak;
    const progress = slopeOk && nearPeak ? Math.min(1, runMs / config.holdMs) : Math.min(0.5, runMs / config.holdMs);
    return {
      runMs,
      runFrames: run.length,
      rangeDeg: Math.max(...values) - Math.min(...values),
      slopeDegPerSec: slope,
      slopeOk,
      peakDeg: this.peak,
      runMedianDeg,
      nearPeak,
      stable,
      progress,
    };
  }

  summarize(config: QFConfig, primary: AngleMethod): HoldSummary | null {
    const run = this.run(config);
    if (run.length === 0) return null;
    const angles = emptyAngles();
    for (const method of ANGLE_METHODS) {
      const values = run.map((s) => s.clean[method]).filter((v): v is number => v != null);
      angles[method] = values.length ? median(values) : null;
    }
    const primaryClean = run.map((s) => s.clean[primary]).filter((v): v is number => v != null);
    const filtered = run.map((s) => s.filtered);
    const softWarnings: HoldSummary["softWarnings"] = {};
    for (const sample of run) {
      for (const [id, status] of Object.entries(sample.soft)) {
        const entry = (softWarnings[id] ??= { warn: 0, fail: 0 });
        if (status === "warn") entry.warn += 1 / run.length;
        if (status === "fail") entry.fail += 1 / run.length;
      }
    }
    for (const [id, entry] of Object.entries(softWarnings)) {
      if (entry.warn === 0 && entry.fail === 0) delete softWarnings[id];
    }
    return {
      angles,
      frames: run.length,
      durationMs: run[run.length - 1].t - run[0].t,
      sdDeg: stdev(primaryClean),
      rangeDeg: Math.max(...filtered) - Math.min(...filtered),
      slopeDegPerSec: slopeDegPerSec(run),
      outlierFrames: run.length - primaryClean.length,
      cleanFraction: primaryClean.length / run.length,
      peakDeg: this.peak,
      softWarnings,
    };
  }
}

function slopeDegPerSec(run: HoldSample[]): number | null {
  if (run.length < 3) return null;
  const t0 = run[0].t;
  const xs = run.map((s) => (s.t - t0) / 1000);
  const ys = run.map((s) => s.filtered);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den < 1e-9 ? null : num / den;
}

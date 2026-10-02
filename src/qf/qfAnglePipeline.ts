import { median } from "../pose/coordinateNormalization";
import { OneEuroFilter } from "../pose/oneEuro";
import type { QFConfig } from "./qfConfig";
import { ANGLE_METHODS, emptyAngles, type QFAngleSet } from "./qfMeasurementEngine";

/**
 * Per-method angle stage. Runs after the landmark filter:
 *
 *   gated landmarks → angle (raw) → Hampel outlier test (clean) → smoothing (filtered)
 *
 * Hampel test: a value further than max(angleOutlierDeg, 3·1.4826·MAD) from
 * the median of the last `angleOutlierWindow` accepted values is an outlier.
 * Outliers produce clean = null, and the filtered value is held. If the jump
 * persists for `reacquireFrames`, it is real movement and is accepted. The gate
 * widens automatically while the angle is moving, because the MAD grows.
 *
 * The final result uses the clean values, not the filtered ones, so smoothing
 * lag can't bias the reported angle.
 */

const MIN_HISTORY = 3;
const RESET_GAP_MS = 500;

export class AngleChannel {
  private history: number[] = [];
  private outlierRun = 0;
  private euro = new OneEuroFilter(1, 0.05);
  private ema: number | null = null;
  private filtered: number | null = null;
  private lastT: number | null = null;

  reset(): void {
    this.history = [];
    this.outlierRun = 0;
    this.euro.reset();
    this.ema = null;
    this.filtered = null;
    this.lastT = null;
  }

  push(value: number | null, tMs: number, config: QFConfig): { clean: number | null; filtered: number | null; outlier: boolean } {
    if (value == null || !Number.isFinite(value)) return { clean: null, filtered: this.filtered, outlier: false };
    if (this.lastT != null && tMs - this.lastT > RESET_GAP_MS) this.reset();
    this.lastT = tMs;

    if (this.history.length >= MIN_HISTORY) {
      const center = median(this.history);
      const mad = median(this.history.map((v) => Math.abs(v - center)));
      const limit = Math.max(config.angleOutlierDeg, 3 * 1.4826 * mad);
      if (Math.abs(value - center) > limit) {
        this.outlierRun += 1;
        if (this.outlierRun < config.reacquireFrames) return { clean: null, filtered: this.filtered, outlier: true };
        this.history = [];
        this.euro.reset();
        this.ema = null;
      }
    }
    this.outlierRun = 0;
    this.history.push(value);
    while (this.history.length > config.angleOutlierWindow) this.history.shift();

    this.euro.minCutoff = config.angleMinCutoffHz;
    this.euro.beta = config.angleBeta;
    const euro = this.euro.filter(value, tMs);
    this.ema = this.ema == null ? value : this.ema + config.angleEmaAlpha * (value - this.ema);
    this.filtered = config.angleFilter === "oneEuro" ? euro : config.angleFilter === "ema" ? this.ema : value;
    return { clean: value, filtered: this.filtered, outlier: false };
  }
}

export type AngleStep = { raw: QFAngleSet; clean: QFAngleSet; filtered: QFAngleSet; outliers: number };

export class AnglePipeline {
  private channels = Object.fromEntries(ANGLE_METHODS.map((m) => [m, new AngleChannel()])) as Record<
    (typeof ANGLE_METHODS)[number],
    AngleChannel
  >;

  reset(): void {
    for (const method of ANGLE_METHODS) this.channels[method].reset();
  }

  push(raw: QFAngleSet, tMs: number, config: QFConfig): AngleStep {
    const clean = emptyAngles();
    const filtered = emptyAngles();
    let outliers = 0;
    for (const method of ANGLE_METHODS) {
      const out = this.channels[method].push(raw[method], tMs, config);
      clean[method] = out.clean;
      filtered[method] = raw[method] == null ? null : out.filtered;
      if (out.outlier) outliers += 1;
    }
    return { raw, clean, filtered, outliers };
  }
}

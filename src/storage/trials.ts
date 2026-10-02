import { normalizeConfig, type QFConfig } from "../qf/qfConfig";
import { emptyAngles } from "../qf/qfMeasurementEngine";
import { goniometerError } from "../qf/qfQuality";
import type { Trial } from "../qf/qfTypes";

const KEY = "qf-lab.trials.v2";
const LEGACY_KEY = "qf-lab.trials.v1";
const CONFIG_KEY = "qf-lab.config.v3";
const SERIES_KEY = "qf-lab.series.v2";
export const LEGACY_SERIES = "Before update";

export function loadTrials(): Trial[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Trial[];
      return Array.isArray(parsed) ? parsed : [];
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const old = JSON.parse(legacy) as Array<Record<string, unknown>>;
    if (!Array.isArray(old)) return [];
    const migrated = old.map((t, i) => migrate(t, old.length - i));
    saveTrials(migrated);
    return migrated;
  } catch {
    return [];
  }
}

function migrate(t: Record<string, unknown>, trialNumber: number): Trial {
  const angles = emptyAngles();
  if (typeof t.measuredRom === "number") angles.relative2d = t.measuredRom;
  if (typeof t.absoluteFromVertical === "number") angles.absolute2d = t.absoluteFromVertical;
  return {
    version: 2,
    id: String(t.id ?? `legacy-${trialNumber}`),
    timestamp: String(t.timestamp ?? new Date(0).toISOString()),
    side: t.side === "left" ? "left" : "right",
    series: LEGACY_SERIES,
    trialNumber,
    accepted: Boolean(t.accepted),
    primaryMethod: "relative2d",
    measuredRom: typeof t.measuredRom === "number" ? t.measuredRom : null,
    angles,
    hold: null,
    rawMaximum: typeof t.rawMaximum === "number" ? t.rawMaximum : null,
    confidence: typeof t.confidence === "number" ? t.confidence : 0,
    failedConstraints: Array.isArray(t.failedConstraints) ? (t.failedConstraints as string[]) : [],
    camera: null,
    baseline: null,
    constraintValues: (t.constraintValues as Record<string, number | null>) ?? {},
    thresholds: (t.thresholds as Record<string, unknown>) ?? {},
    instruction: String(t.instruction ?? ""),
    goniometer: typeof t.goniometer === "number" ? t.goniometer : null,
    absoluteError: typeof t.absoluteError === "number" ? t.absoluteError : null,
    signedError: typeof t.signedError === "number" ? t.signedError : null,
    percentError: typeof t.percentError === "number" ? t.percentError : null,
  };
}

export function saveTrials(trials: Trial[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trials));
  } catch {
    // Storage full or disabled: trials stay in memory for this session.
  }
}

export function withGoniometer(trial: Trial, goniometer: number | null): Trial {
  if (goniometer == null || !Number.isFinite(goniometer) || trial.measuredRom == null || !trial.accepted) {
    return { ...trial, goniometer: goniometer != null && Number.isFinite(goniometer) ? goniometer : null, absoluteError: null, signedError: null, percentError: null };
  }
  return { ...trial, goniometer, ...goniometerError(trial.measuredRom, goniometer) };
}

export function loadConfig(): QFConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return normalizeConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeConfig({});
  }
}

export function saveConfig(config: QFConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function loadSeries(): string {
  try {
    return localStorage.getItem(SERIES_KEY) || "A · ideal";
  } catch {
    return "A · ideal";
  }
}

export function saveSeries(series: string): void {
  try {
    localStorage.setItem(SERIES_KEY, series);
  } catch {
    // ignore
  }
}

export function download(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

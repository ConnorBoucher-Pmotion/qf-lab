import { normalizeConfig, type TLConfig } from "../tl/tlConfig";
import type { TLTrial } from "../tl/tlTypes";
import { goniometerError } from "../tl/tlQuality";

const TRIALS = "tl-lab.trials.v1";
const CONFIG = "tl-lab.config.v1";
const SERIES = "tl-lab.series.v1";

export function loadTrials(): TLTrial[] {
  try {
    const raw = localStorage.getItem(TRIALS);
    const parsed = raw ? (JSON.parse(raw) as TLTrial[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTrials(trials: TLTrial[]): void {
  try {
    localStorage.setItem(TRIALS, JSON.stringify(trials));
  } catch {
    // Stay in memory if storage is full.
  }
}

export function loadConfig(): TLConfig {
  try {
    const raw = localStorage.getItem(CONFIG);
    return normalizeConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeConfig({});
  }
}

export function saveConfig(config: TLConfig): void {
  try {
    localStorage.setItem(CONFIG, JSON.stringify(config));
  } catch {
    // Ignore private-mode storage failures.
  }
}

export function loadSeries(): string {
  try {
    return localStorage.getItem(SERIES) || "TL 1";
  } catch {
    return "TL 1";
  }
}

export function saveSeries(series: string): void {
  try {
    localStorage.setItem(SERIES, series);
  } catch {
    // Ignore.
  }
}

export function withGoniometer(trial: TLTrial, goniometer: number | null): TLTrial {
  if (goniometer == null || !Number.isFinite(goniometer) || trial.measuredRom == null) {
    return { ...trial, goniometer: goniometer != null && Number.isFinite(goniometer) ? goniometer : null, absoluteError: null, signedError: null };
  }
  return { ...trial, goniometer, ...goniometerError(trial.measuredRom, goniometer) };
}

export function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

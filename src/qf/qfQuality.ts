import type { ConstraintCheck, HoldSummary, TrackingStatus } from "./qfTypes";

export type QualityReport = {
  score: number;
  hardFailed: boolean;
  failedIds: string[];
  /** Plain-language deductions so the score is never a black box. */
  deductions: Array<{ reason: string; points: number }>;
};

/**
 * Heuristic 0–100 trust score. Not a statistical confidence interval.
 * Any hard failure → 0. Otherwise 100, minus:
 *   tracking:       up to 30 when critical landmarks are near their thresholds
 *   soft warn/fail: 4 / 12 each (live), or weighted by the fraction of the hold spent there
 *   hold quality:   SD of the hold frames over 0.5°, and outlier frames
 */
export function scoreQuality(checks: ConstraintCheck[], tracking: TrackingStatus, hold: HoldSummary | null = null): QualityReport {
  const hard = checks.filter((check) => check.category === "hard" && check.status === "fail");
  const failedIds = checks.filter((check) => check.status === "fail" && check.category !== "info").map((check) => check.id);
  if (hard.length > 0) {
    return { score: 0, hardFailed: true, failedIds, deductions: hard.map((check) => ({ reason: `${check.label} (hard)`, points: 100 })) };
  }
  const deductions: QualityReport["deductions"] = [];
  if (tracking.present && tracking.score < 1) {
    deductions.push({ reason: "Tracking confidence", points: Math.round((1 - tracking.score) * 30) });
  }
  if (hold) {
    for (const [id, share] of Object.entries(hold.softWarnings)) {
      const points = Math.round(share.warn * 4 + share.fail * 12);
      if (points > 0) deductions.push({ reason: `${labelFor(checks, id)} during hold`, points });
    }
    if (hold.sdDeg > 0.5) deductions.push({ reason: "Hold variability", points: Math.round(Math.min(20, (hold.sdDeg - 0.5) * 10)) });
    if (hold.cleanFraction < 1) deductions.push({ reason: "Outlier frames in hold", points: Math.round((1 - hold.cleanFraction) * 30) });
  } else {
    for (const check of checks) {
      if (check.category !== "soft") continue;
      if (check.status === "warn") deductions.push({ reason: check.label, points: 4 });
      if (check.status === "fail") deductions.push({ reason: check.label, points: 12 });
    }
  }
  const score = Math.round(Math.max(0, Math.min(100, 100 - deductions.reduce((sum, d) => sum + d.points, 0))));
  return { score, hardFailed: false, failedIds, deductions };
}

function labelFor(checks: ConstraintCheck[], id: string): string {
  return checks.find((check) => check.id === id)?.label ?? id;
}

export function goniometerError(measured: number, goniometer: number): {
  absoluteError: number;
  signedError: number;
  percentError: number | null;
} {
  const signedError = measured - goniometer;
  return {
    absoluteError: Math.abs(signedError),
    signedError,
    percentError: goniometer === 0 ? null : (signedError / goniometer) * 100,
  };
}

import type { ConstraintCheck, TrackingStatus } from "./qfTypes";

/**
 * Picks the single athlete-facing sentence. Priority:
 *   hard fail > hard warn > soft fail > soft warn > fallback.
 * The debug panel always lists every check; this is only the headline.
 */
const PRIORITY = [
  "pelvis-tilt",
  "knee-lateral",
  "shank-short",
  "pelvis-translation",
  "femur-position",
  "pelvis-rotation",
  "torso-lean",
  "torso-rotation",
  "movement-plane",
  "shank-long",
  "knee-flexion",
  "other-leg",
  "camera-distance",
];

function rank(check: ConstraintCheck): number {
  const index = PRIORITY.indexOf(check.id);
  const base = index === -1 ? PRIORITY.length : index;
  const hard = check.category === "hard";
  if (hard && check.status === "fail") return base;
  if (hard && check.status === "warn") return 100 + base;
  if (check.status === "fail") return 200 + base;
  if (check.status === "warn") return 300 + base;
  return 1000;
}

export function primaryAthleteMessage(checks: ConstraintCheck[], fallback: string): string {
  const best = [...checks].filter((c) => c.category === "hard" || c.category === "soft").sort((a, b) => rank(a) - rank(b))[0];
  return best && rank(best) < 1000 ? best.message : fallback;
}

/** Setup instructions, worst blocking item first. */
export function setupMessage(checks: ConstraintCheck[], fallback: string): string {
  const blocking = checks.find((c) => c.category === "setup" && c.blocking && c.status === "fail");
  if (blocking) return blocking.message;
  return fallback;
}

export function trackingMessage(tracking: TrackingStatus): string {
  const worst = tracking.groups.find((g) => g.critical && !g.ok);
  if (!worst) return "Tracking weak; hold still.";
  return worst.inFrame ? `${worst.label} tracking weak; hold still.` : `${worst.label} left the frame.`;
}

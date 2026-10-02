import type { QFStateName } from "../qf/qfTypes";

export type RecMode = "off" | "preroll" | "keep" | "post";

export type RecIntent =
  | "idle"
  | "start-preroll"
  | "recycle-preroll"
  | "promote"
  | "start-keep"
  | "arm-post"
  | "finish-now"
  | "discard"
  | "discard-then-preroll";

const PREROLL: ReadonlySet<QFStateName> = new Set(["CALIBRATING", "READY", "ARMED"]);
const KEEP: ReadonlySet<QFStateName> = new Set(["MEASURING", "HOLDING", "VALIDATING", "TRACKING_WARNING"]);

/**
 * What the recorder should do for this assessment state.
 * Pre-roll covers the still start. The kept file begins once the foot starts moving.
 * Returning to READY without a result throws that clip away.
 */
export function recordingIntent(mode: RecMode, state: QFStateName, elapsedMs: number, preRollMs: number): RecIntent {
  if (mode === "post") return state === "RESULT" || state === "INVALID" ? "idle" : "finish-now";

  if (KEEP.has(state)) {
    if (mode === "keep") return "idle";
    if (mode === "preroll") return "promote";
    return "start-keep";
  }

  if (state === "RESULT" || state === "INVALID") {
    if (mode === "keep" || mode === "preroll") return "arm-post";
    return "idle";
  }

  if (PREROLL.has(state)) {
    if (preRollMs <= 0) return mode === "off" ? "idle" : "discard";
    if (mode === "off") return "start-preroll";
    if (mode === "preroll") return elapsedMs >= preRollMs ? "recycle-preroll" : "idle";
    return "discard-then-preroll";
  }

  return mode === "off" ? "idle" : "discard";
}

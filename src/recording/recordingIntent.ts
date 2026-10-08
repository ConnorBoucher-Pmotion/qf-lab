import type { TLStateName } from "../tl/tlTypes";

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

const PREROLL: ReadonlySet<TLStateName> = new Set(["STABLE", "CALIBRATING", "READY", "COUNTDOWN"]);
const KEEP: ReadonlySet<TLStateName> = new Set(["MEASURING", "PEAK", "HOLD", "TRACKING_LOST"]);

/** Pre-roll covers neutral calibration. The kept file continues once rotation starts. */
export function recordingIntent(mode: RecMode, state: TLStateName, elapsedMs: number, preRollMs: number): RecIntent {
  if (mode === "post") return state === "COMPLETE" || state === "INVALID" ? "idle" : "finish-now";

  if (KEEP.has(state)) {
    if (mode === "keep") return "idle";
    if (mode === "preroll") return "promote";
    return "start-keep";
  }

  if (state === "COMPLETE" || state === "INVALID") {
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

import { LM, jointIndex, type Side, type Vec } from "../pose/types";
import type { QFConfig } from "./qfConfig";
import type { TrackingGroup, TrackingGroupId, TrackingStatus } from "./qfTypes";

/**
 * Temporal landmark confidence.
 *
 * Confidence is the smoothed visibility from the landmark filter. One weak
 * frame changes nothing. A group must stay below its threshold for
 * `confidenceGraceMs` before it counts as bad. The state machine then:
 *   - pauses the hold (TRACKING_WARNING) while it is bad
 *   - rejects the trial ("Measurement unavailable — reposition camera.") once bad for `trackingLostMs`
 * Knee, ankle, and hips are critical. Shoulders only affect torso checks.
 */

type GroupDef = { id: TrackingGroupId; label: string; critical: boolean; indexes: (side: Side) => number[]; threshold: (c: QFConfig) => number };

const GROUPS: GroupDef[] = [
  { id: "knee", label: "Tested knee", critical: true, indexes: (s) => [jointIndex(s, "knee")], threshold: (c) => c.kneeConfidence },
  { id: "ankle", label: "Tested ankle", critical: true, indexes: (s) => [jointIndex(s, "ankle")], threshold: (c) => c.ankleConfidence },
  { id: "hips", label: "Both hips", critical: true, indexes: () => [LM.leftHip, LM.rightHip], threshold: (c) => c.hipConfidence },
  {
    id: "shoulders",
    label: "Shoulders",
    critical: false,
    indexes: () => [LM.leftShoulder, LM.rightShoulder],
    threshold: (c) => c.shoulderConfidence,
  },
];

/** Landmarks a little outside the frame are still tracked by MediaPipe; beyond this they are guesses. */
const OUT_OF_FRAME = 0.02;

export function emptyTracking(): TrackingStatus {
  return { present: false, absentMs: 0, groups: [], criticalOk: false, criticalBadMs: 0, worstCritical: null, score: 0 };
}

export class TrackingMonitor {
  private badSince: Partial<Record<TrackingGroupId, number>> = {};
  private firstAbsent: number | null = null;

  reset(): void {
    this.badSince = {};
    this.firstAbsent = null;
  }

  update(image: Vec[] | null, width: number, height: number, side: Side, config: QFConfig, tMs: number): TrackingStatus {
    if (!image || image.length < 33) {
      if (this.firstAbsent == null) this.firstAbsent = tMs;
      return { ...emptyTracking(), absentMs: tMs - this.firstAbsent };
    }
    this.firstAbsent = null;

    const groups: TrackingGroup[] = GROUPS.map((def) => {
      const points = def.indexes(side).map((index) => image[index]);
      const confidence = Math.min(...points.map((p) => p.visibility));
      const inFrame = points.every(
        (p) => p.x >= -OUT_OF_FRAME * width && p.x <= (1 + OUT_OF_FRAME) * width && p.y >= -OUT_OF_FRAME * height && p.y <= (1 + OUT_OF_FRAME) * height
      );
      const threshold = def.threshold(config);
      const weak = confidence < threshold || !inFrame;
      if (weak) {
        if (this.badSince[def.id] == null) this.badSince[def.id] = tMs;
      } else {
        delete this.badSince[def.id];
      }
      const badMs = weak ? tMs - (this.badSince[def.id] ?? tMs) : 0;
      return {
        id: def.id,
        label: def.label,
        critical: def.critical,
        confidence,
        threshold,
        inFrame,
        ok: !weak || badMs < config.confidenceGraceMs,
        badMs,
      };
    });

    const critical = groups.filter((g) => g.critical);
    const criticalBadMs = Math.max(0, ...critical.map((g) => g.badMs));
    const worstCritical = critical.reduce<TrackingGroup | null>(
      (worst, g) => (worst == null || g.confidence / g.threshold < worst.confidence / worst.threshold ? g : worst),
      null
    );
    const score = Math.max(0, Math.min(1, ...critical.map((g) => (g.inFrame ? Math.min(1, g.confidence / Math.max(0.05, g.threshold * 2)) : 0))));
    return {
      present: true,
      absentMs: 0,
      groups,
      criticalOk: critical.every((g) => g.ok),
      criticalBadMs,
      worstCritical,
      score,
    };
  }
}

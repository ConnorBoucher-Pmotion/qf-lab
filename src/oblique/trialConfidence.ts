import { confidenceBand, type ConfidenceBand, type TrialFrameSample } from "./trialTypes";

export type ConfidenceBreakdown = {
  score: number;
  band: ConfidenceBand;
  landmarkConfidence: number;
  visibilityRatio: number;
  occlusionPenalty: number;
  rejectRatio: number;
  stability: number;
  pelvisStability: number;
  continuity: number;
  collapsePenalty: number;
  movementCaptured: number;
};

/**
 * Multi-signal trial confidence 0–100.
 * Does not discard raw ROM — research keeps the measurement either way.
 */
export function scoreTrialConfidence(input: {
  samples: TrialFrameSample[];
  rawMaxRom: number | null;
  occlusionEventCount: number;
  rejectedFrameCount: number;
  totalFrameCount: number;
  maxPelvisDeviationDeg: number;
}): ConfidenceBreakdown {
  const samples = input.samples;
  const n = samples.length || 1;

  const landmarkConfidence =
    samples.reduce(
      (sum, s) =>
        sum +
        (s.leftShoulderConfidence + s.rightShoulderConfidence + s.leftHipConfidence + s.rightHipConfidence) / 4,
      0
    ) / n;

  const visibleEnough = samples.filter(
    (s) =>
      (s.trustedShoulder === "both"
        ? s.leftShoulderConfidence >= 0.35 && s.rightShoulderConfidence >= 0.35
        : s.trustedShoulder === "left"
          ? s.leftShoulderConfidence >= 0.35
          : s.trustedShoulder === "right"
            ? s.rightShoulderConfidence >= 0.35
            : false) &&
      s.leftHipConfidence >= 0.3 &&
      s.rightHipConfidence >= 0.3
  ).length;
  const visibilityRatio = visibleEnough / n;

  const occlusionPenalty = Math.min(1, input.occlusionEventCount / Math.max(1, input.totalFrameCount));
  const rejectRatio = input.totalFrameCount ? input.rejectedFrameCount / input.totalFrameCount : 0;

  // Frame-to-frame shoulder stability (lower jump → higher score).
  let jumpSum = 0;
  let jumpN = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const jl = Math.hypot(b.leftShoulderX - a.leftShoulderX, b.leftShoulderY - a.leftShoulderY, b.leftShoulderZ - a.leftShoulderZ);
    const jr = Math.hypot(b.rightShoulderX - a.rightShoulderX, b.rightShoulderY - a.rightShoulderY, b.rightShoulderZ - a.rightShoulderZ);
    jumpSum += (jl + jr) / 2;
    jumpN += 1;
  }
  const meanJump = jumpN ? jumpSum / jumpN : 0;
  const stability = Math.max(0, 1 - meanJump / 0.08);

  const pelvisStability = Math.max(0, 1 - Math.min(1, input.maxPelvisDeviationDeg / 20));

  // Continuity: fraction of frames with a finite raw ROM.
  const withRom = samples.filter((s) => s.rawRom != null && Number.isFinite(s.rawRom)).length;
  const continuity = withRom / n;

  // Sudden collapse: large drop from recent peak within a few frames.
  let collapseHits = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!.rawRom;
    const cur = samples[i]!.rawRom;
    if (prev != null && cur != null && prev >= 20 && cur < prev * 0.35) collapseHits += 1;
  }
  const collapsePenalty = Math.min(1, collapseHits / 3);

  const movementCaptured = input.rawMaxRom != null && input.rawMaxRom >= 10 ? 1 : input.rawMaxRom != null && input.rawMaxRom > 0 ? 0.55 : 0.15;

  const score01 =
    landmarkConfidence * 0.2 +
    visibilityRatio * 0.15 +
    (1 - occlusionPenalty) * 0.12 +
    (1 - rejectRatio) * 0.15 +
    stability * 0.1 +
    pelvisStability * 0.08 +
    continuity * 0.1 +
    (1 - collapsePenalty) * 0.05 +
    movementCaptured * 0.05;

  const score = Math.round(Math.max(0, Math.min(1, score01)) * 100);
  return {
    score,
    band: confidenceBand(score),
    landmarkConfidence,
    visibilityRatio,
    occlusionPenalty,
    rejectRatio,
    stability,
    pelvisStability,
    continuity,
    collapsePenalty,
    movementCaptured,
  };
}

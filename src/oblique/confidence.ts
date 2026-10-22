export function measurementConfidence(input: {
  shoulderScore: number;
  hipScore: number;
  validFrameRatio: number;
  occlusionEventRatio: number;
  pelvisStableRatio: number;
  endRangeClear: boolean;
}): number {
  const base =
    input.shoulderScore * 0.3 +
    input.hipScore * 0.2 +
    input.validFrameRatio * 0.25 +
    input.pelvisStableRatio * 0.15 +
    (1 - Math.min(1, input.occlusionEventRatio)) * 0.1;
  const withEnd = input.endRangeClear ? base : base * 0.92;
  return Math.round(Math.max(0, Math.min(1, withEnd)) * 100);
}

import type { ObliqueConfig } from "./config";
import { add, copyVec, dist, scale, sub, vis } from "./landmarks";
import type { LandmarkSample, ObliqueBaseline, OcclusionMode, RotationDirection, ShoulderSide } from "./types";

export type OcclusionResult = {
  sample: LandmarkSample;
  mode: OcclusionMode;
  reliableShoulder: "both" | ShoulderSide | "none";
  leftReconstructed: boolean;
  rightReconstructed: boolean;
  occlusionActive: boolean;
};

/**
 * Confidence-aware shoulder handling for the expected occluded side.
 * RIGHT rotation → RIGHT may weaken; LEFT stays the anchor.
 * Does not invent huge Z jumps — reconstructed shoulder keeps last reliable span.
 */
export class OcclusionHandler {
  private lastGood: LandmarkSample | null = null;
  private lastSpan: { x: number; y: number; z: number } | null = null;

  reset(): void {
    this.lastGood = null;
    this.lastSpan = null;
  }

  apply(
    sample: LandmarkSample,
    direction: RotationDirection,
    baseline: ObliqueBaseline | null,
    config: ObliqueConfig
  ): OcclusionResult {
    const min = config.landmarkConfidence;
    const soft = config.softLandmarkConfidence;
    const leftChin = baseline ? looksLikeChinSnap(sample, "left", baseline, config) : false;
    const rightChin = baseline ? looksLikeChinSnap(sample, "right", baseline, config) : false;
    const leftOk = vis(sample.leftShoulder) >= min && !leftChin;
    const rightOk = vis(sample.rightShoulder) >= min && !rightChin;
    const leftSoft = vis(sample.leftShoulder) >= soft && !leftChin;
    const rightSoft = vis(sample.rightShoulder) >= soft && !rightChin;

    if (leftOk && rightOk) {
      this.lastGood = cloneSample(sample);
      this.lastSpan = sub(sample.rightShoulder, sample.leftShoulder);
      return {
        sample,
        mode: "BOTH_SHOULDERS",
        reliableShoulder: "both",
        leftReconstructed: false,
        rightReconstructed: false,
        occlusionActive: false,
      };
    }

    const hidden: ShoulderSide = direction === "right" ? "right" : "left";
    const anchor: ShoulderSide = hidden === "right" ? "left" : "right";
    const anchorOk = anchor === "left" ? leftSoft : rightSoft;
    const hiddenVis = hidden === "left" ? vis(sample.leftShoulder) : vis(sample.rightShoulder);

    if (!anchorOk || !this.lastSpan || !this.lastGood) {
      return {
        sample,
        mode: leftSoft || rightSoft ? "WEIGHTED" : "BOTH_SHOULDERS",
        reliableShoulder: leftSoft && rightSoft ? "both" : leftSoft ? "left" : rightSoft ? "right" : "none",
        leftReconstructed: false,
        rightReconstructed: false,
        occlusionActive: hiddenVis < min,
      };
    }

    const liveAnchor = anchor === "left" ? sample.leftShoulder : sample.rightShoulder;
    const width = baseline?.shoulderWidth ?? Math.max(dist(this.lastGood.leftShoulder, this.lastGood.rightShoulder), 1e-4);
    const spanMag = Math.hypot(this.lastSpan.x, this.lastSpan.y, this.lastSpan.z) || width;
    const unit = scale(this.lastSpan, width / spanMag);
    const estimated =
      hidden === "right"
        ? add(liveAnchor, unit, Math.max(hiddenVis, 0.35))
        : add(liveAnchor, scale(unit, -1), Math.max(hiddenVis, 0.35));

    const next = cloneSample(sample);
    if (hidden === "right") next.rightShoulder = estimated;
    else next.leftShoulder = estimated;
    if (anchor === "left") next.leftShoulder = copyVec(liveAnchor);
    else next.rightShoulder = copyVec(liveAnchor);

    this.lastSpan = sub(next.rightShoulder, next.leftShoulder);
    this.lastGood = cloneSample(next);

    const weighted = hiddenVis >= soft && hiddenVis < min;
    return {
      sample: next,
      mode: weighted ? "WEIGHTED" : "SINGLE_SHOULDER_ASSISTED",
      reliableShoulder: anchor,
      leftReconstructed: hidden === "left",
      rightReconstructed: hidden === "right",
      occlusionActive: true,
    };
  }
}

function cloneSample(sample: LandmarkSample): LandmarkSample {
  return {
    leftShoulder: copyVec(sample.leftShoulder),
    rightShoulder: copyVec(sample.rightShoulder),
    leftHip: copyVec(sample.leftHip),
    rightHip: copyVec(sample.rightHip),
    leftElbow: copyVec(sample.leftElbow),
    rightElbow: copyVec(sample.rightElbow),
    leftEar: copyVec(sample.leftEar),
    rightEar: copyVec(sample.rightEar),
    nose: copyVec(sample.nose),
  };
}

function looksLikeChinSnap(
  sample: LandmarkSample,
  side: ShoulderSide,
  baseline: ObliqueBaseline,
  config: ObliqueConfig
): boolean {
  const shoulder = side === "left" ? sample.leftShoulder : sample.rightShoulder;
  const ear = side === "left" ? sample.leftEar : sample.rightEar;
  const calEar = side === "left" ? baseline.leftShoulderToEar : baseline.rightShoulderToEar;
  const calNose = side === "left" ? baseline.leftShoulderToNose : baseline.rightShoulderToNose;
  if (calEar > 1e-4 && dist(shoulder, ear) / calEar < config.shoulderEarCollapseRatio) return true;
  if (calNose > 1e-4 && dist(shoulder, sample.nose) / calNose < config.shoulderNoseCollapseRatio) return true;
  if (shoulder.y > ear.y - baseline.shoulderWidth * 0.05) return true;
  return false;
}

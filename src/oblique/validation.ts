import type { Vec } from "../pose/types";
import type { ObliqueConfig } from "./config";
import { dist, vis } from "./landmarks";
import { hipMidOf, hipWidthOf, shoulderWidthOf } from "./vectors";
import type { FrameValidity, LandmarkSample, ObliqueBaseline, RejectReason, ShoulderSide } from "./types";

export type ValidationResult = {
  validity: FrameValidity;
  reason: RejectReason;
  chinSnapSide: ShoulderSide | null;
  pelvisRotationDeg: number | null;
  pelvisTranslationPct: number | null;
};

/**
 * Anatomical + pelvis checks. Chin/head shoulder snaps are rejected without
 * ending the whole trial — the session marks the frame and continues.
 */
export function validateFrame(input: {
  sample: LandmarkSample;
  baseline: ObliqueBaseline | null;
  lastShoulders: { left: Vec; right: Vec } | null;
  pelvisFromNeutralDeg: number | null;
  config: ObliqueConfig;
  spike: boolean;
}): ValidationResult {
  const { sample, baseline, lastShoulders, config } = input;
  const hipsOk = vis(sample.leftHip) >= config.softLandmarkConfidence && vis(sample.rightHip) >= config.softLandmarkConfidence;
  if (!hipsOk) {
    return { validity: "reject", reason: "Low landmark confidence", chinSnapSide: null, pelvisRotationDeg: input.pelvisFromNeutralDeg, pelvisTranslationPct: null };
  }

  const chin = detectChinSnap(sample, baseline, config);
  if (chin) {
    return {
      validity: "reject",
      reason: "Shoulder chin/head snap",
      chinSnapSide: chin,
      pelvisRotationDeg: input.pelvisFromNeutralDeg,
      pelvisTranslationPct: null,
    };
  }

  if (lastShoulders && baseline) {
    const scale = Math.max(baseline.shoulderWidth, hipWidthOf(sample));
    const jumpL = dist(sample.leftShoulder, lastShoulders.left) / scale;
    const jumpR = dist(sample.rightShoulder, lastShoulders.right) / scale;
    if (jumpL > config.shoulderTeleportHipWidths || jumpR > config.shoulderTeleportHipWidths) {
      return {
        validity: "reject",
        reason: "Shoulder teleport",
        chinSnapSide: null,
        pelvisRotationDeg: input.pelvisFromNeutralDeg,
        pelvisTranslationPct: null,
      };
    }
    const widthPct = Math.abs(shoulderWidthOf(sample) - baseline.shoulderWidth) / baseline.shoulderWidth;
    if (widthPct > config.shoulderWidthTolPct / 100 && vis(sample.leftShoulder) >= config.landmarkConfidence && vis(sample.rightShoulder) >= config.landmarkConfidence) {
      return {
        validity: "warn",
        reason: "Shoulder width collapse",
        chinSnapSide: null,
        pelvisRotationDeg: input.pelvisFromNeutralDeg,
        pelvisTranslationPct: null,
      };
    }
  }

  let pelvisTranslationPct: number | null = null;
  if (baseline) {
    const mid = hipMidOf(sample);
    pelvisTranslationPct = (dist(mid, baseline.hipMid as Vec) / Math.max(baseline.shoulderWidth, 1e-4)) * 100;
  }

  if (input.spike) {
    return {
      validity: "reject",
      reason: "Angle spike",
      chinSnapSide: null,
      pelvisRotationDeg: input.pelvisFromNeutralDeg,
      pelvisTranslationPct,
    };
  }

  const pelvisAbs = input.pelvisFromNeutralDeg == null ? 0 : Math.abs(input.pelvisFromNeutralDeg);
  if (pelvisAbs >= config.pelvisFailDeg || (pelvisTranslationPct != null && pelvisTranslationPct >= config.pelvisTranslationFailPct)) {
    return {
      validity: "warn",
      reason: "Pelvis unstable",
      chinSnapSide: null,
      pelvisRotationDeg: input.pelvisFromNeutralDeg,
      pelvisTranslationPct,
    };
  }
  if (pelvisAbs >= config.pelvisWarnDeg || (pelvisTranslationPct != null && pelvisTranslationPct >= config.pelvisTranslationWarnPct)) {
    return {
      validity: "warn",
      reason: "Pelvis unstable",
      chinSnapSide: null,
      pelvisRotationDeg: input.pelvisFromNeutralDeg,
      pelvisTranslationPct,
    };
  }

  return {
    validity: "valid",
    reason: "",
    chinSnapSide: null,
    pelvisRotationDeg: input.pelvisFromNeutralDeg,
    pelvisTranslationPct,
  };
}

export function detectChinSnap(sample: LandmarkSample, baseline: ObliqueBaseline | null, config: ObliqueConfig): ShoulderSide | null {
  if (!baseline) return null;
  const check = (side: ShoulderSide): boolean => {
    const shoulder = side === "left" ? sample.leftShoulder : sample.rightShoulder;
    const ear = side === "left" ? sample.leftEar : sample.rightEar;
    const calEar = side === "left" ? baseline.leftShoulderToEar : baseline.rightShoulderToEar;
    const calNose = side === "left" ? baseline.leftShoulderToNose : baseline.rightShoulderToNose;
    if (calEar > 1e-4 && dist(shoulder, ear) / calEar < config.shoulderEarCollapseRatio) return true;
    if (calNose > 1e-4 && dist(shoulder, sample.nose) / calNose < config.shoulderNoseCollapseRatio) return true;
    // Y-up: shoulder should stay below ear.
    if (shoulder.y > ear.y - baseline.shoulderWidth * 0.05) return true;
    return false;
  };
  if (check("left") && !check("right")) return "left";
  if (check("right") && !check("left")) return "right";
  if (check("left") && check("right")) return "right";
  return null;
}

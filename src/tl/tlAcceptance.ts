import { LM, type Vec } from "../pose/types";
import type { TLConfig } from "./tlConfig";
import type { ConstraintCheck, RotationDirection } from "./tlTypes";

export type TrackingBand = "high" | "medium" | "low" | "invalid";
export type TrialQuality = "Excellent" | "Good" | "Fair" | "Retest Recommended";
export type OcclusionState = "none" | "expected-far-shoulder" | "prolonged" | "lost";

export type LandmarkVis = {
  leftShoulder: number;
  rightShoulder: number;
  leftHip: number;
  rightHip: number;
  nearShoulder: number;
  farShoulder: number;
};

export type AcceptanceFrame = {
  band: TrackingBand;
  movementValid: boolean;
  score: number;
  occlusion: OcclusionState;
  rejectReason: string;
  acceptPeak: boolean;
  candidateOnly: boolean;
};

export type CandidatePeak = {
  value: number;
  at: number;
  samples: number[];
};

/** Per-landmark visibility without requiring the far shoulder to match the near one. */
export function landmarkVis(world: Vec[]): LandmarkVis {
  const vis = (index: number) => world[index]?.visibility ?? 0;
  if (world.length < 33) {
    return { leftShoulder: 0, rightShoulder: 0, leftHip: 0, rightHip: 0, nearShoulder: 0, farShoulder: 0 };
  }
  const leftShoulder = vis(LM.leftShoulder);
  const rightShoulder = vis(LM.rightShoulder);
  return {
    leftShoulder,
    rightShoulder,
    leftHip: vis(LM.leftHip),
    rightHip: vis(LM.rightHip),
    nearShoulder: Math.max(leftShoulder, rightShoulder),
    farShoulder: Math.min(leftShoulder, rightShoulder),
  };
}

export function movementReject(checks: ConstraintCheck[]): ConstraintCheck | null {
  return checks.find((check) => check.category === "hard" && check.status === "fail" && check.id !== "hands-behind") ?? null;
}

/**
 * Score landmark confidence for axial rotation. A dim far shoulder is expected
 * and does not force INVALID by itself.
 */
export function scoreTracking(
  vis: LandmarkVis,
  config: TLConfig,
  farLowForMs: number,
  movementValid: boolean,
  spike: boolean
): { band: TrackingBand; score: number; occlusion: OcclusionState } {
  const min = config.landmarkConfidence;
  const soft = Math.max(0.12, min * 0.45);
  const hips = Math.min(vis.leftHip, vis.rightHip);
  if (hips < soft || vis.nearShoulder < soft) {
    return { band: "invalid", score: 0, occlusion: "lost" };
  }
  if (spike || !movementValid) {
    return { band: "invalid", score: Math.min(vis.nearShoulder, hips), occlusion: farLowForMs > 0 ? "expected-far-shoulder" : "none" };
  }

  const farOk = vis.farShoulder >= min;
  const farSoft = vis.farShoulder >= soft;
  const occlusion: OcclusionState =
    !farOk && farSoft
      ? "expected-far-shoulder"
      : !farSoft && farLowForMs <= config.occlusionHoldMs
        ? "expected-far-shoulder"
        : !farSoft && farLowForMs > config.occlusionHoldMs
          ? "prolonged"
          : "none";

  let score = (vis.nearShoulder * 0.45 + Math.max(vis.farShoulder, soft) * 0.2 + hips * 0.35);
  if (occlusion === "expected-far-shoulder") score *= 0.92;
  if (occlusion === "prolonged") score *= 0.7;
  score = Math.max(0, Math.min(1, score));

  if (occlusion === "prolonged" && vis.farShoulder < soft * 0.5) {
    return { band: "low", score, occlusion };
  }
  if (occlusion === "expected-far-shoulder" || score < 0.72) {
    return { band: score >= 0.55 ? "medium" : "low", score, occlusion };
  }
  if (score >= 0.78 && farOk) return { band: "high", score, occlusion: "none" };
  return { band: "medium", score, occlusion };
}

export function evaluateAcceptance(input: {
  checks: ConstraintCheck[];
  vis: LandmarkVis;
  config: TLConfig;
  farLowForMs: number;
  direction: RotationDirection;
  spike: boolean;
  hardPersistFailed: boolean;
}): AcceptanceFrame {
  const rejected = input.hardPersistFailed ? movementReject(input.checks) : null;
  const movementValid = rejected == null;
  const tracked = scoreTracking(input.vis, input.config, input.farLowForMs, movementValid, input.spike);
  let rejectReason = "";
  if (input.spike) rejectReason = "Large landmark jump";
  else if (rejected) rejectReason = rejected.message || rejected.label;
  else if (tracked.band === "invalid") rejectReason = "Tracking confidence too low";
  else if (tracked.band === "low") rejectReason = tracked.occlusion === "prolonged" ? `Tracking confidence too low for ${Math.round(input.farLowForMs)} ms` : "Tracking confidence low";

  const acceptPeak = movementValid && !input.spike && (tracked.band === "high" || tracked.band === "medium");
  const candidateOnly = movementValid && !input.spike && tracked.band === "low";
  return {
    band: tracked.band,
    movementValid,
    score: tracked.score,
    occlusion: tracked.occlusion,
    rejectReason,
    acceptPeak,
    candidateOnly,
  };
}

/** Promote a low-confidence candidate only when nearby frames agree. */
export function updateCandidate(candidate: CandidatePeak | null, value: number, now: number, windowMs: number, agreeDeg: number): { candidate: CandidatePeak | null; promoted: number | null } {
  if (!Number.isFinite(value)) return { candidate, promoted: null };
  if (!candidate || now - candidate.at > windowMs || Math.abs(value - candidate.value) > agreeDeg * 2) {
    return { candidate: { value, at: now, samples: [value] }, promoted: null };
  }
  const samples = [...candidate.samples, value].slice(-8);
  const next = { value: Math.max(candidate.value, value), at: now, samples };
  if (samples.length < 3) return { candidate: next, promoted: null };
  const near = samples.filter((sample) => Math.abs(sample - next.value) <= agreeDeg);
  if (near.length >= 3) return { candidate: null, promoted: next.value };
  return { candidate: next, promoted: null };
}

export function isAngleSpike(previous: number | null, next: number, dtMs: number, maxJumpDeg: number, maxVelocity: number): boolean {
  if (previous == null || !Number.isFinite(next) || !Number.isFinite(previous)) return false;
  const delta = Math.abs(next - previous);
  if (delta > maxJumpDeg) return true;
  if (dtMs > 0 && (delta * 1000) / dtMs > maxVelocity) return true;
  return false;
}

export function trialQuality(scorePct: number, occlusionSeen: boolean, accepted: boolean): TrialQuality {
  if (!accepted) return "Retest Recommended";
  if (scorePct >= 88 && !occlusionSeen) return "Excellent";
  if (scorePct >= 75) return "Good";
  if (scorePct >= 55) return "Fair";
  return "Retest Recommended";
}

export function occlusionLabel(state: OcclusionState, direction: RotationDirection): string {
  if (state === "none") return "None";
  if (state === "lost") return "Landmarks lost";
  if (state === "prolonged") return "Prolonged far-shoulder occlusion";
  return direction === "left" ? "EXPECTED FAR-SHOULDER OCCLUSION (right)" : "EXPECTED FAR-SHOULDER OCCLUSION (left)";
}

export function bandLabel(band: TrackingBand): string {
  if (band === "high") return "HIGH";
  if (band === "medium") return "MEDIUM";
  if (band === "low") return "LOW";
  return "INVALID";
}

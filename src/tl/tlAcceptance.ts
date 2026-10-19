import { LM, type Vec } from "../pose/types";
import type { TLConfig } from "./tlConfig";
import { shoulderRoles, type ShoulderSide, type TrackingMode } from "./tlShoulderAssist";
import type { ConstraintCheck, RotationDirection } from "./tlTypes";

export type TrackingBand = "high" | "medium" | "low" | "invalid";
export type TrialQuality = "Excellent" | "Good" | "Fair" | "Retest Recommended";
export type OcclusionState = "none" | "expected-far-shoulder" | "prolonged" | "lost";

export type LandmarkVis = {
  leftShoulder: number;
  rightShoulder: number;
  leftHip: number;
  rightHip: number;
  /** Direction-aware: LEFT for right rotation, RIGHT for left rotation. */
  anchorShoulder: number;
  /** Direction-aware: RIGHT for right rotation, LEFT for left rotation. */
  occludedShoulder: number;
  anchorSide: ShoulderSide;
  occludedSide: ShoulderSide;
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

/** Visibility with the correct rotation-side occlusion mapping. */
export function landmarkVis(world: Vec[], direction: RotationDirection): LandmarkVis {
  const vis = (index: number) => world[index]?.visibility ?? 0;
  const roles = shoulderRoles(direction);
  if (world.length < 33) {
    return {
      leftShoulder: 0,
      rightShoulder: 0,
      leftHip: 0,
      rightHip: 0,
      anchorShoulder: 0,
      occludedShoulder: 0,
      anchorSide: roles.anchor,
      occludedSide: roles.occluded,
    };
  }
  const leftShoulder = vis(LM.leftShoulder);
  const rightShoulder = vis(LM.rightShoulder);
  return {
    leftShoulder,
    rightShoulder,
    leftHip: vis(LM.leftHip),
    rightHip: vis(LM.rightHip),
    anchorShoulder: roles.anchor === "left" ? leftShoulder : rightShoulder,
    occludedShoulder: roles.occluded === "left" ? leftShoulder : rightShoulder,
    anchorSide: roles.anchor,
    occludedSide: roles.occluded,
  };
}

export function movementReject(checks: ConstraintCheck[]): ConstraintCheck | null {
  return checks.find((check) => check.category === "hard" && check.status === "fail" && check.id !== "hands-behind") ?? null;
}

/**
 * Score landmark confidence for axial rotation. The shoulder on the rotation
 * side may dim; that is expected occlusion, not an automatic invalid frame.
 */
export function scoreTracking(
  vis: LandmarkVis,
  config: TLConfig,
  occludedLowForMs: number,
  movementValid: boolean,
  spike: boolean,
  mode: TrackingMode
): { band: TrackingBand; score: number; occlusion: OcclusionState } {
  const min = config.landmarkConfidence;
  const soft = Math.max(0.12, min * 0.45);
  const hips = Math.min(vis.leftHip, vis.rightHip);
  if (hips < soft || vis.anchorShoulder < soft) {
    return { band: "invalid", score: 0, occlusion: "lost" };
  }
  if (spike || !movementValid) {
    return { band: "invalid", score: Math.min(vis.anchorShoulder, hips), occlusion: occludedLowForMs > 0 ? "expected-far-shoulder" : "none" };
  }

  const assisted = mode === "OCCLUSION_ASSISTED";
  const occludedOk = vis.occludedShoulder >= min;
  const occludedSoft = vis.occludedShoulder >= soft || assisted;
  const occlusion: OcclusionState =
    assisted || (!occludedOk && occludedSoft)
      ? "expected-far-shoulder"
      : !occludedSoft && occludedLowForMs <= config.occlusionHoldMs
        ? "expected-far-shoulder"
        : !occludedSoft && occludedLowForMs > config.occlusionHoldMs
          ? "prolonged"
          : "none";

  let score = vis.anchorShoulder * 0.5 + Math.max(vis.occludedShoulder, soft) * 0.15 + hips * 0.35;
  if (assisted) score = vis.anchorShoulder * 0.55 + hips * 0.45;
  if (occlusion === "expected-far-shoulder") score *= 0.94;
  if (occlusion === "prolonged") score *= 0.7;
  score = Math.max(0, Math.min(1, score));

  if (occlusion === "prolonged" && vis.occludedShoulder < soft * 0.5 && !assisted) {
    return { band: "low", score, occlusion };
  }
  if (occlusion === "expected-far-shoulder" || assisted || score < 0.72) {
    return { band: score >= 0.55 ? "medium" : "low", score, occlusion: occlusion === "none" ? "expected-far-shoulder" : occlusion };
  }
  if (score >= 0.78 && occludedOk) return { band: "high", score, occlusion: "none" };
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
  mode?: TrackingMode;
}): AcceptanceFrame {
  const rejected = input.hardPersistFailed ? movementReject(input.checks) : null;
  const movementValid = rejected == null;
  const tracked = scoreTracking(input.vis, input.config, input.farLowForMs, movementValid, input.spike, input.mode ?? "TWO_SHOULDER_OBSERVED");
  let rejectReason = "";
  if (input.spike) rejectReason = "Large landmark jump";
  else if (rejected) rejectReason = rejected.message || rejected.label;
  else if (tracked.band === "invalid") rejectReason = "Tracking confidence too low";
  else if (tracked.band === "low") {
    rejectReason =
      tracked.occlusion === "prolonged" ? `Tracking confidence too low for ${Math.round(input.farLowForMs)} ms` : "Tracking confidence low";
  }

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
export function updateCandidate(
  candidate: CandidatePeak | null,
  value: number,
  now: number,
  windowMs: number,
  agreeDeg: number
): { candidate: CandidatePeak | null; promoted: number | null } {
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
  const roles = shoulderRoles(direction);
  if (state === "none") return "None";
  if (state === "lost") return "Landmarks lost";
  if (state === "prolonged") return `Prolonged ${roles.occluded.toUpperCase()} shoulder occlusion`;
  return `EXPECTED ${roles.occluded.toUpperCase()} SHOULDER OCCLUSION`;
}

export function bandLabel(band: TrackingBand): string {
  if (band === "high") return "HIGH";
  if (band === "medium") return "MEDIUM";
  if (band === "low") return "LOW";
  return "INVALID";
}

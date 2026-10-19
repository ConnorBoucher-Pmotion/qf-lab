import { LM, type Vec } from "../pose/types";
import type { SRConfig } from "./srConfig";
import type { ConstraintCheck } from "./srTypes";

export type TrackingBand = "high" | "medium" | "low" | "invalid";
export type TrialQuality = "Excellent" | "Good" | "Fair" | "Retest Recommended";

export type LandmarkVis = {
  leftShoulder: number;
  rightShoulder: number;
  leftElbow: number;
  rightElbow: number;
  leftWrist: number;
  rightWrist: number;
  leftHip: number;
  rightHip: number;
};

export type AcceptanceFrame = {
  band: TrackingBand;
  movementValid: boolean;
  score: number;
  rejectReason: string;
  acceptPeak: boolean;
  candidateOnly: boolean;
};

export type CandidatePeak = {
  value: number;
  at: number;
  samples: number[];
};

export function landmarkVis(world: Vec[]): LandmarkVis {
  const vis = (index: number) => world[index]?.visibility ?? 0;
  if (world.length < 33) {
    return { leftShoulder: 0, rightShoulder: 0, leftElbow: 0, rightElbow: 0, leftWrist: 0, rightWrist: 0, leftHip: 0, rightHip: 0 };
  }
  return {
    leftShoulder: vis(LM.leftShoulder),
    rightShoulder: vis(LM.rightShoulder),
    leftElbow: vis(LM.leftElbow),
    rightElbow: vis(LM.rightElbow),
    leftWrist: vis(LM.leftWrist),
    rightWrist: vis(LM.rightWrist),
    leftHip: vis(LM.leftHip),
    rightHip: vis(LM.rightHip),
  };
}

export function movementReject(checks: ConstraintCheck[]): ConstraintCheck | null {
  return checks.find((check) => check.category === "hard" && check.status === "fail") ?? null;
}

export function scoreTracking(vis: LandmarkVis, config: SRConfig, movementValid: boolean, spike: boolean): { band: TrackingBand; score: number } {
  const min = config.landmarkConfidence;
  const soft = Math.max(0.12, min * 0.45);
  const shoulders = Math.min(vis.leftShoulder, vis.rightShoulder);
  const elbows = Math.min(vis.leftElbow, vis.rightElbow);
  const wrists = Math.min(vis.leftWrist, vis.rightWrist);
  const hips = Math.min(vis.leftHip, vis.rightHip);
  if (shoulders < soft || elbows < soft || wrists < soft || hips < soft) {
    return { band: "invalid", score: 0 };
  }
  if (spike || !movementValid) {
    return { band: "invalid", score: Math.min(shoulders, elbows, wrists, hips) };
  }
  let score = shoulders * 0.3 + elbows * 0.25 + wrists * 0.25 + hips * 0.2;
  score = Math.max(0, Math.min(1, score));
  if (score >= 0.78 && wrists >= min && elbows >= min) return { band: "high", score };
  if (score >= 0.55) return { band: "medium", score };
  return { band: "low", score };
}

export function evaluateAcceptance(input: {
  checks: ConstraintCheck[];
  vis: LandmarkVis;
  config: SRConfig;
  spike: boolean;
  hardPersistFailed: boolean;
}): AcceptanceFrame {
  const rejected = input.hardPersistFailed ? movementReject(input.checks) : null;
  const movementValid = rejected == null;
  const tracked = scoreTracking(input.vis, input.config, movementValid, input.spike);
  let rejectReason = "";
  if (input.spike) rejectReason = "Large landmark jump";
  else if (rejected) rejectReason = rejected.message || rejected.label;
  else if (tracked.band === "invalid") rejectReason = "Tracking confidence too low";
  else if (tracked.band === "low") rejectReason = "Tracking confidence low";

  const acceptPeak = movementValid && !input.spike && (tracked.band === "high" || tracked.band === "medium");
  const candidateOnly = movementValid && !input.spike && tracked.band === "low";
  return {
    band: tracked.band,
    movementValid,
    score: tracked.score,
    rejectReason,
    acceptPeak,
    candidateOnly,
  };
}

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

export function trialQuality(scorePct: number, accepted: boolean): TrialQuality {
  if (!accepted) return "Retest Recommended";
  if (scorePct >= 88) return "Excellent";
  if (scorePct >= 75) return "Good";
  if (scorePct >= 55) return "Fair";
  return "Retest Recommended";
}

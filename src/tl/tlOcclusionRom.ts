import { LM, type Vec } from "../pose/types";
import type { TLConfig } from "./tlConfig";
import { shoulderRoles, type ShoulderSide, type TrackingMode } from "./tlShoulderAssist";
import type { RotationDirection } from "./tlTypes";

export type OcclusionHandoff = {
  at: number;
  rom: number;
  shoulderWidth: number;
  shoulderMid: Vec;
  depthDiff: number;
  axisDeg: number;
  anchorYawDeg: number;
  angularVelocityDegPerSec: number;
};

export type OcclusionRomResult = {
  mode: TrackingMode;
  /** Gold-standard 3D ROM only while both shoulders are observed and trusted. */
  observedRawRom: number | null;
  /** Last locked observed ROM at occlusion handoff. */
  lastReliableRom: number | null;
  /** Additional rotation since handoff (directional). */
  deltaRom: number;
  /** Continuity-preserving hybrid: lastReliable + delta (or observed when both trusted). */
  hybridRom: number | null;
  /** Estimated shoulder used for absolute 3D ROM? Always false. */
  estimatedUsedForAbsolute3d: boolean;
  visibleShoulder: ShoulderSide;
  hiddenShoulder: ShoulderSide;
};

/**
 * Observed Raw ROM uses real landmarks only. During occlusion, Hybrid ROM is
 * lastReliableROM + delta from the visible anchor trajectory — never an estimated
 * shoulder fed into the 3D atan2 formula.
 */
export class OcclusionRomTracker {
  private handoff: OcclusionHandoff | null = null;
  private hybrid: number | null = null;
  private lastObserved: number | null = null;
  private lastAnchorYaw: number | null = null;
  private lastAt: number | null = null;
  private angularVelocity = 0;
  private blendFrom: number | null = null;
  private blendStartedAt: number | null = null;
  private recoverFrames = 0;
  private inOcclusion = false;
  private recentHybrids: number[] = [];

  reset(): void {
    this.handoff = null;
    this.hybrid = null;
    this.lastObserved = null;
    this.lastAnchorYaw = null;
    this.lastAt = null;
    this.angularVelocity = 0;
    this.blendFrom = null;
    this.blendStartedAt = null;
    this.recoverFrames = 0;
    this.inOcclusion = false;
    this.recentHybrids = [];
  }

  update(input: {
    world: Vec[];
    direction: RotationDirection;
    now: number;
    dtMs: number;
    bothObservedTrusted: boolean;
    /** Directional observed torso–pelvis ROM from real landmarks only. */
    observedRawRom: number | null;
    config: TLConfig;
  }): OcclusionRomResult {
    const roles = shoulderRoles(input.direction);
    const base: OcclusionRomResult = {
      mode: "TWO_SHOULDER_OBSERVED",
      observedRawRom: input.bothObservedTrusted ? input.observedRawRom : null,
      lastReliableRom: this.handoff?.rom ?? null,
      deltaRom: 0,
      hybridRom: null,
      estimatedUsedForAbsolute3d: false,
      visibleShoulder: roles.anchor,
      hiddenShoulder: roles.occluded,
    };
    if (input.world.length < 33) return base;

    const anchor = input.world[roles.anchorIndex];
    const occluded = input.world[roles.occludedIndex];
    const hipMid = mid(input.world[LM.leftHip], input.world[LM.rightHip]);
    const anchorYaw = horizontalYaw(hipMid, anchor);
    const dt = Math.max(1, input.dtMs);

    if (input.bothObservedTrusted && input.observedRawRom != null) {
      if (this.lastObserved != null && this.lastAt != null) {
        const dObs = input.observedRawRom - this.lastObserved;
        this.angularVelocity = (dObs * 1000) / Math.max(1, input.now - this.lastAt);
      }
      this.lastObserved = input.observedRawRom;
      this.lastAt = input.now;
      this.lastAnchorYaw = anchorYaw;

      if (this.inOcclusion) {
        this.recoverFrames += 1;
        if (this.recoverFrames >= input.config.shoulderRecoverFrames) {
          const gap = Math.abs(input.observedRawRom - (this.hybrid ?? input.observedRawRom));
          if (gap <= input.config.occlusionHandoffJumpDeg * 2) {
            if (this.blendFrom == null) {
              this.blendFrom = this.hybrid ?? input.observedRawRom;
              this.blendStartedAt = input.now;
            }
            const t = Math.min(1, (input.now - (this.blendStartedAt ?? input.now)) / Math.max(1, input.config.shoulderBlendMs));
            const blended = (this.blendFrom ?? input.observedRawRom) * (1 - t) + input.observedRawRom * t;
            this.hybrid = blended;
            if (t >= 1) {
              this.inOcclusion = false;
              this.handoff = null;
              this.blendFrom = null;
              this.blendStartedAt = null;
              this.recoverFrames = 0;
            }
            return this.finish(base, "OCCLUSION_ASSISTED", input.observedRawRom, blended, blended - (this.handoff?.rom ?? blended));
          }
          // Observed jumped far from hybrid — keep occlusion hybrid until stable.
          this.recoverFrames = 0;
        }
        // Still recovering: hold hybrid continuity, do not snap to observed yet.
        const held = this.stepOcclusion(input, anchorYaw, dt, hipMid, anchor, occluded);
        return this.finish(base, "OCCLUSION_ASSISTED", input.observedRawRom, held.hybrid, held.delta);
      }

      // Fully observed mode.
      this.hybrid = input.observedRawRom;
      this.handoff = {
        at: input.now,
        rom: input.observedRawRom,
        shoulderWidth: Math.max(dist(anchor, occluded), 1e-4),
        shoulderMid: mid(anchor, occluded),
        depthDiff: occluded.z - anchor.z,
        axisDeg: axisYaw(anchor, occluded),
        anchorYawDeg: anchorYaw,
        angularVelocityDegPerSec: this.angularVelocity,
      };
      this.remember(input.observedRawRom);
      return this.finish(base, "TWO_SHOULDER_OBSERVED", input.observedRawRom, input.observedRawRom, 0);
    }

    // Occlusion / corruption path.
    if (!this.inOcclusion) {
      const lock = this.handoff?.rom ?? this.lastObserved ?? this.hybrid ?? 0;
      this.handoff = {
        at: input.now,
        rom: lock,
        shoulderWidth: this.handoff?.shoulderWidth ?? Math.max(dist(anchor, occluded), 1e-4),
        shoulderMid: this.handoff?.shoulderMid ?? mid(anchor, hipMid),
        depthDiff: this.handoff?.depthDiff ?? 0,
        axisDeg: this.handoff?.axisDeg ?? 0,
        anchorYawDeg: this.lastAnchorYaw ?? anchorYaw,
        angularVelocityDegPerSec: this.angularVelocity,
      };
      this.hybrid = lock;
      this.inOcclusion = true;
      this.recoverFrames = 0;
      this.blendFrom = null;
    }

    const stepped = this.stepOcclusion(input, anchorYaw, dt, hipMid, anchor, occluded);
    return this.finish(base, "OCCLUSION_ASSISTED", null, stepped.hybrid, stepped.delta);
  }

  /** Recent hybrid samples for multi-frame peak confirmation. */
  recentSamples(): number[] {
    return this.recentHybrids.slice();
  }

  private stepOcclusion(
    input: {
      direction: RotationDirection;
      now: number;
      config: TLConfig;
    },
    anchorYaw: number,
    dtMs: number,
    _hipMid: Vec,
    _anchor: Vec,
    _occluded: Vec
  ): { hybrid: number; delta: number } {
    const handoff = this.handoff!;
    const yawDelta = wrapDeg(anchorYaw - handoff.anchorYawDeg);
    // Positive subject-right. RIGHT rotation accumulates +yawDelta; LEFT accumulates -yawDelta.
    const directed = input.direction === "right" ? yawDelta : -yawDelta;
    let delta = Math.max(0, directed);

    // Blend with pre-occlusion angular velocity so brief yaw noise does not dominate.
    const coast = Math.max(0, handoff.angularVelocityDegPerSec) * ((input.now - handoff.at) / 1000);
    delta = delta * 0.75 + coast * 0.25;

    let next = handoff.rom + delta;
    const prev = this.hybrid ?? handoff.rom;
    const maxStep = Math.max(
      input.config.occlusionMaxDegPerFrame,
      (input.config.occlusionMaxDegPerSec * dtMs) / 1000
    );
    const jump = next - prev;
    if (jump > maxStep) next = prev + maxStep;
    if (jump < -maxStep) next = prev - maxStep;

    // Handoff continuity: first occlusion frame must stay near locked ROM.
    if (Math.abs(next - handoff.rom) > input.config.occlusionHandoffJumpDeg && this.hybrid == null) {
      next = handoff.rom;
      delta = 0;
    }

    this.hybrid = next;
    this.lastAnchorYaw = anchorYaw;
    this.lastAt = input.now;
    this.remember(next);
    return { hybrid: next, delta: next - handoff.rom };
  }

  private finish(
    base: OcclusionRomResult,
    mode: TrackingMode,
    observed: number | null,
    hybrid: number | null,
    delta: number
  ): OcclusionRomResult {
    return {
      ...base,
      mode,
      observedRawRom: observed,
      lastReliableRom: this.handoff?.rom ?? null,
      deltaRom: delta,
      hybridRom: hybrid,
      estimatedUsedForAbsolute3d: false,
    };
  }

  private remember(value: number): void {
    this.recentHybrids.push(value);
    if (this.recentHybrids.length > 12) this.recentHybrids.shift();
  }
}

/** Peak must appear in neighboring recent samples — rejects single-frame spikes. */
export function confirmPeak(samples: number[], candidate: number, agreeDeg: number): boolean {
  if (!Number.isFinite(candidate) || samples.length < 3) return false;
  const near = samples.filter((sample) => Math.abs(sample - candidate) <= agreeDeg);
  return near.length >= 3;
}

function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}
function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function horizontalYaw(from: Vec, to: Vec): number {
  return (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
}
function axisYaw(left: Vec, right: Vec): number {
  return (Math.atan2(right.z - left.z, right.x - left.x) * 180) / Math.PI;
}
function wrapDeg(deg: number): number {
  let value = deg;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

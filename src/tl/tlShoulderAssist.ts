import { LM, type Vec } from "../pose/types";
import type { RotationDirection } from "./tlTypes";

export type ShoulderSide = "left" | "right";
export type TrackingMode = "TWO_SHOULDER" | "SINGLE_SHOULDER_ASSISTED";

export type ShoulderRoles = {
  anchor: ShoulderSide;
  occluded: ShoulderSide;
  anchorIndex: number;
  occludedIndex: number;
};

/** RIGHT turn: LEFT stays visible. LEFT turn: RIGHT stays visible. */
export function shoulderRoles(direction: RotationDirection): ShoulderRoles {
  if (direction === "right") {
    return { anchor: "left", occluded: "right", anchorIndex: LM.leftShoulder, occludedIndex: LM.rightShoulder };
  }
  return { anchor: "right", occluded: "left", anchorIndex: LM.rightShoulder, occludedIndex: LM.leftShoulder };
}

type Sample = { at: number; left: Vec; right: Vec; span: Vec };

export type ShoulderAssistResult = {
  world: Vec[];
  image: Vec[];
  mode: TrackingMode;
  assisted: boolean;
  roles: ShoulderRoles;
  occludedVisibility: number;
  anchorVisibility: number;
};

/**
 * While both shoulders are reliable, store the shoulder span. When the
 * direction-expected occluded shoulder dips, keep the live anchor and rebuild
 * the hidden shoulder from that span, advanced with recent angular velocity.
 */
export class ShoulderAssist {
  private lastGoodWorld: Sample | null = null;
  private lastGoodImage: Sample | null = null;
  private angularVelocity = 0;
  private assistStartedAt: number | null = null;
  private lastFrameAt: number | null = null;

  reset(): void {
    this.lastGoodWorld = null;
    this.lastGoodImage = null;
    this.angularVelocity = 0;
    this.assistStartedAt = null;
    this.lastFrameAt = null;
  }

  apply(
    world: Vec[],
    image: Vec[],
    direction: RotationDirection,
    now: number,
    minVis: number,
    holdMs: number
  ): ShoulderAssistResult {
    const roles = shoulderRoles(direction);
    const base = {
      world,
      image,
      mode: "TWO_SHOULDER" as const,
      assisted: false,
      roles,
      occludedVisibility: world[roles.occludedIndex]?.visibility ?? 0,
      anchorVisibility: world[roles.anchorIndex]?.visibility ?? 0,
    };
    if (world.length < 33) return base;

    const left = world[LM.leftShoulder];
    const right = world[LM.rightShoulder];
    const soft = Math.max(0.12, minVis * 0.45);
    const bothOk = (left?.visibility ?? 0) >= minVis && (right?.visibility ?? 0) >= minVis;

    if (bothOk && left && right) {
      const span = sub(right, left);
      if (this.lastGoodWorld) {
        const dt = Math.max(1, now - this.lastGoodWorld.at);
        const prev = Math.atan2(this.lastGoodWorld.span.z, this.lastGoodWorld.span.x);
        const next = Math.atan2(span.z, span.x);
        this.angularVelocity = wrap(next - prev) / (dt / 1000);
      }
      this.lastGoodWorld = { at: now, left: copy(left), right: copy(right), span };
      if (image.length >= 33) {
        const iLeft = image[LM.leftShoulder];
        const iRight = image[LM.rightShoulder];
        this.lastGoodImage = { at: now, left: copy(iLeft), right: copy(iRight), span: sub(iRight, iLeft) };
      }
      this.assistStartedAt = null;
      this.lastFrameAt = now;
      return {
        ...base,
        occludedVisibility: world[roles.occludedIndex].visibility,
        anchorVisibility: world[roles.anchorIndex].visibility,
      };
    }

    const anchorVis = world[roles.anchorIndex]?.visibility ?? 0;
    const occludedVis = world[roles.occludedIndex]?.visibility ?? 0;
    const liveAnchor = world[roles.anchorIndex];
    if (!this.lastGoodWorld || !liveAnchor || anchorVis < soft || occludedVis >= minVis) {
      this.assistStartedAt = null;
      this.lastFrameAt = now;
      return { ...base, occludedVisibility: occludedVis, anchorVisibility: anchorVis };
    }

    if (this.assistStartedAt == null) this.assistStartedAt = now;
    const assistedFor = now - this.assistStartedAt;
    if (assistedFor > holdMs * 1.5) {
      this.lastFrameAt = now;
      return {
        world,
        image,
        mode: "SINGLE_SHOULDER_ASSISTED",
        assisted: false,
        roles,
        occludedVisibility: occludedVis,
        anchorVisibility: anchorVis,
      };
    }

    const frameDt = this.lastFrameAt == null ? 33 : Math.max(8, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const delta = this.angularVelocity * (frameDt / 1000);
    const rotated = rotateY(this.lastGoodWorld.span, delta);
    const nextWorld = world.map(copy);
    if (roles.occluded === "right") {
      nextWorld[LM.rightShoulder] = withVis(add(liveAnchor, rotated), Math.max(occludedVis, 0.35));
      nextWorld[LM.leftShoulder] = copy(liveAnchor);
    } else {
      nextWorld[LM.leftShoulder] = withVis(sub(liveAnchor, rotated), Math.max(occludedVis, 0.35));
      nextWorld[LM.rightShoulder] = copy(liveAnchor);
    }
    this.lastGoodWorld = {
      at: now,
      left: copy(nextWorld[LM.leftShoulder]),
      right: copy(nextWorld[LM.rightShoulder]),
      span: sub(nextWorld[LM.rightShoulder], nextWorld[LM.leftShoulder]),
    };

    let nextImage = image;
    if (image.length >= 33 && this.lastGoodImage) {
      const liveImageAnchor = image[roles.anchorIndex];
      const imageRotated = rotateImage(this.lastGoodImage.span, delta);
      nextImage = image.map(copy);
      if (roles.occluded === "right") {
        nextImage[LM.rightShoulder] = withVis(add(liveImageAnchor, imageRotated), Math.max(occludedVis, 0.35));
        nextImage[LM.leftShoulder] = copy(liveImageAnchor);
      } else {
        nextImage[LM.leftShoulder] = withVis(sub(liveImageAnchor, imageRotated), Math.max(occludedVis, 0.35));
        nextImage[LM.rightShoulder] = copy(liveImageAnchor);
      }
      this.lastGoodImage = {
        at: now,
        left: copy(nextImage[LM.leftShoulder]),
        right: copy(nextImage[LM.rightShoulder]),
        span: sub(nextImage[LM.rightShoulder], nextImage[LM.leftShoulder]),
      };
    }

    return {
      world: nextWorld,
      image: nextImage,
      mode: "SINGLE_SHOULDER_ASSISTED",
      assisted: true,
      roles,
      occludedVisibility: occludedVis,
      anchorVisibility: anchorVis,
    };
  }
}

function copy(point: Vec): Vec {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility, held: point.held };
}

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, visibility: a.visibility };
}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}

function withVis(point: Vec, visibility: number): Vec {
  return { ...point, visibility, held: true };
}

function rotateY(point: Vec, radians: number): Vec {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: point.x * c + point.z * s, y: point.y, z: -point.x * s + point.z * c, visibility: point.visibility };
}

/** Approximate planar rotation for image-space shoulder span (x/y). */
function rotateImage(point: Vec, radians: number): Vec {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c, z: point.z, visibility: point.visibility };
}

function wrap(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

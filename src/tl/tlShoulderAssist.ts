import { LM, type Vec } from "../pose/types";
import {
  AnatomyCollector,
  constrainReconstructedShoulder,
  estimateShoulderFromElbow,
  evaluateShoulderTrust,
  type AnatomyCalibration,
  type ShoulderTrust,
} from "./tlAnatomy";
import type { TLConfig } from "./tlConfig";
import type { RotationDirection } from "./tlTypes";

export type ShoulderSide = "left" | "right";
export type TrackingMode = "TWO_SHOULDER_OBSERVED" | "OCCLUSION_ASSISTED";

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

export type ShoulderAssistResult = {
  world: Vec[];
  image: Vec[];
  mode: TrackingMode;
  assisted: boolean;
  roles: ShoulderRoles;
  left: ShoulderTrust;
  right: ShoulderTrust;
  reconstructedSide: ShoulderSide | null;
  /** World-space MediaPipe shoulders (always original). */
  mediaPipeLeft: Vec | null;
  mediaPipeRight: Vec | null;
  /** World-space shoulders used for ROM (real or reconstructed). */
  correctedLeft: Vec | null;
  correctedRight: Vec | null;
};

type History = {
  at: number;
  left: Vec;
  right: Vec;
  span: Vec;
  axisDeg: number;
  imageLeft: Vec | null;
  imageRight: Vec | null;
};

/**
 * Prefer real shoulders while anatomically plausible. When the rotation-side
 * shoulder is corrupted or dim, reconstruct it from the opposite shoulder,
 * hidden-side elbow, calibrated width/arm, and recent angular velocity.
 * Never feed a chin/neck-snapped MediaPipe shoulder into the ROM axis.
 */
export class ShoulderAssist {
  private anatomy: AnatomyCalibration | null = null;
  private collector = new AnatomyCollector();
  private lastGood: History | null = null;
  private angularVelocity = 0;
  private lastFrameAt: number | null = null;
  private lastTrustedLeft: Vec | null = null;
  private lastTrustedRight: Vec | null = null;
  private lastAxisDeg: number | null = null;
  private blendFrom: { left: Vec; right: Vec; startedAt: number } | null = null;
  private recoverFrames = 0;
  private assisting = false;

  reset(): void {
    this.anatomy = null;
    this.collector.reset();
    this.lastGood = null;
    this.angularVelocity = 0;
    this.lastFrameAt = null;
    this.lastTrustedLeft = null;
    this.lastTrustedRight = null;
    this.lastAxisDeg = null;
    this.blendFrom = null;
    this.recoverFrames = 0;
    this.assisting = false;
  }

  /** Call during neutral calibration while both shoulders are clearly tracked. */
  observeCalibration(world: Vec[], minVis: number): void {
    this.collector.push(world, minVis);
  }

  sealCalibration(): AnatomyCalibration | null {
    this.anatomy = this.collector.finish();
    return this.anatomy;
  }

  setAnatomy(anatomy: AnatomyCalibration | null): void {
    this.anatomy = anatomy;
  }

  getAnatomy(): AnatomyCalibration | null {
    return this.anatomy;
  }

  apply(world: Vec[], image: Vec[], direction: RotationDirection, now: number, config: TLConfig): ShoulderAssistResult {
    const roles = shoulderRoles(direction);
    const emptyTrust = (side: ShoulderSide): ShoulderTrust => ({
      side,
      trusted: false,
      visibility: 0,
      anatomicalValid: false,
      status: "low_visibility",
      reasons: ["No pose"],
    });
    if (world.length < 33) {
      return {
        world,
        image,
        mode: "TWO_SHOULDER_OBSERVED",
        assisted: false,
        roles,
        left: emptyTrust("left"),
        right: emptyTrust("right"),
        reconstructedSide: null,
        mediaPipeLeft: null,
        mediaPipeRight: null,
        correctedLeft: null,
        correctedRight: null,
      };
    }

    const mediaPipeLeft = copy(world[LM.leftShoulder]);
    const mediaPipeRight = copy(world[LM.rightShoulder]);
    const axisDegNow = axisYawDeg(mediaPipeLeft, mediaPipeRight);

    const leftTrust = evaluateShoulderTrust({
      side: "left",
      world,
      anatomy: this.anatomy,
      lastTrusted: this.lastTrustedLeft,
      lastAxisDeg: this.lastAxisDeg,
      config,
      axisDegNow,
    });
    const rightTrust = evaluateShoulderTrust({
      side: "right",
      world,
      anatomy: this.anatomy,
      lastTrusted: this.lastTrustedRight,
      lastAxisDeg: this.lastAxisDeg,
      config,
      axisDegNow,
    });

    const bothReal = leftTrust.trusted && rightTrust.trusted && leftTrust.anatomicalValid && rightTrust.anatomicalValid;
    const occludedTrust = roles.occluded === "left" ? leftTrust : rightTrust;
    const anchorTrust = roles.anchor === "left" ? leftTrust : rightTrust;
    const needsAssist = !occludedTrust.trusted || occludedTrust.status === "corrupted" || occludedTrust.status === "low_visibility";

    // Smooth return: require consecutive plausible frames, then blend.
    if (this.assisting && bothReal) {
      this.recoverFrames += 1;
    } else if (!bothReal) {
      this.recoverFrames = 0;
      this.blendFrom = null;
    }

    if (bothReal && (!this.assisting || this.recoverFrames >= config.shoulderRecoverFrames)) {
      if (this.assisting && !this.blendFrom && this.lastGood) {
        this.blendFrom = { left: copy(this.lastGood.left), right: copy(this.lastGood.right), startedAt: now };
      }
      if (this.lastGood) {
        const dt = Math.max(1, now - this.lastGood.at);
        this.angularVelocity = wrapRad(((axisDegNow ?? this.lastGood.axisDeg) - this.lastGood.axisDeg) * (Math.PI / 180)) / (dt / 1000);
      }
      let outLeft = mediaPipeLeft;
      let outRight = mediaPipeRight;
      if (this.blendFrom) {
        const t = Math.min(1, (now - this.blendFrom.startedAt) / Math.max(1, config.shoulderBlendMs));
        outLeft = lerp(this.blendFrom.left, mediaPipeLeft, t);
        outRight = lerp(this.blendFrom.right, mediaPipeRight, t);
        if (t >= 1) {
          this.blendFrom = null;
          this.assisting = false;
        }
      } else {
        this.assisting = false;
      }
      this.lastGood = {
        at: now,
        left: copy(outLeft),
        right: copy(outRight),
        span: sub(outRight, outLeft),
        axisDeg: axisYawDeg(outLeft, outRight) ?? 0,
        imageLeft: image.length >= 33 ? copy(image[LM.leftShoulder]) : null,
        imageRight: image.length >= 33 ? copy(image[LM.rightShoulder]) : null,
      };
      this.lastTrustedLeft = copy(outLeft);
      this.lastTrustedRight = copy(outRight);
      this.lastAxisDeg = this.lastGood.axisDeg;
      this.lastFrameAt = now;
      const nextWorld = patchShoulders(world, outLeft, outRight);
      const nextImage =
        image.length >= 33 && this.blendFrom
          ? patchShoulders(
              image,
              projectDelta(image[LM.leftShoulder], world[LM.leftShoulder], outLeft),
              projectDelta(image[LM.rightShoulder], world[LM.rightShoulder], outRight)
            )
          : image;
      return {
        world: nextWorld,
        image: nextImage,
        mode: this.blendFrom ? "OCCLUSION_ASSISTED" : "TWO_SHOULDER_OBSERVED",
        assisted: this.blendFrom != null,
        roles,
        left: leftTrust,
        right: rightTrust,
        reconstructedSide: null,
        mediaPipeLeft,
        mediaPipeRight,
        correctedLeft: outLeft,
        correctedRight: outRight,
      };
    }

    // Prefer assist when the direction-expected shoulder is untrusted and the anchor is OK.
    if (!needsAssist || !anchorTrust.trusted || !this.lastGood) {
      this.lastFrameAt = now;
      if (leftTrust.trusted) this.lastTrustedLeft = copy(mediaPipeLeft);
      if (rightTrust.trusted) this.lastTrustedRight = copy(mediaPipeRight);
      return {
        world,
        image,
        mode: "TWO_SHOULDER_OBSERVED",
        assisted: false,
        roles,
        left: leftTrust,
        right: rightTrust,
        reconstructedSide: null,
        mediaPipeLeft,
        mediaPipeRight,
        correctedLeft: mediaPipeLeft,
        correctedRight: mediaPipeRight,
      };
    }

    this.assisting = true;
    this.recoverFrames = 0;
    const frameDt = this.lastFrameAt == null ? 33 : Math.max(8, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const liveAnchor = roles.anchor === "left" ? mediaPipeLeft : mediaPipeRight;
    const reconstructed = this.reconstructOccluded({
      roles,
      liveAnchor,
      world,
      now,
      frameDt,
      config,
    });

    const outLeft = roles.occluded === "left" ? reconstructed : copy(liveAnchor);
    const outRight = roles.occluded === "right" ? reconstructed : copy(liveAnchor);
    const imageLeft = image.length >= 33 ? projectDelta(image[LM.leftShoulder], world[LM.leftShoulder], outLeft) : null;
    const imageRight = image.length >= 33 ? projectDelta(image[LM.rightShoulder], world[LM.rightShoulder], outRight) : null;
    this.lastGood = {
      at: now,
      left: copy(outLeft),
      right: copy(outRight),
      span: sub(outRight, outLeft),
      axisDeg: axisYawDeg(outLeft, outRight) ?? this.lastGood.axisDeg,
      imageLeft,
      imageRight,
    };
    if (roles.anchor === "left") this.lastTrustedLeft = copy(outLeft);
    else this.lastTrustedRight = copy(outRight);
    if (roles.occluded === "left") this.lastTrustedLeft = copy(outLeft);
    else this.lastTrustedRight = copy(outRight);
    this.lastAxisDeg = this.lastGood.axisDeg;

    const nextWorld = patchShoulders(world, outLeft, outRight);
    const nextImage = image.length >= 33 && imageLeft && imageRight ? patchShoulders(image, imageLeft, imageRight) : image;

    return {
      world: nextWorld,
      image: nextImage,
      mode: "OCCLUSION_ASSISTED",
      assisted: true,
      roles,
      left: leftTrust,
      right: rightTrust,
      reconstructedSide: roles.occluded,
      mediaPipeLeft,
      mediaPipeRight,
      correctedLeft: outLeft,
      correctedRight: outRight,
    };
  }

  private reconstructOccluded(input: {
    roles: ShoulderRoles;
    liveAnchor: Vec;
    world: Vec[];
    now: number;
    frameDt: number;
    config: TLConfig;
  }): Vec {
    const { roles, liveAnchor, world, frameDt } = input;
    const side = roles.occluded;
    const elbowIndex = side === "left" ? LM.leftElbow : LM.rightElbow;
    const elbow = world[elbowIndex];
    const elbowOk = elbow && (elbow.visibility ?? 0) >= Math.max(0.15, input.config.landmarkConfidence * 0.35);
    const anatomy = this.anatomy;
    const last = this.lastGood!;
    const delta = this.angularVelocity * (frameDt / 1000);
    const trajSpan = rotateY(last.span, delta);
    const trajectoryEstimate = side === "right" ? add(liveAnchor, trajSpan) : sub(liveAnchor, trajSpan);

    let widthEstimate = trajectoryEstimate;
    if (anatomy) {
      const unit = unitOr(trajSpan, side === "right" ? { x: 1, y: 0, z: 0, visibility: 1 } : { x: -1, y: 0, z: 0, visibility: 1 });
      const signed = side === "right" ? unit : scale(unit, -1);
      // Place occluded shoulder at calibrated width from the live anchor along the current axis.
      widthEstimate = add(liveAnchor, scale(unitOr(signed, unit), anatomy.shoulderWidth));
    }

    let elbowEstimate = trajectoryEstimate;
    let wElbow = 0;
    if (elbowOk && anatomy) {
      const calVec = side === "left" ? anatomy.leftShoulderToElbow : anatomy.rightShoulderToElbow;
      const calLen = side === "left" ? anatomy.leftUpperArmLength : anatomy.rightUpperArmLength;
      const lastSh = side === "left" ? last.left : last.right;
      // Rotate calibrated arm by recent torso yaw so elbow→shoulder stays plausible while turning.
      const rotatedArm = rotateY(calVec, ((this.lastAxisDeg ?? 0) * Math.PI) / 180);
      elbowEstimate = estimateShoulderFromElbow(elbow, rotatedArm, calLen, lastSh);
      wElbow = 0.45;
    }

    const wWidth = anatomy ? 0.3 : 0.15;
    const wTraj = Math.max(0.15, 1 - wElbow - wWidth);
    const blended = {
      x: elbowEstimate.x * wElbow + trajectoryEstimate.x * wTraj + widthEstimate.x * wWidth,
      y: elbowEstimate.y * wElbow + trajectoryEstimate.y * wTraj + widthEstimate.y * wWidth,
      z: elbowEstimate.z * wElbow + trajectoryEstimate.z * wTraj + widthEstimate.z * wWidth,
      visibility: 0.55,
      held: true,
    };

    if (!anatomy) return withVis(blended, 0.55);
    return constrainReconstructedShoulder({
      estimated: blended,
      side,
      anchor: liveAnchor,
      anatomy,
      elbow: elbowOk ? elbow : null,
      lastTrusted: side === "left" ? this.lastTrustedLeft : this.lastTrustedRight,
    });
  }
}

function patchShoulders(pose: Vec[], left: Vec, right: Vec): Vec[] {
  const next = pose.map(copy);
  next[LM.leftShoulder] = copy(left);
  next[LM.rightShoulder] = copy(right);
  return next;
}

/** Map a corrected world shoulder into image space from the MediaPipe image/world pair. */
function projectDelta(imagePoint: Vec, worldPoint: Vec, correctedWorld: Vec): Vec {
  const sx = 420;
  const sy = 360;
  return {
    x: imagePoint.x + (correctedWorld.x - worldPoint.x) * sx,
    y: imagePoint.y - (correctedWorld.y - worldPoint.y) * sy,
    z: imagePoint.z + (correctedWorld.z - worldPoint.z) * sx,
    visibility: correctedWorld.visibility,
    held: true,
  };
}

function axisYawDeg(left: Vec, right: Vec): number | null {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  if (Math.hypot(dx, dz) < 1e-8) return null;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
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
function scale(v: Vec, s: number): Vec {
  return { x: v.x * s, y: v.y * s, z: v.z * s, visibility: v.visibility };
}
function mag(v: Vec): number {
  return Math.hypot(v.x, v.y, v.z);
}
function unitOr(v: Vec, fallback: Vec): Vec {
  const m = mag(v);
  return m > 1e-6 ? scale(v, 1 / m) : fallback;
}
function withVis(point: Vec, visibility: number): Vec {
  return { ...point, visibility, held: true };
}
function rotateY(point: Vec, radians: number): Vec {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: point.x * c + point.z * s, y: point.y, z: -point.x * s + point.z * c, visibility: point.visibility };
}
function wrapRad(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}
function lerp(a: Vec, b: Vec, t: number): Vec {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    visibility: b.visibility,
    held: t < 1,
  };
}

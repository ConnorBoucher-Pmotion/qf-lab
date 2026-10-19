import { LM, type Vec } from "../pose/types";
import type { TLConfig } from "./tlConfig";
import type { ShoulderSide } from "./tlShoulderAssist";

export type AnatomyCalibration = {
  leftShoulder: Vec;
  rightShoulder: Vec;
  leftElbow: Vec;
  rightElbow: Vec;
  leftEar: Vec;
  rightEar: Vec;
  nose: Vec;
  shoulderWidth: number;
  leftUpperArmLength: number;
  rightUpperArmLength: number;
  leftShoulderToElbow: Vec;
  rightShoulderToElbow: Vec;
  leftShoulderToEar: number;
  rightShoulderToEar: number;
  leftShoulderToNose: number;
  rightShoulderToNose: number;
  leftLateral: number;
  rightLateral: number;
  shoulderMid: Vec;
  hipMid: Vec;
  frames: number;
};

export type ShoulderTrustStatus = "ok" | "low_visibility" | "corrupted";

export type ShoulderTrust = {
  side: ShoulderSide;
  trusted: boolean;
  visibility: number;
  anatomicalValid: boolean;
  status: ShoulderTrustStatus;
  reasons: string[];
};

type AnatomyAccum = {
  n: number;
  leftShoulder: Vec;
  rightShoulder: Vec;
  leftElbow: Vec;
  rightElbow: Vec;
  leftEar: Vec;
  rightEar: Vec;
  nose: Vec;
  hipMid: Vec;
};

/** Collect subject-relative anatomy during neutral calibration (0.5–1 s). */
export class AnatomyCollector {
  private acc: AnatomyAccum | null = null;

  reset(): void {
    this.acc = null;
  }

  push(world: Vec[], minVis: number): void {
    if (world.length < 33) return;
    const pts = [
      world[LM.leftShoulder],
      world[LM.rightShoulder],
      world[LM.leftElbow],
      world[LM.rightElbow],
      world[LM.leftEar],
      world[LM.rightEar],
      world[LM.nose],
      world[LM.leftHip],
      world[LM.rightHip],
    ];
    if (pts.some((p) => (p?.visibility ?? 0) < minVis * 0.8)) return;
    const hipMid = mid(world[LM.leftHip], world[LM.rightHip]);
    if (!this.acc) {
      this.acc = {
        n: 1,
        leftShoulder: copy(world[LM.leftShoulder]),
        rightShoulder: copy(world[LM.rightShoulder]),
        leftElbow: copy(world[LM.leftElbow]),
        rightElbow: copy(world[LM.rightElbow]),
        leftEar: copy(world[LM.leftEar]),
        rightEar: copy(world[LM.rightEar]),
        nose: copy(world[LM.nose]),
        hipMid: copy(hipMid),
      };
      return;
    }
    const a = this.acc;
    a.n += 1;
    blendIn(a.leftShoulder, world[LM.leftShoulder], a.n);
    blendIn(a.rightShoulder, world[LM.rightShoulder], a.n);
    blendIn(a.leftElbow, world[LM.leftElbow], a.n);
    blendIn(a.rightElbow, world[LM.rightElbow], a.n);
    blendIn(a.leftEar, world[LM.leftEar], a.n);
    blendIn(a.rightEar, world[LM.rightEar], a.n);
    blendIn(a.nose, world[LM.nose], a.n);
    blendIn(a.hipMid, hipMid, a.n);
  }

  finish(): AnatomyCalibration | null {
    if (!this.acc || this.acc.n < 4) return null;
    const a = this.acc;
    const shoulderMid = mid(a.leftShoulder, a.rightShoulder);
    const shoulderWidth = dist(a.leftShoulder, a.rightShoulder);
    const leftArm = sub(a.leftElbow, a.leftShoulder);
    const rightArm = sub(a.rightElbow, a.rightShoulder);
    return {
      leftShoulder: copy(a.leftShoulder),
      rightShoulder: copy(a.rightShoulder),
      leftElbow: copy(a.leftElbow),
      rightElbow: copy(a.rightElbow),
      leftEar: copy(a.leftEar),
      rightEar: copy(a.rightEar),
      nose: copy(a.nose),
      shoulderWidth: Math.max(shoulderWidth, 1e-4),
      leftUpperArmLength: Math.max(mag(leftArm), 1e-4),
      rightUpperArmLength: Math.max(mag(rightArm), 1e-4),
      leftShoulderToElbow: leftArm,
      rightShoulderToElbow: rightArm,
      leftShoulderToEar: dist(a.leftShoulder, a.leftEar),
      rightShoulderToEar: dist(a.rightShoulder, a.rightEar),
      leftShoulderToNose: dist(a.leftShoulder, a.nose),
      rightShoulderToNose: dist(a.rightShoulder, a.nose),
      leftLateral: Math.abs(a.leftShoulder.x - shoulderMid.x),
      rightLateral: Math.abs(a.rightShoulder.x - shoulderMid.x),
      shoulderMid,
      hipMid: copy(a.hipMid),
      frames: a.n,
    };
  }
}

/**
 * MediaPipe confidence alone is not enough. A shoulder near the chin with
 * high visibility is still SHOULDER_CORRUPTED.
 */
export function evaluateShoulderTrust(input: {
  side: ShoulderSide;
  world: Vec[];
  anatomy: AnatomyCalibration | null;
  lastTrusted: Vec | null;
  lastAxisDeg: number | null;
  config: Pick<
    TLConfig,
    | "landmarkConfidence"
    | "shoulderEarCollapseRatio"
    | "shoulderNoseCollapseRatio"
    | "upperArmLengthTolPct"
    | "shoulderWidthTolPct"
    | "shoulderVerticalJumpRatio"
    | "shoulderLateralCollapseRatio"
    | "shoulderAxisJumpDeg"
  >;
  axisDegNow: number | null;
}): ShoulderTrust {
  const { side, world, anatomy, lastTrusted, config } = input;
  const shoulderIndex = side === "left" ? LM.leftShoulder : LM.rightShoulder;
  const elbowIndex = side === "left" ? LM.leftElbow : LM.rightElbow;
  const earIndex = side === "left" ? LM.leftEar : LM.rightEar;
  const shoulder = world[shoulderIndex];
  const elbow = world[elbowIndex];
  const ear = world[earIndex];
  const nose = world[LM.nose];
  const other = world[side === "left" ? LM.rightShoulder : LM.leftShoulder];
  const hipMid = world.length >= 33 ? mid(world[LM.leftHip], world[LM.rightHip]) : null;
  const visibility = shoulder?.visibility ?? 0;
  const soft = Math.max(0.12, config.landmarkConfidence * 0.45);
  const reasons: string[] = [];

  if (!shoulder || visibility < soft) {
    return {
      side,
      trusted: false,
      visibility,
      anatomicalValid: false,
      status: "low_visibility",
      reasons: ["MediaPipe visibility too low"],
    };
  }

  if (anatomy) {
    const earDist = ear ? dist(shoulder, ear) : null;
    const calEar = side === "left" ? anatomy.leftShoulderToEar : anatomy.rightShoulderToEar;
    if (earDist != null && calEar > 1e-4 && earDist / calEar < config.shoulderEarCollapseRatio) {
      reasons.push("Shoulder-ear distance collapsed");
    }
    const noseDist = nose ? dist(shoulder, nose) : null;
    const calNose = side === "left" ? anatomy.leftShoulderToNose : anatomy.rightShoulderToNose;
    if (noseDist != null && calNose > 1e-4 && noseDist / calNose < config.shoulderNoseCollapseRatio) {
      reasons.push("Shoulder-nose/chin distance collapsed");
    }
    const calArm = side === "left" ? anatomy.leftUpperArmLength : anatomy.rightUpperArmLength;
    if (elbow && (elbow.visibility ?? 0) >= soft && calArm > 1e-4) {
      const armLen = dist(shoulder, elbow);
      const pct = Math.abs(armLen - calArm) / calArm;
      if (pct > config.upperArmLengthTolPct / 100) {
        reasons.push(`Upper-arm length inconsistent (${Math.round(pct * 100)}%)`);
      }
    }
    // Only use the opposite shoulder for width if it itself still looks lateral/anatomical.
    // A chin-snapped opposite landmark must not spoil the good anchor via width.
    if (other && hipMid && (other.visibility ?? 0) >= soft) {
      const otherCalLateral = side === "left" ? anatomy.rightLateral : anatomy.leftLateral;
      const otherCalNose = side === "left" ? anatomy.rightShoulderToNose : anatomy.leftShoulderToNose;
      const otherLateralOk = otherCalLateral > 1e-4 && Math.abs(other.x - hipMid.x) / otherCalLateral >= config.shoulderLateralCollapseRatio;
      const otherNoseOk = !nose || otherCalNose < 1e-4 || dist(other, nose) / otherCalNose >= config.shoulderNoseCollapseRatio;
      if (otherLateralOk && otherNoseOk) {
        const width = dist(shoulder, other);
        const widthPct = Math.abs(width - anatomy.shoulderWidth) / anatomy.shoulderWidth;
        if (widthPct > config.shoulderWidthTolPct / 100) {
          reasons.push(`Shoulder width changed ${Math.round(widthPct * 100)}%`);
        }
      }
    }
    const calLateral = side === "left" ? anatomy.leftLateral : anatomy.rightLateral;
    if (hipMid && calLateral > 1e-4) {
      const lateral = Math.abs(shoulder.x - hipMid.x);
      if (lateral / calLateral < config.shoulderLateralCollapseRatio) {
        reasons.push("Shoulder near body centerline/head");
      }
    }
    // Y-up world: ear is above shoulder. Sudden climb toward ear without torso rise.
    if (lastTrusted && hipMid) {
      const dyShoulder = shoulder.y - lastTrusted.y;
      const dyTorso = hipMid.y - anatomy.hipMid.y;
      const jump = dyShoulder - dyTorso;
      const scale = Math.max(anatomy.shoulderWidth, 1e-4);
      if (jump > scale * config.shoulderVerticalJumpRatio) {
        reasons.push("Sudden vertical displacement toward head");
      }
    }
  }

  if (lastTrusted) {
    const step = dist(shoulder, lastTrusted);
    const scale = anatomy?.shoulderWidth ?? Math.max(dist(shoulder, other ?? shoulder), 1e-4);
    if (step > scale * 0.55) reasons.push("Shoulder movement velocity inconsistent with recent frames");
  }

  // Axis-jump only implicates this shoulder if it itself moved a lot. Otherwise a
  // chin-snapped opposite landmark would falsely invalidate the good anchor.
  if (
    lastTrusted &&
    input.lastAxisDeg != null &&
    input.axisDegNow != null &&
    Math.abs(wrapDeg(input.axisDegNow - input.lastAxisDeg)) > config.shoulderAxisJumpDeg
  ) {
    const scale = anatomy?.shoulderWidth ?? 0.2;
    if (dist(shoulder, lastTrusted) > scale * 0.2) {
      reasons.push("Shoulder axis changed dramatically between frames");
    }
  }

  if (reasons.length > 0) {
    return {
      side,
      trusted: false,
      visibility,
      anatomicalValid: false,
      status: "corrupted",
      reasons,
    };
  }

  return {
    side,
    trusted: visibility >= config.landmarkConfidence,
    visibility,
    anatomicalValid: true,
    status: visibility >= config.landmarkConfidence ? "ok" : "low_visibility",
    reasons: visibility >= config.landmarkConfidence ? [] : ["MediaPipe visibility below threshold"],
  };
}

export function estimateShoulderFromElbow(
  elbow: Vec,
  calibratedShoulderToElbow: Vec,
  calibratedLength: number,
  lastShoulder: Vec | null
): Vec {
  const arm = mag(calibratedShoulderToElbow);
  const fallback: Vec = { x: 0, y: 0, z: 1, visibility: 1 };
  const dir =
    arm > 1e-6
      ? scale(calibratedShoulderToElbow, 1 / arm)
      : lastShoulder
        ? unitOr(sub(elbow, lastShoulder), fallback)
        : fallback;
  // Shoulder → elbow at calibration; invert to go elbow → shoulder.
  return withVis(sub(elbow, scale(dir, calibratedLength)), Math.max(elbow.visibility ?? 0.5, 0.4));
}

export function constrainReconstructedShoulder(input: {
  estimated: Vec;
  side: ShoulderSide;
  anchor: Vec;
  anatomy: AnatomyCalibration;
  elbow: Vec | null;
  lastTrusted: Vec | null;
}): Vec {
  const { estimated, side, anchor, anatomy, elbow, lastTrusted } = input;
  let point = copy(estimated);
  const widthTarget = anatomy.shoulderWidth;
  const fromAnchor = sub(point, anchor);
  const widthNow = mag(fromAnchor);
  const minW = widthTarget * 0.7;
  const maxW = widthTarget * 1.3;
  if (widthNow > 1e-6) {
    if (widthNow < minW) point = add(anchor, scale(fromAnchor, minW / widthNow));
    else if (widthNow > maxW) point = add(anchor, scale(fromAnchor, maxW / widthNow));
  } else {
    const sign = side === "right" ? 1 : -1;
    point = { x: anchor.x + sign * widthTarget, y: anchor.y, z: anchor.z, visibility: point.visibility };
  }

  // Keep lateral: reconstructed shoulder must not cross midline past the anchor.
  const midX = (anchor.x + point.x) / 2;
  if (side === "right" && point.x < midX) point = { ...point, x: midX + widthTarget * 0.15 };
  if (side === "left" && point.x > midX) point = { ...point, x: midX - widthTarget * 0.15 };

  const ear = side === "left" ? anatomy.leftEar : anatomy.rightEar;
  // Y-up: shoulder must stay below the ear.
  if (point.y > ear.y - anatomy.shoulderWidth * 0.05) {
    point = { ...point, y: ear.y - anatomy.shoulderWidth * 0.12 };
  }

  if (elbow) {
    const calArm = side === "left" ? anatomy.leftUpperArmLength : anatomy.rightUpperArmLength;
    const armVec = sub(elbow, point);
    const armLen = mag(armVec);
    if (armLen > 1e-6) {
      const clamped = Math.max(calArm * 0.7, Math.min(calArm * 1.3, armLen));
      point = sub(elbow, scale(armVec, clamped / armLen));
    }
  }

  if (lastTrusted) {
    const step = dist(point, lastTrusted);
    const maxStep = anatomy.shoulderWidth * 0.35;
    if (step > maxStep) {
      const t = maxStep / step;
      point = {
        x: lastTrusted.x + (point.x - lastTrusted.x) * t,
        y: lastTrusted.y + (point.y - lastTrusted.y) * t,
        z: lastTrusted.z + (point.z - lastTrusted.z) * t,
        visibility: point.visibility,
      };
    }
  }

  return withVis(point, 0.55);
}

function copy(point: Vec): Vec {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility, held: point.held };
}
function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
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
function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function withVis(point: Vec, visibility: number): Vec {
  return { ...point, visibility, held: true };
}
function blendIn(target: Vec, sample: Vec, n: number): void {
  const w = 1 / n;
  target.x += (sample.x - target.x) * w;
  target.y += (sample.y - target.y) * w;
  target.z += (sample.z - target.z) * w;
  target.visibility += ((sample.visibility ?? 1) - (target.visibility ?? 1)) * w;
}
function unitOr(v: Vec, fallback: Vec): Vec {
  const m = mag(v);
  return m > 1e-6 ? scale(v, 1 / m) : fallback;
}
function wrapDeg(deg: number): number {
  let value = deg;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

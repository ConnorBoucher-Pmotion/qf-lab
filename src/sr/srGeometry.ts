import { midpoint } from "../pose/coordinateNormalization";
import { LM, type Side, type Vec } from "../pose/types";

export type FrameSigns = { yUp: number; zFront: number; xSign: number };
export type V3 = { x: number; y: number; z: number };

export type CameraFacing = {
  scoreDeg: number | null;
  shoulderYawDeg: number | null;
  hipYawDeg: number | null;
  leftShoulderZ: number | null;
  rightShoulderZ: number | null;
  shoulderZDiff: number | null;
  leftHipZ: number | null;
  rightHipZ: number | null;
  hipZDiff: number | null;
  shoulderWidth: number | null;
  hipWidth: number | null;
  shoulderOverHip: number | null;
  status: "pass" | "warn" | "fail" | "na";
  warnDeg: number;
  failDeg: number;
  reason: string;
};

export type SideBaseline = {
  forearmDir: V3;
  elbow: V3;
  shoulder: V3;
  abductionDeg: number;
  elbowFlexionDeg: number;
  shoulderY: number;
};

export type ArmReading = {
  side: Side;
  abductionDeg: number | null;
  elbowFlexionDeg: number | null;
  /** Signed degrees from baseline. Positive = external rotation. */
  signedRotationDeg: number | null;
  elbowHeightDiff: number | null;
  elbowDriftPct: number | null;
  shoulderShrugPct: number | null;
  confidence: number;
  shoulder: Vec | null;
  elbow: Vec | null;
  wrist: Vec | null;
};

export type ShoulderReading = {
  left: ArmReading;
  right: ArmReading;
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  shoulderTiltDeg: number | null;
  shoulderHeightDiff: number | null;
  signs: FrameSigns | null;
};

export function detectSigns(world: Vec[]): FrameSigns | null {
  if (world.length < 33) return null;
  const hip = midpoint(world[LM.leftHip], world[LM.rightHip]);
  const shoulder = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  if (shoulder.visibility < 0.05 || hip.visibility < 0.05) return null;
  const yUp = shoulder.y >= hip.y ? 1 : -1;
  const noseGap = world[LM.nose].z - hip.z;
  const left = world[LM.leftShoulder];
  const right = world[LM.rightShoulder];
  const xSign = right.x >= left.x ? 1 : -1;
  return { yUp, zFront: Math.abs(noseGap) < 1e-6 ? 1 : noseGap > 0 ? 1 : -1, xSign };
}

export function axisOffCameraDeg(left: V3, right: V3): number | null {
  const dx = Math.abs(right.x - left.x);
  const dz = Math.abs(right.z - left.z);
  if (dx + dz < 1e-5) return null;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

const EMPTY_FACING: CameraFacing = {
  scoreDeg: null,
  shoulderYawDeg: null,
  hipYawDeg: null,
  leftShoulderZ: null,
  rightShoulderZ: null,
  shoulderZDiff: null,
  leftHipZ: null,
  rightHipZ: null,
  hipZDiff: null,
  shoulderWidth: null,
  hipWidth: null,
  shoulderOverHip: null,
  status: "na",
  warnDeg: 10,
  failDeg: 20,
  reason: "No pose yet.",
};

export function cameraFacing(world: Vec[]): CameraFacing {
  if (world.length < 33) return EMPTY_FACING;
  const leftShoulder = world[LM.leftShoulder];
  const rightShoulder = world[LM.rightShoulder];
  const leftHip = world[LM.leftHip];
  const rightHip = world[LM.rightHip];
  const seen = (point: Vec | undefined) => (point?.visibility ?? 0) >= 0.2;
  const shoulderYawDeg = seen(leftShoulder) && seen(rightShoulder) ? axisOffCameraDeg(leftShoulder, rightShoulder) : null;
  const hipYawDeg = seen(leftHip) && seen(rightHip) ? axisOffCameraDeg(leftHip, rightHip) : null;
  const shoulderWidth = seen(leftShoulder) && seen(rightShoulder) ? mag(sub(rightShoulder, leftShoulder)) : null;
  const hipWidth = seen(leftHip) && seen(rightHip) ? mag(sub(rightHip, leftHip)) : null;
  const hipMidX = ((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2;
  const shoulderMidX = ((leftShoulder?.x ?? 0) + (rightShoulder?.x ?? 0)) / 2;
  const shoulderOverHip = hipWidth != null && hipWidth > 1e-5 ? (shoulderMidX - hipMidX) / hipWidth : null;
  let scoreDeg: number | null = null;
  let reason = "Both shoulders and both hips need to be visible.";
  if (shoulderYawDeg != null && hipYawDeg != null) {
    scoreDeg = (shoulderYawDeg + hipYawDeg) / 2;
    const worse = hipYawDeg >= shoulderYawDeg ? "hips" : "shoulders";
    reason = `Average of the hip axis (${hipYawDeg.toFixed(1)}°) and the shoulder axis (${shoulderYawDeg.toFixed(1)}°) off a frontal line. The ${worse} are turned farther.`;
  } else if (hipYawDeg != null) {
    scoreDeg = hipYawDeg;
    reason = "Shoulder axis is not visible. Score is the hip axis only.";
  } else if (shoulderYawDeg != null) {
    scoreDeg = shoulderYawDeg;
    reason = "Hip axis is not visible. Score is the shoulder axis only.";
  }
  if (shoulderOverHip != null && Math.abs(shoulderOverHip) > 0.45) {
    reason += ` Shoulder midpoint is ${(Math.abs(shoulderOverHip) * 100).toFixed(0)}% of hip width off the pelvis.`;
  }
  return {
    scoreDeg,
    shoulderYawDeg,
    hipYawDeg,
    leftShoulderZ: leftShoulder?.z ?? null,
    rightShoulderZ: rightShoulder?.z ?? null,
    shoulderZDiff: leftShoulder && rightShoulder ? rightShoulder.z - leftShoulder.z : null,
    leftHipZ: leftHip?.z ?? null,
    rightHipZ: rightHip?.z ?? null,
    hipZDiff: leftHip && rightHip ? rightHip.z - leftHip.z : null,
    shoulderWidth,
    hipWidth,
    shoulderOverHip,
    status: "na",
    warnDeg: 10,
    failDeg: 20,
    reason,
  };
}

export function bodyAxes(world: Vec[], signs: FrameSigns): { up: V3; right: V3; forward: V3 } | null {
  if (world.length < 33) return null;
  const up = norm({ x: 0, y: signs.yUp, z: 0 });
  const right = norm(projectPerp(sub(world[LM.rightHip], world[LM.leftHip]), up ?? { x: 0, y: 1, z: 0 }));
  if (!up || !right) return null;
  let forward = cross(right, up);
  const nose = sub(world[LM.nose], midpoint(world[LM.leftHip], world[LM.rightHip]));
  if (dot(forward, nose) < 0) forward = scale(forward, -1);
  const forwardN = norm(forward);
  if (!forwardN) return null;
  return { up, right, forward: forwardN };
}

export function leanDegrees(world: Vec[], signs: FrameSigns): { lateral: number | null; forward: number | null; tilt: number | null } {
  const axes = bodyAxes(world, signs);
  if (!axes) return { lateral: null, forward: null, tilt: null };
  const torso = sub(midpoint(world[LM.leftShoulder], world[LM.rightShoulder]), midpoint(world[LM.leftHip], world[LM.rightHip]));
  const vertical = dot(torso, axes.up);
  const lateral = (Math.atan2(dot(torso, axes.right), vertical) * 180) / Math.PI;
  const forward = (Math.atan2(dot(torso, axes.forward), vertical) * 180) / Math.PI;
  const span = Math.hypot(world[LM.rightShoulder].x - world[LM.leftShoulder].x, world[LM.rightShoulder].z - world[LM.leftShoulder].z);
  const tilt = span < 1e-6 ? null : (Math.atan2((world[LM.leftShoulder].y - world[LM.rightShoulder].y) * signs.yUp, span) * 180) / Math.PI;
  return { lateral, forward, tilt };
}

/** Angle between torso up-axis and upper arm. ~90° in the goalpost start. */
export function shoulderAbductionDeg(shoulder: V3, elbow: V3, hipMid: V3, shoulderMid: V3): number | null {
  const torso = norm(sub(shoulderMid, hipMid));
  const upper = norm(sub(elbow, shoulder));
  if (!torso || !upper) return null;
  const cos = Math.max(-1, Math.min(1, dot(torso, upper)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Interior angle at the elbow. ~90° in the goalpost start. */
export function elbowFlexionDeg(shoulder: V3, elbow: V3, wrist: V3): number | null {
  const upper = norm(sub(shoulder, elbow));
  const fore = norm(sub(wrist, elbow));
  if (!upper || !fore) return null;
  const cos = Math.max(-1, Math.min(1, dot(upper, fore)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Signed forearm rotation around the upper-arm axis relative to a baseline direction.
 * Positive = external rotation (forearm toward behind the head).
 */
export function signedForearmRotationDeg(
  shoulder: V3,
  elbow: V3,
  wrist: V3,
  baselineForearm: V3 | null,
  signs: FrameSigns,
  side: Side
): number | null {
  const axis = norm(sub(elbow, shoulder));
  const current = projectPerp(sub(wrist, elbow), axis ?? { x: 0, y: 1, z: 0 });
  const currentN = norm(current);
  if (!axis || !currentN) return null;
  if (!baselineForearm) {
    // Absolute orientation vs torso-up projected into the rotation plane (for live display before baseline).
    const up = projectPerp({ x: 0, y: signs.yUp, z: 0 }, axis);
    const upN = norm(up);
    if (!upN) return 0;
    return signedAngleAround(upN, currentN, axis) * erSign(side, signs);
  }
  const base = projectPerp(baselineForearm, axis);
  const baseN = norm(base);
  if (!baseN) return null;
  return signedAngleAround(baseN, currentN, axis) * erSign(side, signs);
}

/** External rotation is positive for both sides when the forearm swings behind the head. */
function erSign(side: Side, signs: FrameSigns): number {
  // Right arm axis points roughly subject-right; left points subject-left.
  // Cross(baseline-up, behind) · axis should be + for ER after this flip.
  return (side === "right" ? 1 : -1) * signs.xSign;
}

function signedAngleAround(from: V3, to: V3, axis: V3): number {
  const x = Math.max(-1, Math.min(1, dot(from, to)));
  const y = dot(cross(from, to), axis);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function readShoulder(world: Vec[], baseline: { left: SideBaseline | null; right: SideBaseline | null } | null): ShoulderReading {
  const emptyArm = (side: Side): ArmReading => ({
    side,
    abductionDeg: null,
    elbowFlexionDeg: null,
    signedRotationDeg: null,
    elbowHeightDiff: null,
    elbowDriftPct: null,
    shoulderShrugPct: null,
    confidence: 0,
    shoulder: null,
    elbow: null,
    wrist: null,
  });
  if (world.length < 33) {
    return {
      left: emptyArm("left"),
      right: emptyArm("right"),
      lateralLeanDeg: null,
      forwardLeanDeg: null,
      shoulderTiltDeg: null,
      shoulderHeightDiff: null,
      signs: null,
    };
  }
  const signs = detectSigns(world);
  if (!signs) {
    return {
      left: emptyArm("left"),
      right: emptyArm("right"),
      lateralLeanDeg: null,
      forwardLeanDeg: null,
      shoulderTiltDeg: null,
      shoulderHeightDiff: null,
      signs: null,
    };
  }
  const lean = leanDegrees(world, signs);
  const shoulderMid = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  const hipMid = midpoint(world[LM.leftHip], world[LM.rightHip]);
  const torsoLen = Math.max(mag(sub(shoulderMid, hipMid)), 1e-4);
  const left = readArm(world, "left", signs, shoulderMid, hipMid, torsoLen, baseline?.left ?? null);
  const right = readArm(world, "right", signs, shoulderMid, hipMid, torsoLen, baseline?.right ?? null);
  const heightDiff = ((world[LM.leftShoulder].y - world[LM.rightShoulder].y) * signs.yUp) / torsoLen;
  return {
    left,
    right,
    lateralLeanDeg: lean.lateral,
    forwardLeanDeg: lean.forward,
    shoulderTiltDeg: lean.tilt,
    shoulderHeightDiff: heightDiff * 100,
    signs,
  };
}

function readArm(
  world: Vec[],
  side: Side,
  signs: FrameSigns,
  shoulderMid: V3,
  hipMid: V3,
  torsoLen: number,
  baseline: SideBaseline | null
): ArmReading {
  const idxs =
    side === "left"
      ? { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist }
      : { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist };
  const shoulder = world[idxs.shoulder];
  const elbow = world[idxs.elbow];
  const wrist = world[idxs.wrist];
  const confidence = Math.min(shoulder.visibility ?? 0, elbow.visibility ?? 0, wrist.visibility ?? 0);
  const abductionDeg = shoulderAbductionDeg(shoulder, elbow, hipMid, shoulderMid);
  const flexion = elbowFlexionDeg(shoulder, elbow, wrist);
  const signedRotationDeg = signedForearmRotationDeg(shoulder, elbow, wrist, baseline?.forearmDir ?? null, signs, side);
  const elbowHeightDiff = ((elbow.y - shoulder.y) * signs.yUp * 180) / Math.PI; // rough visual; replaced below with deg-like pct
  const heightAlongTorso = ((elbow.y - shoulder.y) * signs.yUp) / torsoLen;
  // Convert vertical drop to an approximate degree-like signal using arm length.
  const armLen = Math.max(mag(sub(elbow, shoulder)), 1e-4);
  const elbowDropDeg = (Math.asin(Math.max(-1, Math.min(1, -heightAlongTorso * (torsoLen / armLen)))) * 180) / Math.PI;
  const elbowDriftPct = baseline ? (mag(sub(elbow, baseline.elbow)) / armLen) * 100 : null;
  const shoulderShrugPct = baseline ? (Math.max(0, (baseline.shoulderY - shoulder.y) * signs.yUp) / torsoLen) * 100 : null;
  return {
    side,
    abductionDeg,
    elbowFlexionDeg: flexion,
    signedRotationDeg,
    elbowHeightDiff: Number.isFinite(elbowDropDeg) ? elbowDropDeg : elbowHeightDiff,
    elbowDriftPct,
    shoulderShrugPct,
    confidence,
    shoulder,
    elbow,
    wrist,
  };
}

export function captureSideBaseline(world: Vec[], side: Side): SideBaseline | null {
  const signs = detectSigns(world);
  if (!signs || world.length < 33) return null;
  const idxs =
    side === "left"
      ? { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist }
      : { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist };
  const shoulder = world[idxs.shoulder];
  const elbow = world[idxs.elbow];
  const wrist = world[idxs.wrist];
  const shoulderMid = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  const hipMid = midpoint(world[LM.leftHip], world[LM.rightHip]);
  const abductionDeg = shoulderAbductionDeg(shoulder, elbow, hipMid, shoulderMid);
  const flexion = elbowFlexionDeg(shoulder, elbow, wrist);
  if (abductionDeg == null || flexion == null) return null;
  return {
    forearmDir: sub(wrist, elbow),
    elbow: { x: elbow.x, y: elbow.y, z: elbow.z },
    shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
    abductionDeg,
    elbowFlexionDeg: flexion,
    shoulderY: shoulder.y,
  };
}

export function emptySideRom() {
  return { rawEr: null, rawIr: null, validEr: null, validIr: null, rawArc: null, validArc: null, currentSigned: null };
}

export function arcOf(er: number | null, ir: number | null): number | null {
  if (er == null && ir == null) return null;
  return (er ?? 0) + (ir ?? 0);
}

export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function scale(v: V3, s: number): V3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
export function mag(v: V3): number {
  return Math.hypot(v.x, v.y, v.z);
}
export function norm(v: V3): V3 | null {
  const m = mag(v);
  if (m < 1e-8) return null;
  return scale(v, 1 / m);
}
export function projectPerp(v: V3, axis: V3): V3 {
  return sub(v, scale(axis, dot(v, axis)));
}

/** Goalpost seated synthetic pose for offline checks. */
export function syntheticGoalpost(options: { leftErDeg?: number; rightErDeg?: number; width?: number; height?: number; visibility?: number } = {}): {
  image: Vec[];
  world: Vec[];
} {
  const visibility = options.visibility ?? 0.95;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const put = (index: number, point: V3, vis = visibility) => {
    world[index] = { ...point, visibility: vis };
  };
  put(LM.leftHip, { x: -0.12, y: 0, z: 0 });
  put(LM.rightHip, { x: 0.12, y: 0, z: 0 });
  put(LM.leftShoulder, { x: -0.2, y: 0.52, z: 0 });
  put(LM.rightShoulder, { x: 0.2, y: 0.52, z: 0 });
  put(LM.leftElbow, { x: -0.45, y: 0.52, z: 0 });
  put(LM.rightElbow, { x: 0.45, y: 0.52, z: 0 });
  put(LM.nose, { x: 0, y: 0.72, z: 0.16 });
  put(LM.leftEar, { x: -0.08, y: 0.68, z: 0.04 });
  put(LM.rightEar, { x: 0.08, y: 0.68, z: 0.04 });
  put(LM.leftKnee, { x: -0.12, y: -0.42, z: 0.06 });
  put(LM.rightKnee, { x: 0.12, y: -0.42, z: 0.06 });
  const leftEr = ((options.leftErDeg ?? 0) * Math.PI) / 180;
  const rightEr = ((options.rightErDeg ?? 0) * Math.PI) / 180;
  // Forearms start up; ER rotates toward -z (behind).
  put(LM.leftWrist, { x: -0.45, y: 0.52 + 0.22 * Math.cos(leftEr), z: -0.22 * Math.sin(leftEr) });
  put(LM.rightWrist, { x: 0.45, y: 0.52 + 0.22 * Math.cos(rightEr), z: -0.22 * Math.sin(rightEr) });
  const image = world.map((point) => ({
    x: width * 0.5 + point.x * width * 0.85,
    y: height * 0.48 - point.y * height * 0.62,
    z: -point.z * width * 0.85,
    visibility: point.visibility,
  }));
  return { image, world };
}

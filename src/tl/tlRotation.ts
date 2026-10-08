import { angleDelta, midpoint } from "../pose/coordinateNormalization";
import { LM, type Vec } from "../pose/types";

export const ROTATION_ALGORITHMS = ["legacy", "shoulderYaw", "torsoPelvis", "depthWidth"] as const;
export type RotationAlgorithm = (typeof ROTATION_ALGORITHMS)[number];

export const ALGORITHM_INFO: Record<RotationAlgorithm, { label: string; note: string }> = {
  legacy: {
    label: "A · Current / legacy",
    note: "Previous method: world-landmark shoulder yaw minus pelvis yaw, then minus the calibrated neutral. Pelvis yaw is part of this formula, so a pelvis estimate that turns with the chest lowers the number. Compensation checks are not subtracted again.",
  },
  shoulderYaw: {
    label: "B · 3D shoulder yaw",
    note: "Yaw of the world-landmark shoulder vector (right minus left) around vertical, minus the calibrated shoulder yaw. Pelvis rotation is not removed.",
  },
  torsoPelvis: {
    label: "C · Shoulder vs pelvis",
    note: "Signed angle from the pelvis vector to the shoulder vector in the horizontal plane, minus that same angle at neutral.",
  },
  depthWidth: {
    label: "D · Depth / width",
    note: "Experimental. Magnitude is how much the horizontal shoulder width has narrowed since neutral (acos of the width ratio). The sign comes only from which shoulder is closer. It does not trust the size of the Z value. A front camera often keeps the 2D shoulder line flat while the width and depth change.",
  },
};

/** Old saved config values, from before the algorithm comparison. */
export const ALGORITHM_ALIASES: Record<string, RotationAlgorithm> = {
  shoulderNeutral: "shoulderYaw",
  shoulderVsPelvis: "legacy",
  worldTorso: "torsoPelvis",
  imageDepth: "depthWidth",
  legacy: "legacy",
  shoulderYaw: "shoulderYaw",
  torsoPelvis: "torsoPelvis",
  depthWidth: "depthWidth",
};

export type FrameSigns = { yUp: number; zFront: number; xSign: number };

export type V3 = { x: number; y: number; z: number };

export type YawBaseline = {
  shoulderYawDeg: number;
  pelvisYawDeg: number;
  /** Signed shoulder-versus-pelvis angle at neutral, from the vector method. */
  relativeYawDeg: number;
  /** Horizontal shoulder width at neutral, in the same units as the landmarks. */
  shoulderSpan: number;
  torsoScale: number;
  imageShoulderSpan: number;
  imageTorsoScale: number;
  signs: FrameSigns;
};

export type RotationReading = {
  shoulderYawDeg: number | null;
  pelvisYawDeg: number | null;
  /** Shoulder yaw minus the calibrated shoulder yaw. Null before calibration. */
  shoulderFromNeutralDeg: number | null;
  /** Legacy shoulder-minus-pelvis yaw from neutral. Before calibration this is the absolute shoulder-minus-pelvis yaw. */
  legacyDeg: number | null;
  torsoPelvisDeg: number | null;
  depthWidthDeg: number | null;
  imageWidthDeg: number | null;
  /** Current horizontal shoulder width divided by the neutral width, after torso-scale correction. 1 is unchanged. */
  shoulderSpanRatio: number | null;
  imageShoulderYawDeg: number | null;
  headYawDeg: number | null;
  imageLineDeltaDeg: number | null;
};

export function primaryAngle(reading: RotationReading, algorithm: RotationAlgorithm): number | null {
  if (algorithm === "legacy") return reading.legacyDeg;
  if (algorithm === "shoulderYaw") return reading.shoulderFromNeutralDeg;
  if (algorithm === "torsoPelvis") return reading.torsoPelvisDeg;
  return reading.depthWidthDeg;
}

/** Positive is the subject's right rotation. */
export function directionalRom(signedRightPositive: number | null, direction: "left" | "right"): number | null {
  if (signedRightPositive == null || !Number.isFinite(signedRightPositive)) return null;
  return direction === "right" ? signedRightPositive : -signedRightPositive;
}

export function detectSigns(world: Vec[]): FrameSigns | null {
  if (world.length < 33) return null;
  const hip = midpoint(world[LM.leftHip], world[LM.rightHip]);
  const shoulder = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  if (shoulder.visibility < 0.05 || hip.visibility < 0.05) return null;
  const yUp = shoulder.y >= hip.y ? 1 : -1;
  const noseGap = world[LM.nose].z - hip.z;
  const left = world[LM.leftShoulder];
  const right = world[LM.rightShoulder];
  // Synthetic poses put the subject's right shoulder at +x. A real MediaPipe pose often puts the subject's left shoulder at +x.
  // Locking the sign at calibration keeps a later shoulder crossing from flipping the angle.
  const xSign = right.x >= left.x ? 1 : -1;
  return { yUp, zFront: Math.abs(noseGap) < 1e-6 ? 1 : noseGap > 0 ? 1 : -1, xSign };
}

/**
 * Yaw of the left-to-right axis. Subject's right rotation is positive:
 * the left landmark moves toward the camera and the right landmark moves away.
 * `xSign` is -1 when the subject's left landmark sits at +x, so a frontal pose
 * stays near 0° instead of wrapping to ±180°.
 */
export function subjectYawDeg(left: V3, right: V3, zFront: number, xSign = 1): number | null {
  const dx = (right.x - left.x) * xSign;
  const dz = (right.z - left.z) * zFront;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return (-Math.atan2(dz, dx) * 180) / Math.PI;
}

/**
 * How far a left-right body axis is turned away from the camera.
 * 0° is across the frame (facing the camera). 90° points at the camera (side-on).
 *
 * This is not subjectYawDeg. That signed angle is ~180° for a real frontal
 * MediaPipe pose, because the subject's left landmark sits at +x, so
 * right.x - left.x is negative and atan2 wraps. Taking the absolute value
 * then fails "Face the camera" for someone sitting square to the lens.
 * Using the absolute depth against the absolute width removes that wrap
 * and ignores which side is +x or +z.
 */
export function axisOffCameraDeg(left: V3, right: V3): number | null {
  const dx = Math.abs(right.x - left.x);
  const dz = Math.abs(right.z - left.z);
  if (dx + dz < 1e-5) return null;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

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
  /** Shoulder midpoint minus hip midpoint, in hip widths. Sideways offset, not yaw. */
  shoulderOverHip: number | null;
  status: "pass" | "warn" | "fail" | "na";
  warnDeg: number;
  failDeg: number;
  reason: string;
};

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

/** Facing score from both the shoulder axis and the hip axis. 0° is frontal. */
export function cameraFacing(world: Vec[]): CameraFacing {
  if (world.length < 33) return EMPTY_FACING;
  const leftShoulder = world[LM.leftShoulder];
  const rightShoulder = world[LM.rightShoulder];
  const leftHip = world[LM.leftHip];
  const rightHip = world[LM.rightHip];
  const seen = (point: Vec | undefined) => (point?.visibility ?? 0) >= 0.2;
  const shoulderYawDeg = seen(leftShoulder) && seen(rightShoulder) ? axisOffCameraDeg(leftShoulder, rightShoulder) : null;
  const hipYawDeg = seen(leftHip) && seen(rightHip) ? axisOffCameraDeg(leftHip, rightHip) : null;
  const shoulderWidth = seen(leftShoulder) && seen(rightShoulder) ? Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y, rightShoulder.z - leftShoulder.z) : null;
  const hipWidth = seen(leftHip) && seen(rightHip) ? Math.hypot(rightHip.x - leftHip.x, rightHip.y - leftHip.y, rightHip.z - leftHip.z) : null;
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

export function readRotation(world: Vec[], image: Vec[], baseline: YawBaseline | null): RotationReading {
  const empty = emptyReading();
  if (world.length < 33) return empty;
  const signs = baseline?.signs ?? detectSigns(world);
  if (!signs) return empty;
  const liveImageSigns = image.length >= 33 ? detectSigns(image) : null;
  const shoulder = yawOf(world[LM.leftShoulder], world[LM.rightShoulder], signs);
  const pelvis = yawOf(world[LM.leftHip], world[LM.rightHip], signs);
  const imageShoulder = liveImageSigns ? yawOf(image[LM.leftShoulder], image[LM.rightShoulder], liveImageSigns) : null;
  const head = yawOf(world[LM.leftEar], world[LM.rightEar], signs);
  const relative = shoulder != null && pelvis != null ? angleDelta(shoulder, pelvis) : null;
  const vectorRelative = signedAxisAngle(world[LM.leftShoulder], world[LM.rightShoulder], world[LM.leftHip], world[LM.rightHip], signs);
  const baseRelative = baseline ? angleDelta(baseline.shoulderYawDeg, baseline.pelvisYawDeg) : 0;
  const baseVector = baseline ? baseline.relativeYawDeg : 0;
  const depth = baseline
    ? foreshortenedYaw(world[LM.leftShoulder], world[LM.rightShoulder], signs, baseline.shoulderSpan, baseline.torsoScale, torsoScaleOf(world, signs))
    : { degrees: null, ratio: null };
  const imageDepth =
    baseline && liveImageSigns
      ? foreshortenedYaw(
          image[LM.leftShoulder],
          image[LM.rightShoulder],
          liveImageSigns,
          baseline.imageShoulderSpan,
          baseline.imageTorsoScale,
          torsoScaleOf(image, liveImageSigns)
        )
      : { degrees: null, ratio: null };
  return {
    shoulderYawDeg: shoulder,
    pelvisYawDeg: pelvis,
    shoulderFromNeutralDeg: baseline && shoulder != null ? angleDelta(shoulder, baseline.shoulderYawDeg) : null,
    legacyDeg: relative == null ? null : baseline ? angleDelta(relative, baseRelative) : relative,
    torsoPelvisDeg: vectorRelative == null ? null : baseline ? angleDelta(vectorRelative, baseVector) : vectorRelative,
    depthWidthDeg: depth.degrees,
    imageWidthDeg: imageDepth.degrees,
    shoulderSpanRatio: depth.ratio,
    imageShoulderYawDeg: imageShoulder,
    headYawDeg: head,
    imageLineDeltaDeg: imageLineDelta(image),
  };
}

export function captureYaws(world: Vec[], image: Vec[], signs: FrameSigns): YawBaseline | null {
  const reading = readRotation(world, image, null);
  if (reading.shoulderYawDeg == null || reading.pelvisYawDeg == null) return null;
  const relativeYawDeg = signedAxisAngle(world[LM.leftShoulder], world[LM.rightShoulder], world[LM.leftHip], world[LM.rightHip], signs);
  if (relativeYawDeg == null) return null;
  const imageSigns = image.length >= 33 ? detectSigns(image) : null;
  return {
    shoulderYawDeg: reading.shoulderYawDeg,
    pelvisYawDeg: reading.pelvisYawDeg,
    relativeYawDeg,
    shoulderSpan: axisSpan(world[LM.leftShoulder], world[LM.rightShoulder], signs.xSign),
    torsoScale: torsoScaleOf(world, signs),
    imageShoulderSpan: imageSigns ? axisSpan(image[LM.leftShoulder], image[LM.rightShoulder], imageSigns.xSign) : axisSpan(world[LM.leftShoulder], world[LM.rightShoulder], signs.xSign),
    imageTorsoScale: imageSigns ? torsoScaleOf(image, imageSigns) : torsoScaleOf(world, signs),
    signs,
  };
}

function yawOf(left: V3, right: V3, signs: FrameSigns): number | null {
  return subjectYawDeg(left, right, signs.zFront, signs.xSign);
}

/**
 * Magnitude from shoulder-width foreshortening. Sign from which shoulder is closer.
 * Z is not used as a length, because MediaPipe's depth is often compressed on a frontal camera.
 */
export function foreshortenedYaw(
  left: V3,
  right: V3,
  signs: FrameSigns,
  neutralSpan: number,
  neutralScale: number,
  currentScale: number
): { degrees: number | null; ratio: number | null } {
  const dx = (right.x - left.x) * signs.xSign;
  const dz = (right.z - left.z) * signs.zFront;
  const span = Math.abs(dx);
  if (neutralSpan < 1e-5 || currentScale < 1e-5 || neutralScale < 1e-5) return { degrees: null, ratio: null };
  const ratio = span / currentScale / (neutralSpan / neutralScale);
  if (!Number.isFinite(ratio)) return { degrees: null, ratio: null };
  const magnitude = (Math.acos(Math.max(-1, Math.min(1, ratio))) * 180) / Math.PI;
  const dead = Math.max(neutralSpan * 0.035, 1e-4);
  const sign = dz < -dead ? 1 : dz > dead ? -1 : 0;
  if (sign === 0) return { degrees: magnitude < 6 ? 0 : null, ratio };
  return { degrees: sign * magnitude, ratio };
}

function signedAxisAngle(leftShoulder: V3, rightShoulder: V3, leftHip: V3, rightHip: V3, signs: FrameSigns): number | null {
  const shoulder = horizontal(sub(rightShoulder, leftShoulder), signs);
  const pelvis = horizontal(sub(rightHip, leftHip), signs);
  const shoulderMag = Math.hypot(shoulder.x, shoulder.z);
  const pelvisMag = Math.hypot(pelvis.x, pelvis.z);
  if (shoulderMag < 1e-6 || pelvisMag < 1e-6) return null;
  const dotXZ = shoulder.x * pelvis.x + shoulder.z * pelvis.z;
  const crossXZ = shoulder.x * pelvis.z - shoulder.z * pelvis.x;
  return (Math.atan2(crossXZ, dotXZ) * 180) / Math.PI;
}

function horizontal(vector: V3, signs: FrameSigns): V3 {
  return { x: vector.x * signs.xSign, y: 0, z: vector.z * signs.zFront };
}

function axisSpan(left: V3, right: V3, xSign: number): number {
  return Math.abs((right.x - left.x) * xSign);
}

function torsoScaleOf(points: Vec[], signs: FrameSigns): number {
  const shoulder = midpoint(points[LM.leftShoulder], points[LM.rightShoulder]);
  const hip = midpoint(points[LM.leftHip], points[LM.rightHip]);
  return Math.max(Math.abs((shoulder.y - hip.y) * signs.yUp), 1e-4);
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

function imageLineDelta(image: Vec[]): number | null {
  if (image.length < 33) return null;
  const shoulder = (Math.atan2(image[LM.rightShoulder].y - image[LM.leftShoulder].y, image[LM.rightShoulder].x - image[LM.leftShoulder].x) * 180) / Math.PI;
  const pelvis = (Math.atan2(image[LM.rightHip].y - image[LM.leftHip].y, image[LM.rightHip].x - image[LM.leftHip].x) * 180) / Math.PI;
  return angleDelta(shoulder, pelvis);
}

function emptyReading(): RotationReading {
  return {
    shoulderYawDeg: null,
    pelvisYawDeg: null,
    shoulderFromNeutralDeg: null,
    legacyDeg: null,
    torsoPelvisDeg: null,
    depthWidthDeg: null,
    imageWidthDeg: null,
    shoulderSpanRatio: null,
    imageShoulderYawDeg: null,
    headYawDeg: null,
    imageLineDeltaDeg: null,
  };
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

export type SyntheticOptions = {
  shoulderYawDeg?: number;
  pelvisYawDeg?: number;
  leanRightM?: number;
  leanForwardM?: number;
  kneeShiftM?: number;
  hipShiftM?: number;
  visibility?: number;
  width?: number;
  height?: number;
};

/** Seated pose in a Y-up, +Z-toward-camera frame. Subject right rotation is positive. */
export function syntheticSeated(options: SyntheticOptions = {}): { image: Vec[]; world: Vec[] } {
  const visibility = options.visibility ?? 0.95;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const put = (index: number, point: V3, vis = visibility) => {
    world[index] = { ...point, visibility: vis };
  };
  const rot = (point: V3, deg: number): V3 => {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return { x: point.x * c + point.z * s, y: point.y, z: -point.x * s + point.z * c };
  };
  const shoulderYaw = options.shoulderYawDeg ?? 0;
  const pelvisYaw = options.pelvisYawDeg ?? 0;
  const leanRight = options.leanRightM ?? 0;
  const leanForward = options.leanForwardM ?? 0;
  const kneeShift = options.kneeShiftM ?? 0;
  const hipShift = options.hipShiftM ?? 0;
  put(LM.leftHip, rot({ x: -0.12 + hipShift, y: 0, z: 0 }, pelvisYaw));
  put(LM.rightHip, rot({ x: 0.12 + hipShift, y: 0, z: 0 }, pelvisYaw));
  put(LM.leftShoulder, { ...rot({ x: -0.2, y: 0.52, z: 0 }, shoulderYaw), x: rot({ x: -0.2, y: 0.52, z: 0 }, shoulderYaw).x + leanRight, z: rot({ x: -0.2, y: 0.52, z: 0 }, shoulderYaw).z + leanForward });
  put(LM.rightShoulder, { ...rot({ x: 0.2, y: 0.52, z: 0 }, shoulderYaw), x: rot({ x: 0.2, y: 0.52, z: 0 }, shoulderYaw).x + leanRight, z: rot({ x: 0.2, y: 0.52, z: 0 }, shoulderYaw).z + leanForward });
  put(LM.leftEar, rot({ x: -0.08, y: 0.68, z: 0.04 }, shoulderYaw));
  put(LM.rightEar, rot({ x: 0.08, y: 0.68, z: 0.04 }, shoulderYaw));
  put(LM.nose, { x: 0, y: 0.72, z: 0.16 });
  put(LM.leftKnee, { x: -0.12 + kneeShift + hipShift, y: -0.42, z: 0.06 });
  put(LM.rightKnee, { x: 0.12 + kneeShift + hipShift, y: -0.42, z: 0.06 });
  const image = world.map((point) => ({
    x: width * 0.5 + point.x * width * 0.85,
    y: height * 0.48 - point.y * height * 0.62,
    z: -point.z * width * 0.85,
    visibility: point.visibility,
  }));
  return { image, world };
}

import { angleDelta, midpoint } from "../pose/coordinateNormalization";
import { LM, type Vec } from "../pose/types";

export const ROTATION_ALGORITHMS = ["shoulderNeutral", "shoulderVsPelvis", "worldTorso", "imageDepth"] as const;
export type RotationAlgorithm = (typeof ROTATION_ALGORITHMS)[number];

export const ALGORITHM_INFO: Record<RotationAlgorithm, { label: string; note: string }> = {
  shoulderNeutral: {
    label: "A · Shoulder vs neutral",
    note: "Shoulder yaw relative to the calibrated shoulder axis. Pelvic rotation stays inside this number.",
  },
  shoulderVsPelvis: {
    label: "B · Shoulder vs pelvis",
    note: "Shoulder yaw minus pelvis yaw, relative to the calibrated neutral. A pelvis that turns with the chest is not counted as torso ROM.",
  },
  worldTorso: {
    label: "C · World torso frame",
    note: "Shoulder-versus-pelvis yaw after both axes are projected perpendicular to the torso long axis, so leaning changes the angle less.",
  },
  imageDepth: {
    label: "D · Image depth",
    note: "Shoulder-versus-pelvis yaw from normalized image x and image depth. Kept for comparison. The flat 2D shoulder-line angle is not used as ROM.",
  },
};

export type FrameSigns = { yUp: number; zFront: number };

export type V3 = { x: number; y: number; z: number };

export type YawBaseline = {
  shoulderYawDeg: number;
  pelvisYawDeg: number;
  torsoShoulderYawDeg: number;
  torsoPelvisYawDeg: number;
  imageShoulderYawDeg: number;
  imagePelvisYawDeg: number;
  signs: FrameSigns;
};

export type RotationReading = {
  shoulderYawDeg: number | null;
  pelvisYawDeg: number | null;
  torsoShoulderYawDeg: number | null;
  torsoPelvisYawDeg: number | null;
  imageShoulderYawDeg: number | null;
  imagePelvisYawDeg: number | null;
  headYawDeg: number | null;
  shoulderNeutralDeg: number | null;
  shoulderVsPelvisDeg: number | null;
  worldTorsoDeg: number | null;
  imageDepthDeg: number | null;
  imageLineDeltaDeg: number | null;
};

export function primaryAngle(reading: RotationReading, algorithm: RotationAlgorithm): number | null {
  if (algorithm === "shoulderNeutral") return reading.shoulderNeutralDeg;
  if (algorithm === "shoulderVsPelvis") return reading.shoulderVsPelvisDeg;
  if (algorithm === "worldTorso") return reading.worldTorsoDeg;
  return reading.imageDepthDeg;
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
  return { yUp, zFront: Math.abs(noseGap) < 1e-6 ? 1 : noseGap > 0 ? 1 : -1 };
}

/**
 * Yaw of the left-to-right axis. Subject's right rotation is positive:
 * the left landmark moves toward the camera and the right landmark moves away.
 */
export function subjectYawDeg(left: V3, right: V3, zFront: number): number | null {
  const dx = right.x - left.x;
  const dz = (right.z - left.z) * zFront;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return (-Math.atan2(dz, dx) * 180) / Math.PI;
}

export function readRotation(world: Vec[], image: Vec[], baseline: YawBaseline | null): RotationReading {
  const empty = emptyReading();
  if (world.length < 33) return empty;
  const signs = baseline?.signs ?? detectSigns(world);
  if (!signs) return empty;
  const imageSigns = image.length >= 33 ? detectSigns(image) : null;
  const shoulder = subjectYawDeg(world[LM.leftShoulder], world[LM.rightShoulder], signs.zFront);
  const pelvis = subjectYawDeg(world[LM.leftHip], world[LM.rightHip], signs.zFront);
  const torso = torsoYaws(world, signs);
  const imageShoulder = imageSigns ? subjectYawDeg(image[LM.leftShoulder], image[LM.rightShoulder], imageSigns.zFront) : null;
  const imagePelvis = imageSigns ? subjectYawDeg(image[LM.leftHip], image[LM.rightHip], imageSigns.zFront) : null;
  const head = subjectYawDeg(world[LM.leftEar], world[LM.rightEar], signs.zFront);
  const relative = shoulder != null && pelvis != null ? angleDelta(shoulder, pelvis) : null;
  const torsoRelative = torso.shoulder != null && torso.pelvis != null ? angleDelta(torso.shoulder, torso.pelvis) : null;
  const imageRelative = imageShoulder != null && imagePelvis != null ? angleDelta(imageShoulder, imagePelvis) : null;
  const baseRelative = baseline ? angleDelta(baseline.shoulderYawDeg, baseline.pelvisYawDeg) : 0;
  const baseTorso = baseline ? angleDelta(baseline.torsoShoulderYawDeg, baseline.torsoPelvisYawDeg) : 0;
  const baseImage = baseline ? angleDelta(baseline.imageShoulderYawDeg, baseline.imagePelvisYawDeg) : 0;
  return {
    shoulderYawDeg: shoulder,
    pelvisYawDeg: pelvis,
    torsoShoulderYawDeg: torso.shoulder,
    torsoPelvisYawDeg: torso.pelvis,
    imageShoulderYawDeg: imageShoulder,
    imagePelvisYawDeg: imagePelvis,
    headYawDeg: head,
    shoulderNeutralDeg: baseline && shoulder != null ? angleDelta(shoulder, baseline.shoulderYawDeg) : shoulder,
    shoulderVsPelvisDeg: relative == null ? null : baseline ? angleDelta(relative, baseRelative) : relative,
    worldTorsoDeg: torsoRelative == null ? null : baseline ? angleDelta(torsoRelative, baseTorso) : torsoRelative,
    imageDepthDeg: imageRelative == null ? null : baseline ? angleDelta(imageRelative, baseImage) : imageRelative,
    imageLineDeltaDeg: imageLineDelta(image),
  };
}

export function captureYaws(world: Vec[], image: Vec[], signs: FrameSigns): YawBaseline | null {
  const reading = readRotation(world, image, null);
  if (reading.shoulderYawDeg == null || reading.pelvisYawDeg == null || reading.torsoShoulderYawDeg == null || reading.torsoPelvisYawDeg == null) {
    return null;
  }
  return {
    shoulderYawDeg: reading.shoulderYawDeg,
    pelvisYawDeg: reading.pelvisYawDeg,
    torsoShoulderYawDeg: reading.torsoShoulderYawDeg,
    torsoPelvisYawDeg: reading.torsoPelvisYawDeg,
    imageShoulderYawDeg: reading.imageShoulderYawDeg ?? reading.shoulderYawDeg,
    imagePelvisYawDeg: reading.imagePelvisYawDeg ?? reading.pelvisYawDeg,
    signs,
  };
}

function torsoYaws(world: Vec[], signs: FrameSigns): { shoulder: number | null; pelvis: number | null } {
  const frame = bodyAxes(world, signs);
  if (!frame) return { shoulder: null, pelvis: null };
  const shoulder = projectPerp(sub(world[LM.rightShoulder], world[LM.leftShoulder]), frame.up);
  const pelvis = projectPerp(sub(world[LM.rightHip], world[LM.leftHip]), frame.up);
  return {
    shoulder: subjectYawDeg(scale(shoulder, -0.5), scale(shoulder, 0.5), signs.zFront),
    pelvis: subjectYawDeg(scale(pelvis, -0.5), scale(pelvis, 0.5), signs.zFront),
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
    torsoShoulderYawDeg: null,
    torsoPelvisYawDeg: null,
    imageShoulderYawDeg: null,
    imagePelvisYawDeg: null,
    headYawDeg: null,
    shoulderNeutralDeg: null,
    shoulderVsPelvisDeg: null,
    worldTorsoDeg: null,
    imageDepthDeg: null,
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

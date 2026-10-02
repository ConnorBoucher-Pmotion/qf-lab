import { angleDelta, median } from "../pose/coordinateNormalization";
import { LM, jointIndex, otherSide, type Side, type Vec } from "../pose/types";

/**
 * QF measurement engine.
 *
 * All QF angle math lives here. MediaPipe, filtering, the state machine, and
 * the UI only call `computeAngles` and `buildAngleReference`, so this file can
 * change without touching them.
 *
 * Movement (reference video): seated on a table edge facing the camera, tested
 * leg hanging with hip and knee near 90°. The femur points toward the camera.
 * Hip internal rotation spins the femur about its own long axis, so the shank
 * swings sideways in the plane perpendicular to the femur. Foot moving
 * laterally (away from the midline) is positive.
 *
 * Landmarks: tested hip, knee, ankle (23/25/27 left, 24/26/28 right) and both
 * hips for the pelvis line. The other leg, arms, and face are never used.
 *
 * Image coordinates are unmirrored pixels: x right, y down. Facing the camera,
 * the athlete's left is +x. Let a = atan2(ankle.x − knee.x, ankle.y − knee.y),
 * the shank direction from image-down.
 *
 * relative2d
 *   lateral·a − hang, where hang is the median of lateral·a over calibration.
 *   Camera roll cancels. Camera elevation φ and azimuth ψ relative to the femur
 *   scale the result: reported ≈ atan(tan θ · cos ψ / cos φ).
 * pelvis2d (default)
 *   Measured from the perpendicular of the current hip line: lateral·(a + τ),
 *   τ = hip-line tilt, minus its hang value. Hip hiking and camera roll cancel
 *   frame by frame. Hip landmark jitter is added.
 * plane2d (experimental)
 *   The image shank vector is lifted onto the plane perpendicular to the femur.
 *   The femur direction comes from MediaPipe world landmarks, median over the
 *   calibration hold only; per-frame depth is not used. Intended to remove the
 *   camera elevation/azimuth scaling above.
 * absolute2d
 *   lateral·a, from image vertical. Equals a gravity inclinometer only with a
 *   level camera. Not referenced to the hang.
 * world3d (experimental)
 *   Per-frame MediaPipe world shank projected onto the plane perpendicular to
 *   the calibrated world femur, signed angle from the calibrated hang. Uses
 *   per-frame depth, which is the noisiest MediaPipe output.
 */

export const ANGLE_METHODS = ["relative2d", "pelvis2d", "plane2d", "absolute2d", "world3d"] as const;
export type AngleMethod = (typeof ANGLE_METHODS)[number];
export type QFAngleSet = Record<AngleMethod, number | null>;

export const ANGLE_METHOD_INFO: Record<AngleMethod, { label: string; note: string }> = {
  relative2d: { label: "Image, from hang", note: "Image shank angle minus the calibrated hang. Camera roll cancels." },
  pelvis2d: { label: "Pelvis frame (default)", note: "Shank from the hip line's perpendicular, minus the hang. Hip hike and camera roll cancel each frame." },
  plane2d: { label: "Swing plane (exp.)", note: "Image shank lifted onto the plane perpendicular to the calibrated femur." },
  absolute2d: { label: "Image vertical", note: "Shank from image vertical. Matches an inclinometer only if the camera is level." },
  world3d: { label: "World 3D (exp.)", note: "MediaPipe world shank about the calibrated femur axis. Uses per-frame depth." },
};

export type V3 = { x: number; y: number; z: number };
export type PlaneBasis = { axis: V3; e1: V3; e2: V3 };

export type QFAngleReference = {
  hangAbsoluteDeg: number;
  hangPelvisDeg: number | null;
  plane: PlaneBasis | null;
  world: PlaneBasis | null;
  /** Camera height relative to the femur line, from world landmarks. Positive: camera above. */
  femurElevationDeg: number | null;
  /** Camera side offset relative to the femur line, image +x positive. */
  femurAzimuthDeg: number | null;
};

/** Below this, the femur is too side-on to the camera for the swing plane to be seen. */
const MIN_FEMUR_DEPTH = 0.35;

export function emptyAngles(): QFAngleSet {
  return { relative2d: null, pelvis2d: null, plane2d: null, absolute2d: null, world3d: null };
}

/** Image x direction that is lateral for the tested leg. */
export function lateralSignX(side: Side): 1 | -1 {
  return side === "left" ? 1 : -1;
}

/** Shank direction from image-down, degrees, positive toward image +x. */
export function imageShankRawDeg(knee: Vec, ankle: Vec): number {
  return deg(Math.atan2(ankle.x - knee.x, ankle.y - knee.y));
}

/** Shank from image vertical, positive when the foot is lateral. */
export function shankLateralDeg(knee: Vec, ankle: Vec, side: Side): number {
  return lateralSignX(side) * imageShankRawDeg(knee, ankle);
}

/** Right hip → left hip, from image +x. 0 when level; positive when the athlete's left hip is lower. */
export function hipLineTiltDeg(leftHip: Vec, rightHip: Vec): number {
  return deg(Math.atan2(leftHip.y - rightHip.y, leftHip.x - rightHip.x));
}

/** Shank measured from the downward perpendicular of the hip line, positive lateral. */
export function pelvisFrameShankDeg(knee: Vec, ankle: Vec, leftHip: Vec, rightHip: Vec, side: Side): number {
  return lateralSignX(side) * angleDelta(imageShankRawDeg(knee, ankle), -hipLineTiltDeg(leftHip, rightHip));
}

/** Per-frame values the hang reference is built from. */
export function hangValues(image: Vec[], side: Side): { absolute: number; pelvis: number } | null {
  if (image.length < 33) return null;
  const knee = image[jointIndex(side, "knee")];
  const ankle = image[jointIndex(side, "ankle")];
  return {
    absolute: shankLateralDeg(knee, ankle, side),
    pelvis: pelvisFrameShankDeg(knee, ankle, image[LM.leftHip], image[LM.rightHip], side),
  };
}

/**
 * Built once from the calibration hold.
 * `hang` holds the per-frame values; `image`/`world` are the median poses.
 */
export function buildAngleReference(
  hang: { absolute: number[]; pelvis: number[] },
  image: Vec[],
  world: Vec[],
  side: Side
): QFAngleReference {
  const reference: QFAngleReference = {
    hangAbsoluteDeg: median(hang.absolute),
    hangPelvisDeg: hang.pelvis.length > 0 ? median(hang.pelvis) : null,
    plane: null,
    world: null,
    femurElevationDeg: null,
    femurAzimuthDeg: null,
  };
  if (image.length < 33 || world.length < 33) return reference;

  const hip = world[jointIndex(side, "hip")];
  const knee = world[jointIndex(side, "knee")];
  const ankle = world[jointIndex(side, "ankle")];
  const otherHip = world[jointIndex(otherSide(side), "hip")];

  const sx = axisSign(image, world, "x");
  const sy = axisSign(image, world, "y");
  const femurCamera = normalize({ x: sx * (knee.x - hip.x), y: sy * (knee.y - hip.y), z: knee.z - hip.z });
  if (femurCamera) {
    reference.femurElevationDeg = deg(Math.atan2(femurCamera.y, Math.abs(femurCamera.z)));
    reference.femurAzimuthDeg = deg(Math.atan2(femurCamera.x, Math.abs(femurCamera.z)));
    if (Math.abs(femurCamera.z) >= MIN_FEMUR_DEPTH) {
      const imgKnee = image[jointIndex(side, "knee")];
      const imgAnkle = image[jointIndex(side, "ankle")];
      const e1 = normalize(lift(imgAnkle.x - imgKnee.x, imgAnkle.y - imgKnee.y, femurCamera));
      let e2 = e1 ? normalize(cross(femurCamera, e1)) : null;
      if (e1 && e2) {
        if (e2.x * lateralSignX(side) < 0) e2 = scale(e2, -1);
        reference.plane = { axis: femurCamera, e1, e2 };
      }
    }
  }

  const axis = normalize(sub(knee, hip));
  if (axis) {
    const shank = sub(ankle, knee);
    const e1 = normalize(sub(shank, scale(axis, dot(shank, axis))));
    let e2 = e1 ? normalize(cross(axis, e1)) : null;
    if (e1 && e2) {
      if (dot(e2, sub(hip, otherHip)) < 0) e2 = scale(e2, -1);
      reference.world = { axis, e1, e2 };
    }
  }
  return reference;
}

/** Every method for one frame. Methods that need the reference are null before calibration. */
export function computeAngles(image: Vec[], world: Vec[], side: Side, ref: QFAngleReference | null): QFAngleSet {
  const out = emptyAngles();
  if (image.length < 33) return out;
  const knee = image[jointIndex(side, "knee")];
  const ankle = image[jointIndex(side, "ankle")];
  const absolute = shankLateralDeg(knee, ankle, side);
  out.absolute2d = absolute;
  if (!ref) return out;

  out.relative2d = angleDelta(absolute, ref.hangAbsoluteDeg);
  if (ref.hangPelvisDeg != null) {
    out.pelvis2d = angleDelta(pelvisFrameShankDeg(knee, ankle, image[LM.leftHip], image[LM.rightHip], side), ref.hangPelvisDeg);
  }
  if (ref.plane) {
    out.plane2d = planeAngle(lift(ankle.x - knee.x, ankle.y - knee.y, ref.plane.axis), ref.plane);
  }
  if (ref.world && world.length >= 33) {
    const wKnee = world[jointIndex(side, "knee")];
    const wAnkle = world[jointIndex(side, "ankle")];
    const shank = sub(wAnkle, wKnee);
    out.world3d = planeAngle(sub(shank, scale(ref.world.axis, dot(shank, ref.world.axis))), ref.world);
  }
  return out;
}

function planeAngle(vector: V3, basis: PlaneBasis): number | null {
  const a = dot(vector, basis.e1);
  const b = dot(vector, basis.e2);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.hypot(a, b) < 1e-9) return null;
  return deg(Math.atan2(b, a));
}

/** Image shank (dx, dy) placed in camera space on the plane perpendicular to `axis`. */
function lift(dx: number, dy: number, axis: V3): V3 {
  return { x: dx, y: dy, z: -(axis.x * dx + axis.y * dy) / axis.z };
}

/** World x/y may or may not share the image axis directions; measure it instead of assuming. */
function axisSign(image: Vec[], world: Vec[], axis: "x" | "y"): 1 | -1 {
  const pairs: Array<[number, number]> = [
    [LM.leftHip, LM.rightHip],
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftShoulder, LM.leftHip],
    [LM.rightShoulder, LM.rightHip],
    [LM.leftKnee, LM.leftAnkle],
    [LM.rightKnee, LM.rightAnkle],
  ];
  let sum = 0;
  for (const [a, b] of pairs) sum += (image[a][axis] - image[b][axis]) * (world[a][axis] - world[b][axis]);
  return sum < 0 ? -1 : 1;
}

function deg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: V3, k: number): V3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(a: V3): V3 | null {
  const length = Math.hypot(a.x, a.y, a.z);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return scale(a, 1 / length);
}

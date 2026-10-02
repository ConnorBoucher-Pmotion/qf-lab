import { LM, type Side, type Vec } from "../src/pose/types";
import type { QFObservation } from "../src/qf/qfMeasurement";
import { QFSession } from "../src/qf/qfStateMachine";
import type { QFSnapshot } from "../src/qf/qfTypes";
import type { QFConfig } from "../src/qf/qfConfig";

/**
 * Synthetic seated QF athlete seen by a pinhole camera.
 *
 * Body frame (metres, pelvis centre origin): X athlete-left, Y down, Z away
 * from the camera. The athlete faces the camera and the femurs point toward
 * it (−Z). Hip internal rotation spins the shank about the femur axis
 * (Rodrigues), so the foot moves laterally.
 *
 * Camera: pinhole, look-at a point between pelvis and knees, 1280×720,
 * 60° horizontal FOV. World landmarks are emitted MediaPipe-style:
 * hip-centred, metric, in camera axes. Image and world get seeded noise
 * (world depth noisier, as with MediaPipe).
 */

export type BodyParams = {
  irDeg: number;
  hipHikeDeg: number;
  kneeLateralM: number;
  torsoLeanDeg: number;
  kneeExtensionDeg: number;
  pelvisShiftM: number;
};

export type CameraParams = {
  /** Camera position in the body frame. */
  x: number;
  y: number;
  z: number;
  rollDeg: number;
  width: number;
  height: number;
  fovDeg: number;
};

export const BODY_NEUTRAL: BodyParams = { irDeg: 0, hipHikeDeg: 0, kneeLateralM: 0, torsoLeanDeg: 0, kneeExtensionDeg: 0, pelvisShiftM: 0 };

const base = { width: 1280, height: 720, fovDeg: 60, rollDeg: 0 };
/** Test protocol positions A–E. Y is down: negative is higher. */
export const CAMERAS: Record<string, CameraParams> = {
  "A ideal": { ...base, x: 0, y: 0.15, z: -2.4 },
  "B higher": { ...base, x: 0, y: -0.6, z: -2.4 },
  "C lower": { ...base, x: 0, y: 0.55, z: -2.3 },
  "D left": { ...base, x: 0.7, y: 0.15, z: -2.3 },
  "D right": { ...base, x: -0.7, y: 0.15, z: -2.3 },
  "E closer": { ...base, x: 0, y: 0.15, z: -1.7 },
  "E farther": { ...base, x: 0, y: 0.15, z: -3.4 },
  "A + 6° roll": { ...base, x: 0, y: 0.15, z: -2.4, rollDeg: 6 },
};

type V = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): V => ({ x, y, z });
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y, a.z + b.z);
const subv = (a: V, b: V): V => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V, k: number): V => v(a.x * k, a.y * k, a.z * k);
const dotv = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossv = (a: V, b: V): V => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a: V): V => mul(a, 1 / Math.hypot(a.x, a.y, a.z));
const rad = (d: number) => (d * Math.PI) / 180;

function rodrigues(p: V, axis: V, angle: number): V {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(mul(p, c), mul(crossv(axis, p), s)), mul(axis, dotv(axis, p) * (1 - c)));
}

function rotZ(p: V, angle: number, center: V): V {
  const d = subv(p, center);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(center, v(d.x * c - d.y * s, d.x * s + d.y * c, d.z));
}

export function bodyPoints(side: Side, b: BodyParams): V[] {
  const pts: V[] = Array.from({ length: 33 }, () => v(0, 0, 0));
  const lat = side === "left" ? 1 : -1;
  const pelvis = v(lat * b.pelvisShiftM, 0, 0);
  const hipL = add(pelvis, v(0.13, 0, 0));
  const hipR = add(pelvis, v(-0.13, 0, 0));
  const femurLen = 0.44;
  const shankLen = 0.42;

  const leg = (hip: V, legLat: number, ir: number, ext: number, kneeShift: number) => {
    const knee = add(hip, v(legLat * 0.04 + legLat * kneeShift, 0.02, -femurLen));
    const axis = norm(subv(knee, hip));
    let shank = v(0, Math.cos(rad(ext)), -Math.sin(rad(ext)));
    // About the femur axis (pointing at the camera), positive angle moves the foot toward +X.
    shank = rodrigues(shank, axis, legLat * rad(ir));
    return { knee, ankle: add(knee, mul(shank, shankLen)) };
  };
  const tested = leg(side === "left" ? hipL : hipR, lat, b.irDeg, b.kneeExtensionDeg, b.kneeLateralM);
  const other = leg(side === "left" ? hipR : hipL, -lat, 0, 0, 0);

  const hike = -lat * rad(b.hipHikeDeg);
  const tilt = (p: V) => rotZ(p, hike, pelvis);
  const tHip = tilt(side === "left" ? hipL : hipR);
  const oHip = tilt(side === "left" ? hipR : hipL);
  const tKnee = tilt(tested.knee);
  const tAnkle = tilt(tested.ankle);

  const lean = rad(b.torsoLeanDeg);
  const shL = rotZ(add(pelvis, v(0.19, -0.52, 0.02)), lean, pelvis);
  const shR = rotZ(add(pelvis, v(-0.19, -0.52, 0.02)), lean, pelvis);
  const head = rotZ(add(pelvis, v(0, -0.75, -0.04)), lean, pelvis);

  const L = side === "left";
  pts[LM.leftHip] = L ? tHip : oHip;
  pts[LM.rightHip] = L ? oHip : tHip;
  pts[LM.leftKnee] = L ? tKnee : other.knee;
  pts[LM.rightKnee] = L ? other.knee : tKnee;
  pts[LM.leftAnkle] = L ? tAnkle : other.ankle;
  pts[LM.rightAnkle] = L ? other.ankle : tAnkle;
  pts[LM.leftShoulder] = shL;
  pts[LM.rightShoulder] = shR;
  for (let i = 0; i <= 10; i += 1) pts[i] = add(head, v((i % 3) * 0.02 - 0.02, (i % 2) * 0.02, -0.05));
  pts[LM.leftElbow] = add(shL, v(0.05, 0.25, -0.05));
  pts[LM.rightElbow] = add(shR, v(-0.05, 0.25, -0.05));
  pts[LM.leftWrist] = add(pts[LM.leftHip], v(0.08, 0.05, -0.2));
  pts[LM.rightWrist] = add(pts[LM.rightHip], v(-0.08, 0.05, -0.2));
  for (const i of [17, 19, 21]) pts[i] = pts[LM.leftWrist];
  for (const i of [18, 20, 22]) pts[i] = pts[LM.rightWrist];
  pts[29] = add(pts[LM.leftAnkle], v(0, 0.04, 0.05));
  pts[30] = add(pts[LM.rightAnkle], v(0, 0.04, 0.05));
  pts[31] = add(pts[LM.leftAnkle], v(0, 0.06, -0.12));
  pts[32] = add(pts[LM.rightAnkle], v(0, 0.06, -0.12));
  return pts;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export type Noise = { px: number; world: number; worldZ: number };
export const DEFAULT_NOISE: Noise = { px: 1.2, world: 0.01, worldZ: 0.03 };

export function project(points: V[], cam: CameraParams, rng: () => number, noise: Noise, visibility: Partial<Record<number, number>> = {}): QFObservation {
  const C = v(cam.x, cam.y, cam.z);
  const target = v(0, 0.15, -0.25);
  const f = norm(subv(target, C));
  let r = norm(crossv(v(0, 1, 0), f));
  let u = crossv(f, r);
  if (cam.rollDeg) {
    r = rodrigues(r, f, rad(cam.rollDeg));
    u = rodrigues(u, f, rad(cam.rollDeg));
  }
  const focal = cam.width / 2 / Math.tan(rad(cam.fovDeg / 2));
  const pelvis = mul(add(points[LM.leftHip], points[LM.rightHip]), 0.5);
  const image: Vec[] = [];
  const world: Vec[] = [];
  points.forEach((p, i) => {
    const d = subv(p, C);
    const xc = dotv(d, r);
    const yc = dotv(d, u);
    const zc = dotv(d, f);
    const vis = visibility[i] ?? 0.95;
    image.push({
      x: cam.width / 2 + (focal * xc) / zc + gaussian(rng) * noise.px,
      y: cam.height / 2 + (focal * yc) / zc + gaussian(rng) * noise.px,
      z: 0,
      visibility: vis,
    });
    const w = subv(p, pelvis);
    world.push({
      x: dotv(w, r) + gaussian(rng) * noise.world,
      y: dotv(w, u) + gaussian(rng) * noise.world,
      z: dotv(w, f) + gaussian(rng) * noise.worldZ,
      visibility: vis,
    });
  });
  return { width: cam.width, height: cam.height, image, world };
}

export type Phase = {
  durationS: number;
  body: (u: number) => Partial<BodyParams>;
  visibility?: (u: number, frame: number) => Partial<Record<number, number>>;
  /** Replace a frame with garbage for this predicate (single-frame spike). */
  spike?: (u: number, frame: number) => boolean;
  absent?: boolean;
};

export type RunResult = { final: QFSnapshot; states: string[]; t: number; snapshots: QFSnapshot[] };

export function run(
  session: QFSession,
  opts: { side: Side; camera: CameraParams; phases: Phase[]; seed?: number; fps?: number; noise?: Noise; t0?: number; keep?: boolean }
): RunResult {
  const rng = mulberry32(opts.seed ?? 1);
  const fps = opts.fps ?? 30;
  const dt = 1000 / fps;
  let t = opts.t0 ?? 0;
  const states: string[] = [];
  const snapshots: QFSnapshot[] = [];
  let final: QFSnapshot | null = null;
  for (const phase of opts.phases) {
    const frames = Math.max(1, Math.round(phase.durationS * fps));
    for (let k = 0; k < frames; k += 1) {
      const u = frames === 1 ? 1 : k / (frames - 1);
      t += dt;
      let obs: QFObservation;
      if (phase.absent) {
        obs = { width: opts.camera.width, height: opts.camera.height, image: [], world: [] };
      } else {
        const body = { ...BODY_NEUTRAL, ...phase.body(u) };
        obs = project(bodyPoints(opts.side, body), opts.camera, rng, opts.noise ?? DEFAULT_NOISE, phase.visibility?.(u, k) ?? {});
        if (phase.spike?.(u, k)) {
          const ankle = opts.side === "left" ? LM.leftAnkle : LM.rightAnkle;
          obs.image[ankle] = { ...obs.image[ankle], x: obs.image[ankle].x + (opts.side === "left" ? 60 : -60) };
        }
      }
      final = session.push(obs, Math.round(t));
      if (states[states.length - 1] !== final.state) states.push(final.state);
      if (opts.keep) snapshots.push(final);
    }
  }
  if (!final) throw new Error("no frames");
  return { final, states, t, snapshots };
}

/** Hang → ramp → hold. The standard trial. */
export function trialPhases(irDeg: number, extra: Partial<BodyParams> = {}, holdS = 2.2, calibrate = true): Phase[] {
  const phases: Phase[] = [];
  if (calibrate) phases.push({ durationS: 2.2, body: () => ({ ...extra, irDeg: 0 }) });
  else phases.push({ durationS: 0.4, body: () => ({ ...extra, irDeg: 0 }) });
  phases.push({ durationS: 1.0, body: (u) => ({ ...extra, irDeg: irDeg * smoothstep(u) }) });
  phases.push({ durationS: holdS, body: () => ({ ...extra, irDeg }) });
  return phases;
}

export function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

export function newSession(config: QFConfig, side: Side): QFSession {
  return new QFSession(config, side);
}

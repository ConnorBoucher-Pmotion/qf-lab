import { mid } from "./landmarks";
import type { LandmarkSample, ObliqueBaseline, V3 } from "./types";
import { angleDelta } from "./vectors";

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export type TorsoFrame = {
  shoulderAxis: V3;
  torsoUp: V3;
  torsoForward: V3;
  /** Horizontal-plane yaw of torso forward (subject-right positive, degrees). */
  yawDeg: number;
  shoulderMid: V3;
  hipMid: V3;
};

export type PelvisFrame = {
  hipAxis: V3;
  forward: V3;
  yawDeg: number;
  hipMid: V3;
};

export type OrientationReading = {
  /** Legacy: horizontal yaw of the shoulder AXIS (right−left). Plateau-prone. */
  oldShoulderLineYawDeg: number | null;
  oldShoulderLineFromNeutralDeg: number | null;
  /** Absolute torso-frame yaw (forward projected to XZ). */
  upperTorsoYawDeg: number | null;
  /** Absolute pelvis-frame yaw. */
  pelvisYawDeg: number | null;
  /** Change from sealed neutral. */
  upperTorsoFromNeutralDeg: number | null;
  pelvisFromNeutralDeg: number | null;
  /**
   * Primary TL ROM (signed, subject-right +):
   * upperTorsoFromNeutral − pelvisFromNeutral
   */
  thoracicRomDeg: number | null;
  /** Kabsch yaw of upper-body landmarks (shoulders + elbows) vs neutral. */
  multiLandmarkYawDeg: number | null;
  multiLandmarkFromNeutralDeg: number | null;
  /** Screen-space 2D shoulder-line angle from image landmarks (debug only). */
  imageShoulderLineDeg: number | null;
  frame: TorsoFrame | null;
  pelvis: PelvisFrame | null;
};

const ZERO: V3 = { x: 0, y: 0, z: 0 };

/**
 * MediaPipe Pose world landmarks (this project):
 *   x → subject right
 *   y → down (gravity); synthetic tests use Y-up — torsoUp from landmarks handles both
 *   z → toward camera
 *
 * Image landmarks: x/y in pixels, z is relative depth *scaled by image width* (not meters).
 */
export function buildTorsoFrame(sample: LandmarkSample): TorsoFrame | null {
  const shoulderMid = mid(sample.leftShoulder, sample.rightShoulder);
  const hipMid = mid(sample.leftHip, sample.rightHip);
  const shoulderAxis = normalize(sub(sample.rightShoulder, sample.leftShoulder));
  // Anatomical up from hips → shoulders (works for MediaPipe Y-down and synthetic Y-up).
  const torsoUp = normalize(sub(shoulderMid, hipMid));
  if (!shoulderAxis || !torsoUp) return null;

  // Facing = shoulderAxis × torsoUp, then flip so it agrees with the nose.
  let torsoForward = normalize(cross(shoulderAxis, torsoUp));
  if (!torsoForward) return null;
  const noseDir = sub(sample.nose, shoulderMid);
  if (dot(torsoForward, noseDir) < 0) torsoForward = scale(torsoForward, -1);

  const yawDeg = horizontalForwardYawDeg(torsoForward);
  if (yawDeg == null) return null;
  return { shoulderAxis, torsoUp, torsoForward, yawDeg, shoulderMid, hipMid };
}

export function buildPelvisFrame(sample: LandmarkSample): PelvisFrame | null {
  const hipMid = mid(sample.leftHip, sample.rightHip);
  const hipAxis = normalize(sub(sample.rightHip, sample.leftHip));
  if (!hipAxis) return null;
  // Pelvis "up" ≈ torso up from hips to shoulders for a consistent facing sense.
  const shoulderMid = mid(sample.leftShoulder, sample.rightShoulder);
  const up = normalize(sub(shoulderMid, hipMid)) ?? { x: 0, y: 1, z: 0 };
  let forward = normalize(cross(hipAxis, up));
  if (!forward) return null;
  const noseDir = sub(sample.nose, hipMid);
  if (dot(forward, noseDir) < 0) forward = scale(forward, -1);
  const yawDeg = horizontalForwardYawDeg(forward);
  if (yawDeg == null) return null;
  return { hipAxis, forward, yawDeg, hipMid };
}

/** Subject-right-positive yaw of a forward vector on the horizontal (XZ) plane. */
export function horizontalForwardYawDeg(forward: V3): number | null {
  const hx = forward.x;
  const hz = forward.z;
  if (Math.hypot(hx, hz) < 1e-6) return null;
  // atan2(x, z): 0 when facing +Z (camera), positive when rotating toward +X (subject right).
  return (Math.atan2(hx, hz) * 180) / Math.PI;
}

/** Old shoulder-AXIS yaw (subject-right +). Kept for plateau diagnosis. */
export function oldShoulderAxisYawDeg(sample: LandmarkSample): number | null {
  const axis = sub(sample.rightShoulder, sample.leftShoulder);
  const h = Math.hypot(axis.x, axis.z);
  if (h < 1e-6) return null;
  // Match prior oblique convention: −atan2(z, x).
  return (-Math.atan2(axis.z, axis.x) * 180) / Math.PI;
}

/** 2D screen shoulder-line angle (degrees). Debug only — not used for ROM. */
export function imageShoulderLineDeg(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
}

/**
 * Kabsch rigid alignment of upper-body landmarks (shoulders + elbows) vs neutral.
 * Hips are intentionally excluded so thoracic motion is not suppressed.
 * Returns the yaw (about vertical) of the best-fit rotation, subject-right positive.
 */
export function multiLandmarkUpperYawDeg(sample: LandmarkSample, baseline: ObliqueBaseline): number | null {
  const current = upperCloud(sample);
  const neutral = upperCloudFromBaseline(baseline);
  const R = kabschRotation(neutral, current);
  if (!R) return null;
  // Apply R to neutral facing (+Z in the shoulder-centered frame) and read yaw.
  // Equivalent: extract yaw from R about vertical. We use the rotated +Z axis.
  const rotatedForward = {
    x: R[0][2],
    y: R[1][2],
    z: R[2][2],
  };
  return horizontalForwardYawDeg(rotatedForward);
}

export function computeOrientation(
  sample: LandmarkSample,
  baseline: ObliqueBaseline | null,
  imageLeft?: { x: number; y: number } | null,
  imageRight?: { x: number; y: number } | null
): OrientationReading {
  const frame = buildTorsoFrame(sample);
  const pelvis = buildPelvisFrame(sample);
  const oldLine = oldShoulderAxisYawDeg(sample);
  const imageLine =
    imageLeft && imageRight ? imageShoulderLineDeg(imageLeft, imageRight) : null;

  if (!baseline || !frame || !pelvis) {
    return {
      oldShoulderLineYawDeg: oldLine,
      oldShoulderLineFromNeutralDeg: null,
      upperTorsoYawDeg: frame?.yawDeg ?? null,
      pelvisYawDeg: pelvis?.yawDeg ?? null,
      upperTorsoFromNeutralDeg: null,
      pelvisFromNeutralDeg: null,
      thoracicRomDeg: null,
      multiLandmarkYawDeg: null,
      multiLandmarkFromNeutralDeg: null,
      imageShoulderLineDeg: imageLine,
      frame,
      pelvis,
    };
  }

  const upperFromNeutral = angleDelta(frame.yawDeg, baseline.torsoYawDeg);
  const pelvisFromNeutral = angleDelta(pelvis.yawDeg, baseline.pelvisFrameYawDeg);
  const thoracic = upperFromNeutral - pelvisFromNeutral;
  const multi = multiLandmarkUpperYawDeg(sample, baseline);
  // Kabsch returns absolute yaw of the rotation from neutral → current, already a delta≈0 at identity.
  const multiFromNeutral = multi;

  return {
    oldShoulderLineYawDeg: oldLine,
    oldShoulderLineFromNeutralDeg:
      oldLine == null ? null : angleDelta(oldLine, baseline.shoulderYawDeg),
    upperTorsoYawDeg: frame.yawDeg,
    pelvisYawDeg: pelvis.yawDeg,
    upperTorsoFromNeutralDeg: upperFromNeutral,
    pelvisFromNeutralDeg: pelvisFromNeutral,
    thoracicRomDeg: thoracic,
    multiLandmarkYawDeg: multi,
    multiLandmarkFromNeutralDeg: multiFromNeutral,
    imageShoulderLineDeg: imageLine,
    frame,
    pelvis,
  };
}

function upperCloud(sample: LandmarkSample): V3[] {
  const origin = mid(sample.leftShoulder, sample.rightShoulder);
  return [
    sub(sample.leftShoulder, origin),
    sub(sample.rightShoulder, origin),
    sub(sample.leftElbow, origin),
    sub(sample.rightElbow, origin),
  ];
}

function upperCloudFromBaseline(baseline: ObliqueBaseline): V3[] {
  const origin = baseline.shoulderMid;
  return [
    sub(baseline.leftShoulder, origin),
    sub(baseline.rightShoulder, origin),
    sub(baseline.leftElbow, origin),
    sub(baseline.rightElbow, origin),
  ];
}

/**
 * Kabsch: best-fit rotation mapping neutral[i] → current[i].
 * Both clouds should already be centered (we center again for safety).
 */
export function kabschRotation(neutral: V3[], current: V3[]): number[][] | null {
  if (neutral.length < 3 || neutral.length !== current.length) return null;
  const n = neutral.length;
  const cA = centroid(neutral);
  const cB = centroid(current);
  const A = neutral.map((p) => sub(p, cA));
  const B = current.map((p) => sub(p, cB));

  // Covariance H = A^T B (3×3)
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i += 1) {
    H[0][0] += A[i].x * B[i].x;
    H[0][1] += A[i].x * B[i].y;
    H[0][2] += A[i].x * B[i].z;
    H[1][0] += A[i].y * B[i].x;
    H[1][1] += A[i].y * B[i].y;
    H[1][2] += A[i].y * B[i].z;
    H[2][0] += A[i].z * B[i].x;
    H[2][1] += A[i].z * B[i].y;
    H[2][2] += A[i].z * B[i].z;
  }

  const svd = svd3(H);
  if (!svd) return null;
  let R = matMul(svd.V, transpose(svd.U));
  if (det3(R) < 0) {
    // Reflection → flip last column of V
    const Vfix = [
      [svd.V[0][0], svd.V[0][1], -svd.V[0][2]],
      [svd.V[1][0], svd.V[1][1], -svd.V[1][2]],
      [svd.V[2][0], svd.V[2][1], -svd.V[2][2]],
    ];
    R = matMul(Vfix, transpose(svd.U));
  }
  return R;
}

function centroid(points: V3[]): V3 {
  const n = points.length || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

/** Compact 3×3 SVD via Jacobi eigen-decomposition of H^T H / H H^T. */
function svd3(H: number[][]): { U: number[][]; S: number[]; V: number[][] } | null {
  const HtH = matMul(transpose(H), H);
  const eig = jacobiEigen3(HtH);
  if (!eig) return null;
  // V = eigenvectors; S = sqrt(eigenvalues)
  const V = eig.vectors;
  const S = eig.values.map((v) => Math.sqrt(Math.max(0, v)));
  // U columns = H V / s
  const U: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let j = 0; j < 3; j += 1) {
    const vCol = [V[0][j], V[1][j], V[2][j]];
    const hv = [
      H[0][0] * vCol[0] + H[0][1] * vCol[1] + H[0][2] * vCol[2],
      H[1][0] * vCol[0] + H[1][1] * vCol[1] + H[1][2] * vCol[2],
      H[2][0] * vCol[0] + H[2][1] * vCol[1] + H[2][2] * vCol[2],
    ];
    const s = S[j] > 1e-10 ? S[j] : 1;
    U[0][j] = hv[0] / s;
    U[1][j] = hv[1] / s;
    U[2][j] = hv[2] / s;
    if (S[j] <= 1e-10) {
      // Orthonormalize leftover column
      U[0][j] = j === 0 ? 1 : 0;
      U[1][j] = j === 1 ? 1 : 0;
      U[2][j] = j === 2 ? 1 : 0;
    }
  }
  // Re-orthonormalize U
  orthonormalizeColumns(U);
  return { U, S, V };
}

function jacobiEigen3(Ain: number[][]): { values: number[]; vectors: number[][] } | null {
  const A = [
    [Ain[0][0], Ain[0][1], Ain[0][2]],
    [Ain[1][0], Ain[1][1], Ain[1][2]],
    [Ain[2][0], Ain[2][1], Ain[2][2]],
  ];
  let V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 32; iter += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > max) {
      max = Math.abs(A[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(A[1][2]) > max) {
      max = Math.abs(A[1][2]);
      p = 1;
      q = 2;
    }
    if (max < 1e-12) break;
    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    // Rotate A
    const App = c * c * app - 2 * s * c * apq + s * s * aqq;
    const Aqq = s * s * app + 2 * s * c * apq + c * c * aqq;
    A[p][p] = App;
    A[q][q] = Aqq;
    A[p][q] = 0;
    A[q][p] = 0;
    for (let r = 0; r < 3; r += 1) {
      if (r === p || r === q) continue;
      const arp = A[r][p];
      const arq = A[r][q];
      A[r][p] = c * arp - s * arq;
      A[p][r] = A[r][p];
      A[r][q] = s * arp + c * arq;
      A[q][r] = A[r][q];
    }
    // Accumulate V
    for (let r = 0; r < 3; r += 1) {
      const vrp = V[r][p];
      const vrq = V[r][q];
      V[r][p] = c * vrp - s * vrq;
      V[r][q] = s * vrp + c * vrq;
    }
  }
  // Sort eigenvalues descending so singular values are ordered
  const idx = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]);
  const values = idx.map((i) => A[i][i]);
  V = [
    [V[0][idx[0]], V[0][idx[1]], V[0][idx[2]]],
    [V[1][idx[0]], V[1][idx[1]], V[1][idx[2]]],
    [V[2][idx[0]], V[2][idx[1]], V[2][idx[2]]],
  ];
  return { values, vectors: V };
}

function orthonormalizeColumns(M: number[][]): void {
  for (let j = 0; j < 3; j += 1) {
    let x = M[0][j];
    let y = M[1][j];
    let z = M[2][j];
    for (let k = 0; k < j; k += 1) {
      const d = M[0][j] * M[0][k] + M[1][j] * M[1][k] + M[2][j] * M[2][k];
      x -= d * M[0][k];
      y -= d * M[1][k];
      z -= d * M[2][k];
    }
    const m = Math.hypot(x, y, z) || 1;
    M[0][j] = x / m;
    M[1][j] = y / m;
    M[2][j] = z / m;
  }
}

function matMul(A: number[][], B: number[][]): number[][] {
  const R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return R;
}

function transpose(A: number[][]): number[][] {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ];
}

function det3(A: number[][]): number {
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  );
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function scale(v: V3, s: number): V3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function normalize(v: V3): V3 | null {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m < 1e-8) return null;
  return scale(v, 1 / m);
}

void ZERO;

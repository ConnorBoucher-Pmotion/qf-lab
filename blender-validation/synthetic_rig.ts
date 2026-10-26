/**
 * Seated TL Junction kinematic stick model (MediaPipe-like landmark set).
 * Y-up, +Z toward a frontal camera at yaw 0. Subject +X = right.
 * Ground-truth torso / pelvis yaw are applied as pure axial rotations.
 */

export type V3 = { x: number; y: number; z: number; visibility?: number };

export type LandmarkName =
  | "nose"
  | "leftEar"
  | "rightEar"
  | "leftShoulder"
  | "rightShoulder"
  | "leftElbow"
  | "rightElbow"
  | "leftWrist"
  | "rightWrist"
  | "leftHip"
  | "rightHip"
  | "neck"
  | "chest";

export type PoseLandmarks = Record<LandmarkName, V3>;

export type CameraSpec = {
  /** Horizontal yaw of camera around subject (0 = frontal, + = camera moves toward subject's right). */
  yawDeg: number;
  pitchDeg: number;
  distanceM: number;
  heightM: number;
  fovYDeg: number;
  width: number;
  height: number;
};

export type PoseConfig = {
  torsoYawDeg: number;
  pelvisYawDeg: number;
  /** Simulate far-shoulder chin snap / drop for the expected occluded side. */
  occludeFarShoulder?: boolean;
  /** Direction of rotation for occlusion expectation. */
  direction?: "left" | "right";
  farShoulderVisibility?: number;
};

const REST: PoseLandmarks = {
  leftHip: { x: -0.12, y: 0.0, z: 0.0 },
  rightHip: { x: 0.12, y: 0.0, z: 0.0 },
  leftShoulder: { x: -0.2, y: 0.52, z: 0.0 },
  rightShoulder: { x: 0.2, y: 0.52, z: 0.0 },
  neck: { x: 0.0, y: 0.6, z: 0.0 },
  chest: { x: 0.0, y: 0.4, z: 0.04 },
  nose: { x: 0.0, y: 0.72, z: 0.12 },
  leftEar: { x: -0.08, y: 0.7, z: 0.02 },
  rightEar: { x: 0.08, y: 0.7, z: 0.02 },
  leftElbow: { x: -0.34, y: 0.62, z: 0.08 },
  rightElbow: { x: 0.34, y: 0.62, z: 0.08 },
  leftWrist: { x: -0.12, y: 0.72, z: 0.1 },
  rightWrist: { x: 0.12, y: 0.72, z: 0.1 },
};

function rotY(p: V3, deg: number): V3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c, visibility: p.visibility ?? 1 };
}

function copy(p: V3, vis = 1): V3 {
  return { x: p.x, y: p.y, z: p.z, visibility: vis };
}

/** Build world landmarks for a seated TL pose with known GT yaw. */
export function buildPose(cfg: PoseConfig): PoseLandmarks {
  const pelvisYaw = cfg.pelvisYawDeg;
  const torsoYaw = cfg.torsoYawDeg;

  const leftHip = rotY(REST.leftHip, pelvisYaw);
  const rightHip = rotY(REST.rightHip, pelvisYaw);

  const torsoKeys: LandmarkName[] = [
    "leftShoulder",
    "rightShoulder",
    "neck",
    "chest",
    "nose",
    "leftEar",
    "rightEar",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
  ];
  const out: PoseLandmarks = {
    leftHip: copy(leftHip),
    rightHip: copy(rightHip),
    leftShoulder: copy(REST.leftShoulder),
    rightShoulder: copy(REST.rightShoulder),
    neck: copy(REST.neck),
    chest: copy(REST.chest),
    nose: copy(REST.nose),
    leftEar: copy(REST.leftEar),
    rightEar: copy(REST.rightEar),
    leftElbow: copy(REST.leftElbow),
    rightElbow: copy(REST.rightElbow),
    leftWrist: copy(REST.leftWrist),
    rightWrist: copy(REST.rightWrist),
  };
  for (const key of torsoKeys) {
    out[key] = rotY(REST[key], torsoYaw);
  }

  if (cfg.occludeFarShoulder) {
    const dir = cfg.direction ?? (cfg.torsoYawDeg >= 0 ? "right" : "left");
    const far: LandmarkName = dir === "right" ? "rightShoulder" : "leftShoulder";
    const ear: LandmarkName = dir === "right" ? "rightEar" : "leftEar";
    // Chin/neck snap — classic MediaPipe failure mode at large yaw.
    out[far] = {
      x: out.nose.x * 0.7 + out[ear].x * 0.3,
      y: out.nose.y * 0.55 + out.neck.y * 0.45,
      z: out.nose.z * 0.8 + out.neck.z * 0.2,
      visibility: cfg.farShoulderVisibility ?? 0.25,
    };
  }

  return out;
}

export type ProjectedLandmark = V3 & {
  u: number;
  v: number;
  depth: number;
  inFrame: boolean;
  occluded: boolean;
};

export type ProjectedPose = {
  world: PoseLandmarks;
  image: Record<LandmarkName, ProjectedLandmark>;
  camera: CameraSpec;
};

/** Place camera on a horizontal arc and project with a pinhole model. */
export function projectPose(world: PoseLandmarks, camera: CameraSpec): ProjectedPose {
  const yaw = (camera.yawDeg * Math.PI) / 180;
  const pitch = (camera.pitchDeg * Math.PI) / 180;
  // Camera looks at hip mid from (distance, height) with yaw/pitch.
  const target = {
    x: (world.leftHip.x + world.rightHip.x) / 2,
    y: (world.leftHip.y + world.rightHip.y) / 2 + 0.3,
    z: (world.leftHip.z + world.rightHip.z) / 2,
  };
  const camPos = {
    x: target.x + Math.sin(yaw) * camera.distanceM * Math.cos(pitch),
    y: camera.heightM,
    z: target.z + Math.cos(yaw) * camera.distanceM * Math.cos(pitch),
  };

  const forward = normalize({
    x: target.x - camPos.x,
    y: target.y - camPos.y,
    z: target.z - camPos.z,
  });
  const worldUp = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(forward, worldUp));
  const up = cross(right, forward);

  const fovy = (camera.fovYDeg * Math.PI) / 180;
  const fy = (camera.height * 0.5) / Math.tan(fovy * 0.5);
  const fx = fy;

  const image = {} as Record<LandmarkName, ProjectedLandmark>;
  for (const key of Object.keys(world) as LandmarkName[]) {
    const p = world[key];
    const rel = { x: p.x - camPos.x, y: p.y - camPos.y, z: p.z - camPos.z };
    const cx = dot(rel, right);
    const cy = dot(rel, up);
    const cz = dot(rel, forward); // depth along view
    const depth = cz;
    const u = camera.width * 0.5 + (cx * fx) / Math.max(depth, 1e-4);
    const v = camera.height * 0.5 - (cy * fy) / Math.max(depth, 1e-4);
    const inFrame = depth > 0.05 && u >= 0 && u < camera.width && v >= 0 && v < camera.height;
    // Geometric occlusion: far shoulder behind torso plane when |torso yaw| large & camera oblique.
    const occluded = Boolean(p.visibility != null && p.visibility < 0.45);
    image[key] = {
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility ?? 1,
      u,
      v,
      depth,
      inFrame,
      occluded,
    };
  }

  // Depth-order occlusion: if far shoulder is behind chest relative to camera, mark occluded.
  const chestD = image.chest.depth;
  for (const side of ["leftShoulder", "rightShoulder"] as const) {
    if (image[side].depth > chestD + 0.04 && Math.abs(camera.yawDeg) > 20) {
      // shoulder farther than chest from camera → likely self-occluded on oblique view
    }
    if (image[side].depth < chestD - 0.02 && Math.abs(camera.yawDeg) >= 30) {
      image[side] = { ...image[side], occluded: true, visibility: Math.min(image[side].visibility ?? 1, 0.35) };
    }
  }

  return { world, image, camera };
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v: V3): V3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

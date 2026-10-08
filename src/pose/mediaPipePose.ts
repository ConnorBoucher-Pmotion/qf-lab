import { confidenceOf, type RawLandmark, type Vec } from "./types";

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304";
const WASM_URL = `${CDN}/wasm`;
// Bundled with the lab. The Google-hosted copy is blocked on some networks.
// The path has to be absolute: MediaPipe fetches it from the tracker script,
// so a relative path looks next to that script instead of this page.
function bundledModelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}models/pose_landmarker_full.v2.task`, window.location.href).href;
}

/**
 * Isolated from the PMotion app, which stores its loader on window.__mpVision.
 * Sharing that global would let the two pages fight over the WASM module.
 */
const GLOBAL_KEY = "__tlVision";

type PoseDetection = {
  landmarks?: RawLandmark[][];
  worldLandmarks?: RawLandmark[][];
};

export type PoseLandmarkerHandle = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => PoseDetection;
  close?: () => void;
};

type VisionModule = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  PoseLandmarker: {
    createFromOptions: (fileset: unknown, options: Record<string, unknown>) => Promise<PoseLandmarkerHandle>;
  };
};

function loadVision(): Promise<VisionModule> {
  const host = window as unknown as Record<string, VisionModule | undefined>;
  const existing = host[GLOBAL_KEY];
  if (existing?.PoseLandmarker) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Pose tracker timed out loading")), 20000);
    const finish = () => {
      window.clearTimeout(timeout);
      const vision = host[GLOBAL_KEY];
      if (!vision?.PoseLandmarker) {
        reject(new Error("Pose tracker failed to load"));
        return;
      }
      resolve(vision);
    };
    window.addEventListener("tl-vision-ready", finish, { once: true });
    const script = document.createElement("script");
    script.type = "module";
    script.textContent =
      `import * as vision from "${CDN}/vision_bundle.mjs"; window.${GLOBAL_KEY} = vision; window.dispatchEvent(new Event("tl-vision-ready"));`;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Pose tracker script failed"));
    };
    document.head.appendChild(script);
  });
}

export async function createTlPoseLandmarker(): Promise<PoseLandmarkerHandle> {
  const vision = await loadVision();
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: bundledModelUrl(), delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    // Kept low so MediaPipe keeps tracking through brief dips; QF-specific confidence gating happens in qfTracking.
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  };
  try {
    return await vision.PoseLandmarker.createFromOptions(fileset, options);
  } catch {
    return await vision.PoseLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: bundledModelUrl(), delegate: "CPU" },
    });
  }
}

export function imageLandmarks(raw: RawLandmark[] | undefined, width: number, height: number): Vec[] | null {
  if (!raw || raw.length < 33 || width < 2 || height < 2) return null;
  return raw.slice(0, 33).map((lm) => ({
    x: lm.x * width,
    y: lm.y * height,
    z: (lm.z ?? 0) * width,
    visibility: confidenceOf(lm),
  }));
}

export function worldLandmarks(raw: RawLandmark[] | undefined, image: RawLandmark[] | undefined): Vec[] | null {
  if (!raw || raw.length < 33) return null;
  return raw.slice(0, 33).map((lm, index) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z ?? 0,
    visibility: confidenceOf(image?.[index] ?? lm),
  }));
}

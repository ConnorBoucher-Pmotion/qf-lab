const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304";

function modelUrl(): string {
  return "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
}

type GestureCategory = { categoryName?: string; score?: number };

export type GestureHandle = {
  recognizeForVideo: (video: HTMLVideoElement, timestampMs: number) => { gestures?: GestureCategory[][] };
  close?: () => void;
};

type VisionModule = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  GestureRecognizer: {
    createFromOptions: (fileset: unknown, options: Record<string, unknown>) => Promise<GestureHandle>;
  };
};

/** Thumb_Up from the MediaPipe gesture model. Failure here leaves the I'm Ready button working. */
export async function createThumbRecognizer(): Promise<GestureHandle | null> {
  const host = window as unknown as Record<string, VisionModule | undefined>;
  const vision = host.__srVision;
  if (!vision?.GestureRecognizer || !vision.FilesetResolver) return null;
  const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const options = {
    baseOptions: { modelAssetPath: modelUrl(), delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  };
  try {
    return await vision.GestureRecognizer.createFromOptions(fileset, options);
  } catch {
    try {
      return await vision.GestureRecognizer.createFromOptions(fileset, {
        ...options,
        baseOptions: { modelAssetPath: modelUrl(), delegate: "CPU" },
      });
    } catch {
      return null;
    }
  }
}

export function isThumbUp(result: { gestures?: GestureCategory[][] } | null | undefined): boolean {
  const hands = result?.gestures ?? [];
  return hands.some((hand) => hand.some((gesture) => gesture.categoryName === "Thumb_Up" && (gesture.score ?? 0) >= 0.55));
}

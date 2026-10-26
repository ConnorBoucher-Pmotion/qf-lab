/**
 * Records the LIVE camera MediaStream (not the overlay canvas).
 *
 * Previous bug: canvas.captureStream() recorded a clearRect'd overlay canvas
 * that never drew the camera frame → black videos.
 */

export type ObliqueSavedVideo = {
  trialId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Diagnostic metadata persisted with the trial. */
  meta: RecordingMeta;
};

export type RecordingMeta = {
  source: "camera_mediastream";
  mimeType: string;
  chunkCount: number;
  blobBytes: number;
  durationMs: number;
  trackCount: number;
  trackReadyState: string;
  trackEnabled: boolean;
  trackMuted: boolean;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  facingMode: string | null;
  failed: boolean;
  failReason: string | null;
};

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export class ObliqueCaptureRecorder {
  private recorder: MediaRecorder | null = null;
  private recordStream: MediaStream | null = null;
  private clonedTrack: MediaStreamTrack | null = null;
  private chunks: Blob[] = [];
  private mime: string | null;
  private startedAt = 0;
  private activeTrialId: string | null = null;
  private pendingResolve: ((value: ObliqueSavedVideo | null) => void) | null = null;
  private lastMeta: RecordingMeta | null = null;

  constructor() {
    this.mime = pickMime();
  }

  get supported(): boolean {
    return this.mime != null;
  }

  getLastMeta(): RecordingMeta | null {
    return this.lastMeta;
  }

  /**
   * Begin recording from the original camera stream (clone the video track).
   */
  start(cameraStream: MediaStream, trialPlaceholderId: string): RecordingMeta {
    if (this.recorder) {
      return this.lastMeta ?? this.emptyMeta("already recording");
    }
    const track = cameraStream.getVideoTracks()[0];
    if (!track) {
      const meta = this.emptyMeta("no video track on camera stream");
      this.lastMeta = meta;
      console.error("[tl-record]", meta);
      return meta;
    }
    if (track.readyState !== "live") {
      const meta = this.emptyMeta(`video track readyState=${track.readyState}`);
      this.lastMeta = meta;
      console.error("[tl-record]", meta);
      return meta;
    }

    const settings = track.getSettings?.() ?? {};
    const metaBase: RecordingMeta = {
      source: "camera_mediastream",
      mimeType: this.mime || "unknown",
      chunkCount: 0,
      blobBytes: 0,
      durationMs: 0,
      trackCount: 1,
      trackReadyState: track.readyState,
      trackEnabled: track.enabled,
      trackMuted: Boolean((track as MediaStreamTrack & { muted?: boolean }).muted),
      width: typeof settings.width === "number" ? settings.width : null,
      height: typeof settings.height === "number" ? settings.height : null,
      frameRate: typeof settings.frameRate === "number" ? settings.frameRate : null,
      facingMode: typeof settings.facingMode === "string" ? settings.facingMode : null,
      failed: false,
      failReason: null,
    };

    if (!track.enabled) track.enabled = true;

    try {
      this.clonedTrack = track.clone();
      this.recordStream = new MediaStream([this.clonedTrack]);
      this.chunks = [];
      this.activeTrialId = trialPlaceholderId;
      this.startedAt = performance.now();
      const options: MediaRecorderOptions = { videoBitsPerSecond: 2_500_000 };
      if (this.mime) options.mimeType = this.mime;
      const recorder = new MediaRecorder(this.recordStream, options);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        console.error("[tl-record] MediaRecorder error");
      };
      recorder.start(200);
      this.recorder = recorder;
      this.lastMeta = metaBase;
      console.log("[tl-record] started", metaBase);
      return metaBase;
    } catch (error) {
      this.cleanup();
      const meta = {
        ...metaBase,
        failed: true,
        failReason: error instanceof Error ? error.message : "MediaRecorder start failed",
      };
      this.lastMeta = meta;
      console.error("[tl-record]", meta);
      return meta;
    }
  }

  stop(finalTrialId: string): Promise<ObliqueSavedVideo | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        const meta = this.emptyMeta("recorder inactive at stop");
        this.lastMeta = meta;
        this.cleanup();
        resolve(null);
        return;
      }
      this.pendingResolve = resolve;
      this.activeTrialId = finalTrialId;
      const recorder = this.recorder;
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || this.mime || "video/webm";
        const blob = new Blob(this.chunks, { type: mimeType });
        const durationMs = Math.max(0, performance.now() - this.startedAt);
        const id = this.activeTrialId ?? finalTrialId;
        const meta: RecordingMeta = {
          ...(this.lastMeta ?? this.emptyMeta(null)),
          mimeType,
          chunkCount: this.chunks.length,
          blobBytes: blob.size,
          durationMs,
          failed: blob.size === 0,
          failReason: blob.size === 0 ? "Blob size is 0 — no encoded frames" : null,
        };
        this.lastMeta = meta;
        console.log("[tl-record] stopped", meta);
        this.cleanup();
        const pending = this.pendingResolve;
        this.pendingResolve = null;
        if (!blob.size) {
          pending?.(null);
          return;
        }
        pending?.({ trialId: id, blob, mimeType, durationMs, meta });
      };
      try {
        if (recorder.state === "recording") recorder.requestData?.();
        recorder.stop();
      } catch {
        this.cleanup();
        resolve(null);
      }
    });
  }

  dispose(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // ignore
    }
    this.cleanup();
  }

  private emptyMeta(reason: string | null): RecordingMeta {
    return {
      source: "camera_mediastream",
      mimeType: this.mime || "unknown",
      chunkCount: 0,
      blobBytes: 0,
      durationMs: 0,
      trackCount: 0,
      trackReadyState: "none",
      trackEnabled: false,
      trackMuted: true,
      width: null,
      height: null,
      frameRate: null,
      facingMode: null,
      failed: true,
      failReason: reason,
    };
  }

  private cleanup(): void {
    this.recorder = null;
    this.clonedTrack?.stop();
    this.clonedTrack = null;
    this.recordStream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    this.recordStream = null;
    this.chunks = [];
    this.activeTrialId = null;
  }
}

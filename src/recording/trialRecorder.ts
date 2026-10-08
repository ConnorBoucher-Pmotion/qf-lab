import type { TLSnapshot, TLStateName } from "../tl/tlTypes";
import { recordingIntent, type RecMode } from "./recordingIntent";

export type RecorderPhase = "off" | "preroll" | "keep" | "post" | "unavailable";

export type RecorderStatus = {
  phase: RecorderPhase;
  supported: boolean;
  message: string;
  poseFps: number;
  recordFps: number;
  slowFrames: number;
  trialId: string | null;
};

export type SavedRecording = {
  trialId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

const MIME_CANDIDATES = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm", "video/mp4"];
const MAX_W = 1280;
const MAX_H = 720;
const FRAME_MS = 1000 / 30;
const SLOW_FRAME_MS = 50;
const VIDEO_BITS = 2_000_000;

type Hooks = {
  onSaved: (recording: SavedRecording) => void;
  onStatus: (status: RecorderStatus) => void;
  preRollMs: () => number;
  postRollMs: () => number;
};

type CanvasFrameTrack = MediaStreamTrack & { requestFrame?: () => void };

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  const found = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
  return found ?? "";
}

/**
 * Records the picture the operator sees: mirrored camera, then the overlay canvas
 * that was just drawn for this same frame. Audio is never captured.
 */
export class TrialRecorder {
  private readonly composite: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private stream: MediaStream | null = null;
  private requestFrame: (() => void) | null = null;
  private recorder: MediaRecorder | null = null;
  private mode: RecMode = "off";
  private busy = false;
  private closed = false;
  private mime: string | null = null;
  private supported = true;
  private message = "";
  private startedAt = 0;
  private lastDraw = 0;
  private trialId: string | null = null;
  private postTimer = 0;
  private saveOnStop = false;
  private chunks: Blob[] = [];
  private poseCount = 0;
  private recordCount = 0;
  private poseFps = 0;
  private recordFps = 0;
  private slowFrames = 0;
  private lastPose = 0;
  private fpsWindowStart = 0;
  private lastStatus = "";

  constructor(
    private readonly overlay: HTMLCanvasElement,
    private readonly hooks: Hooks
  ) {
    this.composite = document.createElement("canvas");
    this.composite.width = MAX_W;
    this.composite.height = MAX_H;
    this.ctx = this.composite.getContext("2d", { alpha: false });
    this.mime = pickRecorderMime();
    if (this.mime == null || !this.composite.captureStream || !this.ctx) {
      this.supported = false;
      this.message = "Video recording unavailable in this browser.";
    }
    this.emit(true);
  }

  capture(video: HTMLVideoElement, snapshot: TLSnapshot, now: number): void {
    this.notePose(now);
    if (!this.supported || this.closed || this.busy) return;
    const elapsed = this.startedAt ? now - this.startedAt : 0;
    const intent = recordingIntent(this.mode, snapshot.state, elapsed, this.hooks.preRollMs());
    this.apply(intent, snapshot);
    if (!this.shouldDraw() || now - this.lastDraw < FRAME_MS) return;
    this.lastDraw = now;
    this.draw(video, snapshot);
    this.requestFrame?.();
    this.recordCount += 1;
  }

  dispose(): void {
    this.closed = true;
    window.clearTimeout(this.postTimer);
    this.postTimer = 0;
    const save = (this.mode === "post" || this.mode === "keep") && this.trialId != null;
    const live = this.recorder != null && this.recorder.state !== "inactive";
    this.stop(save);
    if (!live) this.stream?.getTracks().forEach((track) => track.stop());
  }

  private apply(intent: ReturnType<typeof recordingIntent>, snapshot: TLSnapshot): void {
    if (intent === "idle") return;
    if (intent === "start-preroll") this.start(false);
    else if (intent === "start-keep") this.start(true);
    else if (intent === "promote") this.mode = "keep";
    else if (intent === "recycle-preroll") this.restart(false);
    else if (intent === "discard") this.stop(false);
    else if (intent === "discard-then-preroll") this.restart(false);
    else if (intent === "arm-post") this.armPost(snapshot);
    else if (intent === "finish-now") this.stop(true);
    this.emit(false);
  }

  private shouldDraw(): boolean {
    return this.mode === "preroll" || this.mode === "keep" || this.mode === "post";
  }

  private start(keep: boolean): void {
    if (this.closed || this.mime == null || !this.ctx) return;
    this.ensureStream();
    if (!this.stream) return;
    this.chunks = [];
    this.saveOnStop = false;
    this.trialId = null;
    try {
      const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS };
      if (this.mime) options.mimeType = this.mime;
      const recorder = new MediaRecorder(this.stream, options);
      const chunks = this.chunks;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.supported = false;
        this.message = "Video recording unavailable in this browser.";
        this.mode = "off";
        this.emit(true);
      };
      recorder.onstop = () => {
        if (this.recorder !== recorder) return;
        this.finishStop();
      };
      recorder.start();
      this.recorder = recorder;
      this.mode = keep ? "keep" : "preroll";
      this.startedAt = performance.now();
    } catch {
      this.supported = false;
      this.message = "Video recording unavailable in this browser.";
      this.mode = "off";
    }
  }

  private pendingKeep = false;
  private shouldRestart = false;

  private restart(keep: boolean): void {
    if (!this.recorder || this.recorder.state === "inactive") {
      this.mode = "off";
      this.start(keep);
      return;
    }
    this.busy = true;
    this.saveOnStop = false;
    this.pendingKeep = keep;
    this.shouldRestart = true;
    this.mode = "off";
    window.clearTimeout(this.postTimer);
    this.postTimer = 0;
    this.recorder.stop();
  }

  private armPost(snapshot: TLSnapshot): void {
    const id = snapshot.result?.id;
    if (!id) return;
    this.trialId = id;
    this.mode = "post";
    window.clearTimeout(this.postTimer);
    const wait = Math.max(0, this.hooks.postRollMs());
    this.postTimer = window.setTimeout(() => {
      this.postTimer = 0;
      if (!this.closed && this.mode === "post") this.stop(true);
    }, wait);
  }

  private stop(save: boolean): void {
    window.clearTimeout(this.postTimer);
    this.postTimer = 0;
    this.shouldRestart = false;
    this.saveOnStop = save && this.trialId != null;
    if (!this.recorder || this.recorder.state === "inactive") {
      this.mode = "off";
      this.busy = false;
      this.trialId = save ? this.trialId : null;
      return;
    }
    this.busy = true;
    this.mode = "off";
    this.recorder.stop();
  }

  private finishStop(): void {
    const chunks = this.chunks;
    const save = this.saveOnStop;
    const trialId = this.trialId;
    const mimeType = this.recorder?.mimeType || this.mime || "video/webm";
    const durationMs = this.startedAt ? Math.round(performance.now() - this.startedAt) : 0;
    const restart = this.shouldRestart;
    const keep = this.pendingKeep;
    this.recorder = null;
    this.chunks = [];
    this.busy = false;
    this.saveOnStop = false;
    this.shouldRestart = false;
    this.pendingKeep = false;
    this.trialId = null;
    this.startedAt = 0;
    if (save && trialId && chunks.length > 0) {
      const blob = new Blob(chunks, { type: mimeType });
      this.hooks.onSaved({ trialId, blob, mimeType, durationMs });
    }
    if (!this.closed && restart) this.start(keep);
    if (this.closed) this.stream?.getTracks().forEach((track) => track.stop());
    this.emit(true);
  }

  private ensureStream(): void {
    if (this.stream) return;
    const stream = this.composite.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasFrameTrack | undefined;
    if (track && typeof track.requestFrame === "function") {
      this.stream = stream;
      this.requestFrame = () => track.requestFrame?.();
      return;
    }
    track?.stop();
    this.stream = this.composite.captureStream(30);
    this.requestFrame = () => undefined;
  }

  private draw(video: HTMLVideoElement, snapshot: TLSnapshot): void {
    const ctx = this.ctx;
    if (!ctx || video.videoWidth < 2 || video.videoHeight < 2) return;
    const scale = Math.min(1, MAX_W / video.videoWidth, MAX_H / video.videoHeight);
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    if (this.composite.width !== width || this.composite.height !== height) {
      this.composite.width = width;
      this.composite.height = height;
    }
    ctx.setTransform(-1, 0, 0, 1, width, 0);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.overlay.width > 0 && this.overlay.height > 0) ctx.drawImage(this.overlay, 0, 0, width, height);
    drawHud(ctx, snapshot);
  }

  private notePose(now: number): void {
    if (this.lastPose && now - this.lastPose > SLOW_FRAME_MS) this.slowFrames += 1;
    this.lastPose = now;
    this.poseCount += 1;
    if (!this.fpsWindowStart) this.fpsWindowStart = now;
    if (now - this.fpsWindowStart < 1000) return;
    const span = now - this.fpsWindowStart;
    this.poseFps = Math.round((this.poseCount * 1000) / span);
    this.recordFps = Math.round((this.recordCount * 1000) / span);
    this.poseCount = 0;
    this.recordCount = 0;
    this.fpsWindowStart = now;
    this.emit(false);
  }

  private emit(force: boolean): void {
    const status = this.status();
    const key = `${status.phase}|${status.trialId ?? ""}|${status.poseFps}|${status.recordFps}|${status.slowFrames}|${status.message}`;
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.hooks.onStatus(status);
  }

  private status(): RecorderStatus {
    const phase: RecorderPhase = !this.supported ? "unavailable" : this.mode === "off" ? "off" : this.mode;
    return {
      phase,
      supported: this.supported,
      message: this.message,
      poseFps: this.poseFps,
      recordFps: this.recordFps,
      slowFrames: this.slowFrames,
      trialId: this.trialId,
    };
  }
}

function drawHud(ctx: CanvasRenderingContext2D, snapshot: TLSnapshot): void {
  const current = snapshot.rom.current;
  const valid = snapshot.state === "COMPLETE" ? snapshot.result?.measuredRom : snapshot.rom.validPeak;
  const raw = snapshot.rom.rawPeak;
  const dir = snapshot.direction === "left" ? "LEFT" : "RIGHT";
  const line1 = `TL ${dir}  ${current == null ? "—.—" : `${current.toFixed(1)}°`}`;
  const line2 = `Valid ${fmt(valid)}   Raw ${fmt(raw)}   ${labelState(snapshot.state)}`;
  const line3 = `Tracking ${trackingWord(snapshot)}`;
  ctx.save();
  ctx.font = "600 24px system-ui, sans-serif";
  const width1 = ctx.measureText(line1).width;
  ctx.font = "600 16px system-ui, sans-serif";
  const width2 = ctx.measureText(line2).width;
  const width3 = ctx.measureText(line3).width;
  const boxW = Math.ceil(Math.max(width1, width2, width3) + 46);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, 16, 16, boxW, 96, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = toneColor(snapshot);
  ctx.arc(34, 40, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(line1, 48, 40);
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(line2, 48, 68);
  ctx.fillText(line3, 48, 90);
  ctx.restore();
}

function fmt(value: number | null | undefined): string {
  return value == null ? "—.—" : `${value.toFixed(1)}°`;
}

function labelState(state: TLStateName): string {
  if (state === "TRACKING_LOST") return "TRACKING LOST";
  return state;
}

function trackingWord(snapshot: TLSnapshot): string {
  if (!snapshot.tracking.present || snapshot.tracking.score <= 0) return "LOST";
  if (!snapshot.tracking.criticalOk) return "WEAK";
  if (snapshot.tracking.score >= 0.7) return "GOOD";
  return "OK";
}

function toneColor(snapshot: TLSnapshot): string {
  if (snapshot.state === "INVALID" || snapshot.state === "TRACKING_LOST" || snapshot.hardFailed) return "#ff5d5d";
  if (snapshot.state === "CALIBRATING" || snapshot.state === "PEAK" || snapshot.checks.some((check) => check.status === "warn")) return "#e6b325";
  return "#3ddc84";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

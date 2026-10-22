import type { Vec } from "../pose/types";
import { BaselineCollector } from "./baseline";
import { measurementConfidence } from "./confidence";
import { OBLIQUE_CONFIG, setupCameraCopy, type ObliqueConfig } from "./config";
import { extractLandmarks, vis } from "./landmarks";
import { OcclusionHandler } from "./occlusion";
import { computeRotation, directionalRom, primarySignedRom } from "./rotation";
import { AngleSmoother, isSpike } from "./temporal";
import { validateFrame } from "./validation";
import { hipVector, shoulderVector } from "./vectors";
import type {
  ComparisonRecord,
  FrameDebug,
  ObliqueBaseline,
  ObliqueCameraMode,
  ObliqueResult,
  ObliqueSnapshot,
  ObliqueState,
  RotationDirection,
} from "./types";
import type { OrientationReading } from "./torsoOrientation";

const EMPTY_FRAME: FrameDebug = {
  leftShoulder: null,
  rightShoulder: null,
  leftHip: null,
  rightHip: null,
  leftShoulderConfidence: 0,
  rightShoulderConfidence: 0,
  leftHipConfidence: 0,
  rightHipConfidence: 0,
  neutralShoulderVector: null,
  currentShoulderVector: null,
  neutralHipVector: null,
  currentHipVector: null,
  liveShoulderYawDeg: null,
  neutralShoulderYawDeg: null,
  oldShoulderLineDeg: null,
  upperTorsoYawDeg: null,
  pelvisRotationDeg: null,
  thoracicRotationDeg: null,
  multiLandmarkYawDeg: null,
  shoulderRotationDeg: null,
  rawRom: null,
  filteredRom: null,
  maxRawRom: null,
  maxValidRom: null,
  frameValid: "reject",
  rejectReason: "No pose",
  reliableShoulder: "none",
  occlusionMode: "BOTH_SHOULDERS",
  occlusionActive: false,
  leftReconstructed: false,
  rightReconstructed: false,
  baselineSealed: false,
};

/**
 * Experimental 45° TL Junction session.
 * Frontal TLSession is untouched — this is a parallel pipeline.
 *
 * Stages (separated):
 * ALIGNMENT → WAITING_FOR_READY → COUNTDOWN → MEASURING → TRIAL_COMPLETE → STORE_RESULT
 */
export class ObliqueSession {
  private config: ObliqueConfig;
  private direction: RotationDirection;
  private state: ObliqueState = "SEARCHING";
  /** Sealed once per trial calibration. Never overwritten while measuring. */
  private baseline: ObliqueBaseline | null = null;
  private collector = new BaselineCollector();
  private occlusion = new OcclusionHandler();
  private smoother = new AngleSmoother();
  private lastT: number | null = null;
  private thumbFor = 0;
  private thumbSeen = false;
  private readyOpen = false;
  private voiceLatch = false;
  private countdownEndsAt: number | null = null;
  private rotateCueAt: number | null = null;
  private captureEndsAt: number | null = null;
  private countdownSpan = 0;
  private movementStarted = false;
  private activeFor = 0;
  /** Running max of directional RAW shoulder ROM during MEASURING. */
  private rawPeak: number | null = null;
  private validPeak: number | null = null;
  private lastRaw: number | null = null;
  private lastShoulders: { left: Vec; right: Vec } | null = null;
  private frameTimes: number[] = [];
  private totalFrames = 0;
  private invalidFrames = 0;
  private occlusionEvents = 0;
  private pelvisWarnFrames = 0;
  private maxPelvis = 0;
  private shoulderScoreSum = 0;
  private hipScoreSum = 0;
  private scoreN = 0;
  private leftResult: number | null = null;
  private rightResult: number | null = null;
  private result: ObliqueResult | null = null;
  private events: Array<{ label: string; at: number }> = [];
  private startedAt: number | null = null;
  private weakFor = 0;
  private logEvery = 0;
  /** Frozen baseline torso yaw — must not change mid-trial. */
  private sealedTorsoYaw: number | null = null;

  constructor(direction: RotationDirection = "right", config: Partial<ObliqueConfig> = {}) {
    this.direction = direction;
    this.config = { ...OBLIQUE_CONFIG, ...config };
  }

  setConfig(config: Partial<ObliqueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setCameraMode(mode: ObliqueCameraMode): void {
    if (mode === this.config.cameraMode) return;
    this.config = { ...this.config, cameraMode: mode };
    this.reset();
  }

  setDirection(direction: RotationDirection): void {
    if (direction === this.direction) return;
    this.direction = direction;
    this.reset();
  }

  arm(now: number): void {
    if (!this.baseline || this.result || this.movementStarted || this.countdownEndsAt != null) return;
    if (this.state !== "WAITING_FOR_READY" && this.state !== "READY_CONFIRMING") return;
    this.voiceLatch = true;
    if (this.config.countdownMs <= 0) {
      this.beginMeasuring(now);
      return;
    }
    this.countdownSpan = this.config.countdownMs;
    this.rotateCueAt = now + this.config.countdownMs;
    this.countdownEndsAt = now + this.config.countdownMs + 400;
    this.state = "COUNTDOWN";
    this.note("Countdown started", now);
  }

  hearReady(now: number): void {
    if (this.voiceLatch || !this.readyOpen) return;
    if (this.state !== "WAITING_FOR_READY" && this.state !== "READY_CONFIRMING") return;
    this.note("Voice ready", now);
    this.arm(now);
  }

  reset(): void {
    this.collector.reset();
    this.occlusion.reset();
    this.smoother.reset();
    this.baseline = null;
    this.sealedTorsoYaw = null;
    this.state = "SEARCHING";
    this.clearAttempt();
    this.lastT = null;
    this.frameTimes = [];
  }

  nextTrial(): void {
    this.collector.reset();
    this.occlusion.reset();
    this.smoother.reset();
    this.baseline = null;
    this.sealedTorsoYaw = null;
    this.clearAttempt();
    this.state = "ALIGNMENT";
  }

  /** Store the finished direction and prepare the opposite side. */
  completeDirection(now: number): void {
    if (this.result?.accepted && this.result.rawMaximum != null) {
      if (this.direction === "left") this.leftResult = this.result.rawMaximum;
      else this.rightResult = this.result.rawMaximum;
    }
    if (this.leftResult != null && this.rightResult != null) {
      this.state = "SESSION_COMPLETE";
      this.note("Session complete", now);
      return;
    }
    const next: RotationDirection = this.direction === "right" ? "left" : "right";
    this.direction = next;
    this.nextTrial();
    this.note(`Switch to ${next}`, now);
  }

  wantsThumb(): boolean {
    return (
      (this.state === "WAITING_FOR_READY" || this.state === "READY_CONFIRMING") &&
      this.baseline != null &&
      !this.movementStarted &&
      this.result == null
    );
  }

  push(frame: { width: number; height: number; image: Vec[]; world: Vec[]; thumbUp?: boolean }, now: number): ObliqueSnapshot {
    const dt = this.lastT == null ? 0 : Math.max(0, now - this.lastT);
    this.lastT = now;
    this.frameTimes.push(now);
    this.frameTimes = this.frameTimes.filter((t) => now - t < 1000);

    const rawSample = extractLandmarks(frame.world);
    if (!rawSample) {
      this.weakFor += dt;
      if (this.state !== "TRIAL_COMPLETE" && this.state !== "SESSION_COMPLETE" && this.state !== "INVALID") {
        this.state = this.movementStarted ? "MEASURING" : "SEARCHING";
      }
      return this.snapshot(frame.image, now, EMPTY_FRAME, null);
    }

    // ---- Baseline calibration (sealed once; never rewritten while measuring) ----
    if (!this.baseline) {
      const built = this.collector.push(frame.world, dt, this.config, this.config.cameraMode);
      if (built) {
        this.baseline = built;
        this.sealedTorsoYaw = built.torsoYawDeg;
        this.state = "WAITING_FOR_READY";
        this.note("Calibration complete", now);
      } else {
        this.state = this.collector.progress(this.config) > 0 ? "CALIBRATING" : "ALIGNMENT";
      }
      const preview = computeRotation(rawSample, this.baseline, frame.image);
      const frameDebug = this.debugFrame(
        rawSample,
        preview,
        "BOTH_SHOULDERS",
        false,
        "both",
        false,
        false,
        "warn",
        ""
      );
      return this.snapshot(frame.image, now, frameDebug, null);
    }

    // Guard: baseline torso yaw must stay sealed
    if (this.sealedTorsoYaw != null && this.baseline.torsoYawDeg !== this.sealedTorsoYaw) {
      console.error("[oblique] BASELINE RESET DETECTED — restoring sealed torso yaw", {
        sealed: this.sealedTorsoYaw,
        current: this.baseline.torsoYawDeg,
      });
      this.baseline = { ...this.baseline, torsoYawDeg: this.sealedTorsoYaw };
    }

    const occ = this.occlusion.apply(rawSample, this.direction, this.baseline, this.config);
    // Occlusion may rewrite shoulders; recompute orientation from assisted sample + image for debug line.
    const reading = computeRotation(occ.sample, this.baseline, frame.image);

    // PRIMARY RAW = upper-body Kabsch yaw − pelvis yaw change (world landmarks).
    // Old shoulder-axis / torso-frame-from-shoulders alone plateaus when MediaPipe Z saturates.
    const signedRom = primarySignedRom(reading);
    const rawRom = directionalRom(signedRom, this.direction);
    const spike = this.movementStarted && rawRom != null && isSpike(this.lastRaw, rawRom, dt, this.config);
    const validation = validateFrame({
      sample: occ.sample,
      baseline: this.baseline,
      lastShoulders: this.lastShoulders,
      pelvisFromNeutralDeg: reading.pelvisFromNeutralDeg,
      config: this.config,
      spike,
    });

    const filtered = this.smoother.push(validation.validity === "reject" ? null : rawRom, this.config);
    this.lastShoulders = { left: occ.sample.leftShoulder, right: occ.sample.rightShoulder };
    if (rawRom != null && !spike) this.lastRaw = rawRom;

    this.totalFrames += 1;
    if (validation.validity === "reject") this.invalidFrames += 1;
    if (occ.occlusionActive) this.occlusionEvents += 1;
    if (validation.reason === "Pelvis unstable") this.pelvisWarnFrames += 1;
    if (reading.pelvisFromNeutralDeg != null) this.maxPelvis = Math.max(this.maxPelvis, Math.abs(reading.pelvisFromNeutralDeg));
    this.shoulderScoreSum += (vis(rawSample.leftShoulder) + vis(rawSample.rightShoulder)) / 2;
    this.hipScoreSum += (vis(rawSample.leftHip) + vis(rawSample.rightHip)) / 2;
    this.scoreN += 1;

    // Track RAW MAX only during the active measurement window.
    if (this.movementStarted && this.state === "MEASURING" && rawRom != null) {
      if (this.rawPeak == null || rawRom > this.rawPeak) this.rawPeak = rawRom;
      if (validation.validity === "valid" && (this.validPeak == null || rawRom > this.validPeak)) {
        this.validPeak = rawRom;
      }
    }

    this.logEvery += 1;
    if (this.logEvery % 12 === 0) {
      const ls = rawSample.leftShoulder;
      const rs = rawSample.rightShoulder;
      const nls = this.baseline.leftShoulder;
      const nrs = this.baseline.rightShoulder;
      console.log(
        `[oblique] state=${this.state}\n` +
          `neutral LS: ${nls.x.toFixed(3)},${nls.y.toFixed(3)},${nls.z.toFixed(3)}  RS: ${nrs.x.toFixed(3)},${nrs.y.toFixed(3)},${nrs.z.toFixed(3)}\n` +
          `current LS: ${ls.x.toFixed(3)},${ls.y.toFixed(3)},${ls.z.toFixed(3)}  RS: ${rs.x.toFixed(3)},${rs.y.toFixed(3)},${rs.z.toFixed(3)}\n` +
          `oldShoulderLine:${reading.oldShoulderLineFromNeutralDeg?.toFixed(1)} torsoFrame:${reading.upperTorsoFromNeutralDeg?.toFixed(1)} pelvis:${reading.pelvisFromNeutralDeg?.toFixed(1)} thoracicFrame:${reading.thoracicRomDeg?.toFixed(1)} multi:${reading.multiLandmarkFromNeutralDeg?.toFixed(1)} primaryRaw:${rawRom?.toFixed(1)} maxRaw:${this.rawPeak?.toFixed(1)}`
      );
    }

    if (this.state !== "TRIAL_COMPLETE" && this.state !== "SESSION_COMPLETE" && this.state !== "INVALID") {
      this.advance(now, dt, frame.thumbUp === true, validation.validity !== "reject");
    }

    const conf = this.confidencePct();
    const frameDebug = this.debugFrame(
      occ.sample,
      reading,
      occ.mode,
      occ.occlusionActive,
      occ.reliableShoulder,
      occ.leftReconstructed,
      occ.rightReconstructed,
      validation.validity,
      validation.reason
    );
    frameDebug.rawRom = rawRom;
    frameDebug.filteredRom = filtered;
    frameDebug.maxRawRom = this.rawPeak;
    frameDebug.maxValidRom = this.validPeak;

    return this.snapshot(frame.image, now, frameDebug, conf);
  }

  private advance(now: number, dt: number, thumbUp: boolean, trackingOk: boolean): void {
    if (this.result && (this.state === "TRIAL_COMPLETE" || this.state === "INVALID" || this.state === "SESSION_COMPLETE")) return;

    if (!trackingOk && this.movementStarted) {
      this.weakFor += dt;
    } else this.weakFor = 0;

    if (this.countdownEndsAt != null) {
      if (now < this.countdownEndsAt) {
        this.state = "COUNTDOWN";
        this.readyOpen = false;
        return;
      }
      this.beginMeasuring(now);
      return;
    }

    if (!this.movementStarted) {
      this.readyOpen = this.baseline != null;
      this.thumbSeen = this.readyOpen && thumbUp;
      if (this.readyOpen && thumbUp) this.thumbFor = Math.min(this.config.thumbStableMs, this.thumbFor + dt);
      else this.thumbFor = Math.max(0, this.thumbFor - dt * 3);
      this.state = this.readyOpen && thumbUp && this.thumbFor > 0 ? "READY_CONFIRMING" : "WAITING_FOR_READY";
      if (this.readyOpen && thumbUp && this.thumbFor >= this.config.thumbStableMs) {
        this.note("Thumbs up", now);
        this.arm(now);
      }
      return;
    }

    this.activeFor += dt;
    if (this.captureEndsAt != null && now >= this.captureEndsAt) {
      this.finish(now);
      return;
    }
    this.state = "MEASURING";
  }

  private beginMeasuring(now: number): void {
    this.countdownEndsAt = null;
    this.rotateCueAt = null;
    this.captureEndsAt = now + this.config.captureWindowMs;
    this.movementStarted = true;
    this.startedAt = now;
    this.activeFor = 0;
    this.rawPeak = null;
    this.validPeak = null;
    this.lastRaw = null;
    this.smoother.reset();
    this.totalFrames = 0;
    this.invalidFrames = 0;
    this.occlusionEvents = 0;
    this.pelvisWarnFrames = 0;
    this.maxPelvis = 0;
    this.shoulderScoreSum = 0;
    this.hipScoreSum = 0;
    this.scoreN = 0;
    this.result = null;
    this.state = "MEASURING";
    this.note("Measurement started", now);
  }

  private finish(now: number): void {
    if (this.result) return;
    const raw = this.rawPeak;
    const validated = this.validPeak;
    const ok = raw != null && raw > 0;
    const conf = this.confidencePct();
    this.result = {
      id: `tl-oblique-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      cameraMode: this.config.cameraMode,
      direction: this.direction,
      accepted: ok,
      rawMaximum: raw,
      validatedMaximum: validated,
      measurementConfidence: conf,
      invalidFramePct: this.totalFrames ? Math.round((this.invalidFrames / this.totalFrames) * 100) : 0,
      occlusionEvents: this.occlusionEvents,
      maxPelvisRotationDeg: this.maxPelvis || null,
      instruction: ok
        ? `${this.direction === "left" ? "Left" : "Right"} Raw Max ROM ${raw!.toFixed(1)}°.`
        : "No raw rotation was captured in that direction.",
    };
    // STORE_RESULT — commit Raw Max ROM as the trial result.
    if (ok && raw != null) {
      if (this.direction === "left") this.leftResult = raw;
      else this.rightResult = raw;
    }
    this.movementStarted = false;
    this.captureEndsAt = null;
    if (this.leftResult != null && this.rightResult != null) {
      this.state = "SESSION_COMPLETE";
      this.note("Session complete", now);
    } else {
      this.state = "TRIAL_COMPLETE";
      this.note("Trial complete", now);
    }
  }

  private confidencePct(): number {
    if (this.scoreN === 0) return 0;
    return measurementConfidence({
      shoulderScore: this.shoulderScoreSum / this.scoreN,
      hipScore: this.hipScoreSum / this.scoreN,
      validFrameRatio: this.totalFrames ? 1 - this.invalidFrames / this.totalFrames : 0,
      occlusionEventRatio: this.totalFrames ? this.occlusionEvents / this.totalFrames : 0,
      pelvisStableRatio: this.totalFrames ? 1 - this.pelvisWarnFrames / this.totalFrames : 1,
      endRangeClear: (this.rawPeak ?? 0) > 15,
    });
  }

  private clearAttempt(): void {
    this.thumbFor = 0;
    this.thumbSeen = false;
    this.readyOpen = false;
    this.voiceLatch = false;
    this.countdownEndsAt = null;
    this.rotateCueAt = null;
    this.captureEndsAt = null;
    this.countdownSpan = 0;
    this.movementStarted = false;
    this.activeFor = 0;
    this.rawPeak = null;
    this.validPeak = null;
    this.lastRaw = null;
    this.lastShoulders = null;
    this.result = null;
    this.events = [];
    this.startedAt = null;
    this.weakFor = 0;
    this.totalFrames = 0;
    this.invalidFrames = 0;
    this.occlusionEvents = 0;
    this.pelvisWarnFrames = 0;
    this.maxPelvis = 0;
    this.shoulderScoreSum = 0;
    this.hipScoreSum = 0;
    this.scoreN = 0;
    this.logEvery = 0;
  }

  private note(label: string, now: number): void {
    if (this.events[this.events.length - 1]?.label === label) return;
    this.events.push({ label, at: now });
  }

  private countdownLabel(now: number): string | null {
    if (this.countdownEndsAt == null || this.rotateCueAt == null || now >= this.countdownEndsAt) return null;
    if (now >= this.rotateCueAt) return this.direction === "left" ? "ROTATE LEFT" : "ROTATE RIGHT";
    const third = this.countdownSpan / 3;
    const remain = this.rotateCueAt - now;
    if (third <= 0) return "1";
    if (remain > third * 2) return "3";
    if (remain > third) return "2";
    return "1";
  }

  private instruction(): string {
    if (this.state === "SESSION_COMPLETE") return "TL JUNCTION COMPLETE";
    if (this.state === "TRIAL_COMPLETE") return this.result?.instruction ?? "TRIAL COMPLETE";
    if (this.state === "INVALID") return this.result?.instruction ?? "Assessment stopped.";
    if (this.state === "SEARCHING") return "Waiting for pose. Sit upright with hands behind your head.";
    if (this.state === "ALIGNMENT") return "Hold the neutral start position. Hips forward, torso upright.";
    if (this.state === "CALIBRATING") return "Hold still. Capturing your neutral baseline (0°).";
    if (this.state === "WAITING_FOR_READY") return "SAY READY WHEN IN POSITION";
    if (this.state === "READY_CONFIRMING") return "👍 Ready gesture detected — keep holding.";
    if (this.state === "COUNTDOWN") return "Get ready — keep hands behind your head.";
    if (this.state === "MEASURING") return this.direction === "left" ? "ROTATE LEFT" : "ROTATE RIGHT";
    return "Hold still.";
  }

  private comparison(conf: number): ComparisonRecord {
    return {
      cameraMode: this.config.cameraMode,
      direction: this.direction,
      leftRom: this.leftResult,
      rightRom: this.rightResult,
      rawRom: this.rawPeak,
      validatedRom: this.validPeak,
      measurementConfidence: conf,
      poseConfidence: this.scoreN ? Math.round(((this.shoulderScoreSum + this.hipScoreSum) / (2 * this.scoreN)) * 100) : 0,
      invalidFramePct: this.totalFrames ? Math.round((this.invalidFrames / this.totalFrames) * 100) : 0,
      shoulderOcclusionEvents: this.occlusionEvents,
      maxPelvisRotationDeg: this.maxPelvis || null,
    };
  }

  private debugFrame(
    sample: ReturnType<typeof extractLandmarks>,
    reading: OrientationReading,
    mode: FrameDebug["occlusionMode"],
    occlusionActive: boolean,
    reliable: FrameDebug["reliableShoulder"],
    leftRecon: boolean,
    rightRecon: boolean,
    validity: FrameDebug["frameValid"],
    reason: FrameDebug["rejectReason"]
  ): FrameDebug {
    if (!sample) return { ...EMPTY_FRAME, baselineSealed: this.baseline != null };
    const primary = primarySignedRom(reading);
    return {
      leftShoulder: sample.leftShoulder,
      rightShoulder: sample.rightShoulder,
      leftHip: sample.leftHip,
      rightHip: sample.rightHip,
      leftShoulderConfidence: vis(sample.leftShoulder),
      rightShoulderConfidence: vis(sample.rightShoulder),
      leftHipConfidence: vis(sample.leftHip),
      rightHipConfidence: vis(sample.rightHip),
      neutralShoulderVector: this.baseline?.shoulderVector ?? null,
      currentShoulderVector: shoulderVector(sample),
      neutralHipVector: this.baseline?.hipVector ?? null,
      currentHipVector: hipVector(sample),
      liveShoulderYawDeg: reading.oldShoulderLineYawDeg,
      neutralShoulderYawDeg: this.baseline?.shoulderYawDeg ?? null,
      oldShoulderLineDeg: reading.oldShoulderLineFromNeutralDeg,
      upperTorsoYawDeg: reading.upperTorsoFromNeutralDeg,
      pelvisRotationDeg: reading.pelvisFromNeutralDeg,
      thoracicRotationDeg: reading.thoracicRomDeg,
      multiLandmarkYawDeg: reading.multiLandmarkFromNeutralDeg,
      shoulderRotationDeg: primary,
      rawRom: null,
      filteredRom: null,
      maxRawRom: null,
      maxValidRom: null,
      frameValid: validity,
      rejectReason: reason,
      reliableShoulder: reliable,
      occlusionMode: mode,
      occlusionActive,
      leftReconstructed: leftRecon,
      rightReconstructed: rightRecon,
      baselineSealed: this.baseline != null,
    };
  }

  private snapshot(image: Vec[], now: number, frame: FrameDebug, conf: number | null): ObliqueSnapshot {
    const confidence = conf ?? this.confidencePct();
    const asym =
      this.leftResult != null && this.rightResult != null ? Math.abs(this.leftResult - this.rightResult) : null;
    const origin = this.startedAt ?? this.events[0]?.at ?? now;
    const measuring = this.state === "MEASURING" && this.captureEndsAt != null;
    const remaining = measuring ? Math.max(0, this.captureEndsAt! - now) : null;
    const progress =
      measuring && this.config.captureWindowMs > 0
        ? Math.min(1, Math.max(0, 1 - remaining! / this.config.captureWindowMs))
        : null;
    return {
      state: this.state,
      instruction: this.instruction(),
      setupMessage: setupCameraCopy(this.config.cameraMode),
      cameraMode: this.config.cameraMode,
      direction: this.direction,
      countdownLabel: this.countdownLabel(now),
      captureProgress: progress,
      captureRemainingMs: remaining,
      captureWindowMs: this.config.captureWindowMs,
      thumbProgress: this.config.thumbStableMs <= 0 ? 0 : Math.max(0, Math.min(1, this.thumbFor / this.config.thumbStableMs)),
      thumbSeen: this.thumbSeen,
      canStart: this.readyOpen && (this.state === "WAITING_FOR_READY" || this.state === "READY_CONFIRMING"),
      baselineReady: this.baseline != null,
      calibrationProgress: this.baseline ? 1 : this.collector.progress(this.config),
      movementStarted: this.movementStarted,
      movementValid: frame.frameValid === "valid",
      measurementConfidence: confidence,
      shoulderRawDeg: frame.oldShoulderLineDeg,
      pelvisRawDeg: frame.pelvisRotationDeg,
      thoracicRawDeg: frame.thoracicRotationDeg,
      rawRom: frame.rawRom,
      filteredRom: frame.filteredRom,
      maxRawRom: this.rawPeak,
      maxValidRom: this.validPeak,
      leftResult: this.leftResult,
      rightResult: this.rightResult,
      asymmetryDeg: asym,
      bothDirectionsComplete: this.leftResult != null && this.rightResult != null,
      frame,
      imagePose: image,
      rawPose: image,
      fps: this.frameTimes.length,
      events: this.events.map((e) => ({ label: e.label, offsetMs: Math.round(e.at - origin) })),
      comparison: this.comparison(confidence),
      result: this.result,
    };
  }
}

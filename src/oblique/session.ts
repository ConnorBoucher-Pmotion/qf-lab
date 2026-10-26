import type { Vec } from "../pose/types";
import { BaselineCollector } from "./baseline";
import { measurementConfidence } from "./confidence";
import { OBLIQUE_CONFIG, setupCameraCopy, type ObliqueConfig } from "./config";
import { extractLandmarks, vis } from "./landmarks";
import { OcclusionHandler } from "./occlusion";
import {
  comparisonSide,
  computeThoraxPelvisRom,
  directionalRom,
  primarySide,
  sealReadyBaseline,
  type AxisYawReading,
  type OldPivotBaseline,
} from "./rotation";
import {
  computeHybridRom,
  sealHybridBaseline,
  type HybridReadyBaseline,
} from "./hybridRom";
import { AngleSmoother, isSpike } from "./temporal";
import { detectChinSnap, validateFrame } from "./validation";
import { hipVector, shoulderVector } from "./vectors";
import {
  computeCvDiagnostics,
  extractImageSample,
  sealImageBaseline,
  type ImageBaseline,
} from "./cvDiagnostics";
import { scoreTrialConfidence } from "./trialConfidence";
import type { TrialFrameSample, TlTrialRecord } from "./trialTypes";
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
import type { LandmarkSample } from "./types";
import { LM } from "../pose/types";

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
  maxFilteredRom: null,
  maxValidRom: null,
  frameValid: "reject",
  rejectReason: "No pose",
  reliableShoulder: "none",
  occlusionMode: "BOTH_SHOULDERS",
  occlusionActive: false,
  leftReconstructed: false,
  rightReconstructed: false,
  baselineSealed: false,
  primaryLandmark: null,
  comparisonLandmark: null,
  primaryConfidence: 0,
  comparisonConfidence: 0,
  startingPrimaryAngleDeg: null,
  currentPrimaryAngleDeg: null,
  primaryChangeFromBaselineDeg: null,
  comparisonChangeDeg: null,
  pelvisSubtractDeg: 0,
  readyBaselineCaptured: false,
  absoluteShoulderYawDeg: null,
  baselineShoulderYawDeg: null,
  shoulderYawChangeDeg: null,
  absoluteHipYawDeg: null,
  baselineHipYawDeg: null,
  hipYawChangeDeg: null,
  signedTlRotationDeg: null,
  experimentalOldPrimaryDeg: null,
  frozenHipReferenceDeg: null,
  startingShoulderAngleDeg: null,
  startingShoulderToHipOffsetDeg: null,
  currentShoulderVsFrozenHipDeg: null,
  liveHipDeviationDeg: null,
  hipDeviationWarning: false,
  frozenLeftHip: null,
  frozenRightHip: null,
  frozenHipImage: null,
  hybridMode: null,
  bothShoulderRomDeg: null,
  visibleShoulderRomDeg: null,
  rejectedOutlier: false,
  estimatorExistingDeg: null,
  estimator2dLineDeg: null,
  estimatorWorldYawDeg: null,
  estimatorImageOrbitDeg: null,
  estimatorSelectedSource: null,
  worldSignedUnclampedDeg: null,
  baselineLocked: false,
  imageLeftShoulder: null,
  imageRightShoulder: null,
  imageLeftHip: null,
  imageRightHip: null,
  worldLeftShoulder: null,
  worldRightShoulder: null,
  worldLeftHip: null,
  worldRightHip: null,
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
  /** Pose-calibration baseline (alignment / chin checks). Not the 0° ROM origin. */
  private baseline: ObliqueBaseline | null = null;
  /** HARD 0° origin — sealed at READY. Never rewritten mid-trial. */
  private readyBaseline: HybridReadyBaseline | null = null;
  /** Image-space baseline sealed at READY (frozen). */
  private imageBaseline: ImageBaseline | null = null;
  /** Frozen hip reference at READY — logged each frame to prove it never moves. */
  private lockedFrozenHipRef: number | null = null;
  /** Old shoulder→hipMid arc baseline (debug comparison only). */
  private oldPivotBaseline: OldPivotBaseline | null = null;
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
  /** Running max of side-specific RAW TL ROM during MEASURING. Never decreases mid-trial. */
  private rawPeak: number | null = null;
  /** Running max of filtered ROM (experimental; does not replace rawPeak). */
  private filteredPeak: number | null = null;
  private validPeak: number | null = null;
  private lastRaw: number | null = null;
  /** Last selected estimator id (for trial record / debug). */
  private lastEstimatorSource = "none";
  /** Hold last reliable ROM briefly when far shoulder collapses estimate. */
  private heldRom: number | null = null;
  private heldRomUntil = 0;
  private samples: TrialFrameSample[] = [];
  private assessmentId: string;
  private trialCounter = 0;
  private onTrialComplete: ((trial: TlTrialRecord) => void) | null = null;
  private lastShoulders: { left: Vec; right: Vec } | null = null;
  private lastSample: LandmarkSample | null = null;
  private lastImage: Vec[] | null = null;
  /** Image-space frozen hip endpoints for overlay (captured at READY). */
  private frozenHipImage: { left: { x: number; y: number }; right: { x: number; y: number } } | null = null;
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

  constructor(direction: RotationDirection = "right", config: Partial<ObliqueConfig> = {}) {
    this.direction = direction;
    this.config = { ...OBLIQUE_CONFIG, ...config };
    this.assessmentId = `tl-assess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  setTrialCompleteHandler(handler: ((trial: TlTrialRecord) => void) | null): void {
    this.onTrialComplete = handler;
  }

  getAssessmentId(): string {
    return this.assessmentId;
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
    if (!this.lastSample) return;
    // HARD ZERO: frozen hip + shoulders at READY become the 0° origin.
    const sealed = sealHybridBaseline(this.lastSample, this.direction, now);
    if (!sealed) return;
    this.readyBaseline = sealed;
    this.lockedFrozenHipRef = sealed.frozenHipReferenceDeg;
    this.oldPivotBaseline = sealReadyBaseline(this.lastSample, this.direction, now);
    if (this.lastImage && this.lastImage.length > LM.rightHip) {
      const li = this.lastImage[LM.leftHip];
      const ri = this.lastImage[LM.rightHip];
      this.frozenHipImage = {
        left: { x: li.x, y: li.y },
        right: { x: ri.x, y: ri.y },
      };
      const imageSample = extractImageSample(this.lastImage);
      this.imageBaseline = imageSample ? sealImageBaseline(imageSample, this.direction, now) : null;
      if (this.imageBaseline) Object.freeze(this.imageBaseline);
    } else {
      this.frozenHipImage = null;
      this.imageBaseline = null;
    }
    this.rawPeak = 0;
    this.filteredPeak = 0;
    this.validPeak = 0;
    this.lastRaw = null;
    this.heldRom = null;
    this.heldRomUntil = 0;
    this.lastEstimatorSource = "none";
    this.samples = [];
    this.voiceLatch = true;
    this.note("BASELINE CAPTURED", now);
    // Freeze hip axis object so accidental mutation is visible/hard.
    Object.freeze(sealed.frozenHipAxis);
    Object.freeze(sealed.baselineLeftHip);
    Object.freeze(sealed.baselineRightHip);
    console.log(
      `[oblique] BASELINE LOCKED direction=${this.direction} ` +
        `FROZEN hip ref=${sealed.frozenHipReferenceDeg.toFixed(1)}° ` +
        `start shoulder=${sealed.startingShoulderAngleDeg.toFixed(1)}° ` +
        `offset=${sealed.startingShoulderToHipOffsetDeg.toFixed(1)}° → TL ROM 0.0°`
    );
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
    this.readyBaseline = null;
    this.imageBaseline = null;
    this.lockedFrozenHipRef = null;
    this.oldPivotBaseline = null;
    this.lastSample = null;
    this.lastImage = null;
    this.frozenHipImage = null;
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
    this.readyBaseline = null;
    this.imageBaseline = null;
    this.lockedFrozenHipRef = null;
    this.oldPivotBaseline = null;
    this.lastSample = null;
    this.lastImage = null;
    this.frozenHipImage = null;
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

    this.lastSample = rawSample;
    this.lastImage = frame.image;

    // ---- Alignment calibration (landmarks stable). ROM 0° is sealed later at READY. ----
    if (!this.baseline) {
      const built = this.collector.push(frame.world, dt, this.config, this.config.cameraMode);
      if (built) {
        this.baseline = built;
        this.state = "WAITING_FOR_READY";
        this.note("Alignment ready", now);
      } else {
        this.state = this.collector.progress(this.config) > 0 ? "CALIBRATING" : "ALIGNMENT";
      }
      const preview = computeThoraxPelvisRom(rawSample, this.readyBaseline, this.direction, this.oldPivotBaseline);
      const frameDebug = this.debugFrame(rawSample, preview, "BOTH_SHOULDERS", false, "both", false, false, "warn", "");
      return this.snapshot(frame.image, now, frameDebug, null);
    }

    // Guard: frozen hip axis + sealed baseline must never move after READY.
    if (this.readyBaseline && this.lockedFrozenHipRef != null) {
      const hx = this.readyBaseline.frozenHipAxis.x;
      const hz = this.readyBaseline.frozenHipAxis.z;
      if (!Number.isFinite(hx) || !Number.isFinite(hz)) {
        console.error("[oblique] FROZEN hip axis corrupted");
      }
      if (this.readyBaseline.frozenHipReferenceDeg !== this.lockedFrozenHipRef) {
        console.error(
          `[oblique] BASELINE DRIFT DETECTED locked=${this.lockedFrozenHipRef} now=${this.readyBaseline.frozenHipReferenceDeg}`
        );
      }
    }

    const occ = this.occlusion.apply(rawSample, this.direction, this.baseline, this.config);
    const chinSide = detectChinSnap(rawSample, this.baseline, this.config);
    // Hybrid: both-shoulder vs frozen hip while reliable; visible-shoulder when far side fails.
    // Live hip landmarks do NOT enter the ROM zero reference.
    const reading = this.readyBaseline
      ? computeHybridRom(rawSample, this.readyBaseline, this.direction, this.oldPivotBaseline, {
          leftChinSnap: chinSide === "left",
          rightChinSnap: chinSide === "right",
          minConfidence: this.config.landmarkConfidence,
          softConfidence: this.config.softLandmarkConfidence,
        })
      : {
          ...computeThoraxPelvisRom(rawSample, null, this.direction, this.oldPivotBaseline),
          hybridMode: "UNAVAILABLE" as const,
          trustedShoulder: "none" as const,
          visibleShoulderRomDeg: null,
          bothShoulderRomDeg: null,
          selectedRawRomDeg: null,
        };
    const hybridDirectional = this.readyBaseline
      ? directionalRom(reading.selectedRawRomDeg ?? reading.currentRawRomDeg, this.direction)
      : null;
    const imageSample = this.lastImage ? extractImageSample(this.lastImage) : null;
    const cv = computeCvDiagnostics({
      worldSample: rawSample,
      imageSample,
      worldBaseline: this.readyBaseline,
      imageBaseline: this.imageBaseline,
      direction: this.direction,
      hybridSelectedDeg: hybridDirectional,
    });
    // Drive live ROM from selected estimator (may fall back to image orbit when world under-reports).
    let rawRom = this.readyBaseline ? directionalRom(cv.selectedDeg, this.direction) : null;
    this.lastEstimatorSource = cv.selectedSource;

    // Occlusion hold: if far shoulder fails and estimate collapses >40% vs last good, hold briefly.
    const farUnreliable = reading.hybridMode === "VISIBLE_SHOULDER" || occ.occlusionActive;
    if (
      this.movementStarted &&
      farUnreliable &&
      this.lastRaw != null &&
      this.lastRaw >= 12 &&
      rawRom != null &&
      rawRom < this.lastRaw * 0.55
    ) {
      this.heldRom = this.lastRaw;
      this.heldRomUntil = now + 450;
    }
    if (this.heldRom != null && now <= this.heldRomUntil && (rawRom == null || rawRom < this.heldRom)) {
      rawRom = this.heldRom;
      this.lastEstimatorSource = `${cv.selectedSource}+hold`;
    } else if (now > this.heldRomUntil) {
      this.heldRom = null;
    }

    const displayRaw = this.readyBaseline ? rawRom : 0;

    const spike = this.movementStarted && rawRom != null && isSpike(this.lastRaw, rawRom, dt, this.config);
    const validation = validateFrame({
      sample: rawSample,
      baseline: this.baseline,
      lastShoulders: this.lastShoulders,
      // Quality only — do not treat live hip deviation as ROM pelvis subtraction.
      pelvisFromNeutralDeg: reading.liveHipDeviationDeg,
      config: this.config,
      spike,
    });

    // Filtered path skips outliers; raw peak does NOT depend on filtered/validated gates.
    const filtered = this.smoother.push(validation.validity === "reject" || spike ? null : displayRaw, this.config);
    this.lastShoulders = { left: rawSample.leftShoulder, right: rawSample.rightShoulder };
    // Always advance lastRaw during measuring so a single jump cannot permanently lock isSpike.
    if (this.movementStarted && rawRom != null && Number.isFinite(rawRom)) {
      this.lastRaw = rawRom;
    }

    this.totalFrames += 1;
    if (validation.validity === "reject" || spike) this.invalidFrames += 1;
    if (occ.occlusionActive || reading.hybridMode === "VISIBLE_SHOULDER") this.occlusionEvents += 1;
    if (validation.reason === "Pelvis unstable") this.pelvisWarnFrames += 1;
    if (reading.liveHipDeviationDeg != null) this.maxPelvis = Math.max(this.maxPelvis, Math.abs(reading.liveHipDeviationDeg));
    this.shoulderScoreSum += (vis(rawSample.leftShoulder) + vis(rawSample.rightShoulder)) / 2;
    this.hipScoreSum += (vis(rawSample.leftHip) + vis(rawSample.rightHip)) / 2;
    this.scoreN += 1;

    /**
     * RAW MAX = max finite raw ROM during MEASURING.
     * Never decreases when the user returns toward neutral.
     * Never gated on filtered/validated acceptance (spike/reject only annotate the sample).
     */
    if (this.movementStarted && this.state === "MEASURING" && rawRom != null && Number.isFinite(rawRom)) {
      if (this.rawPeak == null || rawRom > this.rawPeak) this.rawPeak = rawRom;
      if (filtered != null && Number.isFinite(filtered) && (this.filteredPeak == null || filtered > this.filteredPeak)) {
        this.filteredPeak = filtered;
      }
      if (
        !spike &&
        validation.validity === "valid" &&
        (this.validPeak == null || rawRom > this.validPeak)
      ) {
        this.validPeak = rawRom;
      }
    }

    this.logEvery += 1;
    if (this.logEvery % 12 === 0) {
      console.log(
        `[oblique] state=${this.state} trial=${this.direction} mode=${reading.hybridMode} src=${cv.selectedSource}\n` +
          `BASELINE ${cv.baselineLocked ? "LOCKED" : "open"} frozenHip:${this.lockedFrozenHipRef?.toFixed(1)}\n` +
          `A hybrid:${cv.existingHybridDeg?.toFixed(1)} B 2dLine:${cv.shoulderLine2dDeg?.toFixed(1)} ` +
          `C world:${cv.worldAxisYawDeg?.toFixed(1)} D imgOrbit:${cv.imagePrimaryOrbitDeg?.toFixed(1)}\n` +
          `signedWorld:${cv.worldSignedUnclampedDeg?.toFixed(1)} SELECTED:${displayRaw?.toFixed(1)} max:${this.rawPeak?.toFixed(1)}\n` +
          `trusted:${reading.trustedShoulder} liveHipDev:${reading.liveHipDeviationDeg?.toFixed(1)}`
      );
    }

    if (this.state !== "TRIAL_COMPLETE" && this.state !== "SESSION_COMPLETE" && this.state !== "INVALID") {
      this.advance(now, dt, frame.thumbUp === true, validation.validity !== "reject");
    }

    const conf = this.confidencePct();
    const frameDebug = this.debugFrame(
      rawSample,
      reading,
      reading.hybridMode === "VISIBLE_SHOULDER" ? "SINGLE_SHOULDER_ASSISTED" : occ.mode,
      reading.hybridMode === "VISIBLE_SHOULDER" || occ.occlusionActive,
      reading.trustedShoulder,
      occ.leftReconstructed,
      occ.rightReconstructed,
      validation.validity,
      validation.reason
    );
    frameDebug.rawRom = displayRaw;
    frameDebug.filteredRom = filtered;
    frameDebug.maxRawRom = this.readyBaseline ? this.rawPeak : 0;
    frameDebug.maxValidRom = this.validPeak;
    frameDebug.hybridMode = reading.hybridMode;
    frameDebug.bothShoulderRomDeg = reading.bothShoulderRomDeg;
    frameDebug.visibleShoulderRomDeg = reading.visibleShoulderRomDeg;
    frameDebug.rejectedOutlier = validation.validity === "reject" || spike;
    frameDebug.maxFilteredRom = this.filteredPeak;
    frameDebug.estimatorExistingDeg = cv.existingHybridDeg;
    frameDebug.estimator2dLineDeg = cv.shoulderLine2dDeg;
    frameDebug.estimatorWorldYawDeg = cv.worldAxisYawDeg;
    frameDebug.estimatorImageOrbitDeg = cv.imagePrimaryOrbitDeg;
    frameDebug.estimatorSelectedSource = this.lastEstimatorSource;
    frameDebug.worldSignedUnclampedDeg = cv.worldSignedUnclampedDeg;
    frameDebug.baselineLocked = cv.baselineLocked;
    frameDebug.imageLeftShoulder = cv.imageCoords?.leftShoulder ?? null;
    frameDebug.imageRightShoulder = cv.imageCoords?.rightShoulder ?? null;
    frameDebug.imageLeftHip = cv.imageCoords?.leftHip ?? null;
    frameDebug.imageRightHip = cv.imageCoords?.rightHip ?? null;
    frameDebug.worldLeftShoulder = cv.worldCoords?.leftShoulder ?? null;
    frameDebug.worldRightShoulder = cv.worldCoords?.rightShoulder ?? null;
    frameDebug.worldLeftHip = cv.worldCoords?.leftHip ?? null;
    frameDebug.worldRightHip = cv.worldCoords?.rightHip ?? null;

    if (this.movementStarted && this.state === "MEASURING" && this.startedAt != null) {
      this.samples.push({
        tMs: Math.max(0, now - this.startedAt),
        timestamp: now,
        rawRom: displayRaw,
        filteredRom: filtered,
        rawMaxSoFar: this.rawPeak,
        filteredMaxSoFar: this.filteredPeak,
        leftShoulderX: rawSample.leftShoulder.x,
        leftShoulderY: rawSample.leftShoulder.y,
        leftShoulderZ: rawSample.leftShoulder.z,
        rightShoulderX: rawSample.rightShoulder.x,
        rightShoulderY: rawSample.rightShoulder.y,
        rightShoulderZ: rawSample.rightShoulder.z,
        leftHipX: rawSample.leftHip.x,
        leftHipY: rawSample.leftHip.y,
        leftHipZ: rawSample.leftHip.z,
        rightHipX: rawSample.rightHip.x,
        rightHipY: rawSample.rightHip.y,
        rightHipZ: rawSample.rightHip.z,
        leftShoulderConfidence: vis(rawSample.leftShoulder),
        rightShoulderConfidence: vis(rawSample.rightShoulder),
        leftHipConfidence: vis(rawSample.leftHip),
        rightHipConfidence: vis(rawSample.rightHip),
        measurementMode: reading.hybridMode,
        trustedShoulder: String(reading.trustedShoulder),
        isOutlier: validation.validity === "reject" || spike,
        occlusionState: reading.hybridMode === "VISIBLE_SHOULDER" || occ.occlusionActive ? "far_unreliable" : "clear",
        rejectReason: spike ? "Angle spike" : validation.reason,
        estimatorHybridDeg: cv.existingHybridDeg,
        estimator2dLineDeg: cv.shoulderLine2dDeg,
        estimatorWorldYawDeg: cv.worldAxisYawDeg,
        estimatorImageOrbitDeg: cv.imagePrimaryOrbitDeg,
        estimatorSelectedSource: this.lastEstimatorSource,
        worldSignedUnclampedDeg: cv.worldSignedUnclampedDeg,
      });
    }

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
    // Keep READY = 0°; do not wipe the sealed readyBaseline here.
    // rawPeak starts at 0 and only rises; lastRaw starts null so the first ROM is not a "spike".
    this.rawPeak = 0;
    this.filteredPeak = 0;
    this.validPeak = 0;
    this.lastRaw = null;
    this.samples = [];
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
    const raw = this.rawPeak ?? 0;
    const filteredMax = this.filteredPeak;
    const validated = this.validPeak;
    const ok = Number.isFinite(raw) && raw > 0;
    const scored = scoreTrialConfidence({
      samples: this.samples,
      rawMaxRom: raw,
      occlusionEventCount: this.occlusionEvents,
      rejectedFrameCount: this.invalidFrames,
      totalFrameCount: this.totalFrames,
      maxPelvisDeviationDeg: this.maxPelvis,
    });
    const conf = scored.score;
    this.trialCounter += 1;
    const trialId = `tl-oblique-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const durationMs = this.startedAt != null ? Math.max(0, now - this.startedAt) : this.activeFor;

    // STORE_RESULT — Raw Max is the primary recorded measurement.
    if (ok) {
      if (this.direction === "left") this.leftResult = raw;
      else this.rightResult = raw;
    }

    const trial: TlTrialRecord = {
      trialId,
      assessmentId: this.assessmentId,
      timestamp: new Date().toISOString(),
      trialNumber: this.trialCounter,
      direction: this.direction,
      durationMs,
      cameraMode: this.config.cameraMode,
      rawMaxRom: raw,
      filteredMaxRom: filteredMax,
      validatedMaxRom: validated,
      confidence: conf,
      confidenceBand: scored.band,
      completionStatus: !ok ? "incomplete" : scored.band === "low" ? "low_confidence" : "completed",
      videoId: trialId,
      samples: [...this.samples],
      occlusionEventCount: this.occlusionEvents,
      rejectedFrameCount: this.invalidFrames,
      totalFrameCount: this.totalFrames,
      algorithmPrimary: this.lastEstimatorSource || "hybrid_frozen_hip_visible_shoulder",
      leftResult: this.leftResult,
      rightResult: this.rightResult,
    };

    this.result = {
      id: trialId,
      timestamp: trial.timestamp,
      cameraMode: this.config.cameraMode,
      direction: this.direction,
      accepted: ok,
      rawMaximum: raw,
      validatedMaximum: validated,
      filteredMaximum: filteredMax,
      measurementConfidence: conf,
      invalidFramePct: this.totalFrames ? Math.round((this.invalidFrames / this.totalFrames) * 100) : 0,
      occlusionEvents: this.occlusionEvents,
      maxPelvisRotationDeg: this.maxPelvis || null,
      instruction: ok
        ? `${this.direction === "left" ? "Left" : "Right"} Raw Max ROM ${raw.toFixed(1)}° · Confidence ${conf}%.`
        : "No raw rotation was captured in that direction.",
      trial,
    };

    try {
      this.onTrialComplete?.(trial);
    } catch {
      // Persistence failures must not break the assessment UX.
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
    if (this.samples.length > 0) {
      return scoreTrialConfidence({
        samples: this.samples,
        rawMaxRom: this.rawPeak,
        occlusionEventCount: this.occlusionEvents,
        rejectedFrameCount: this.invalidFrames,
        totalFrameCount: this.totalFrames,
        maxPelvisDeviationDeg: this.maxPelvis,
      }).score;
    }
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
    this.filteredPeak = null;
    this.validPeak = null;
    this.lastRaw = null;
    this.heldRom = null;
    this.heldRomUntil = 0;
    this.lastEstimatorSource = "none";
    this.samples = [];
    this.lastShoulders = null;
    this.readyBaseline = null;
    this.imageBaseline = null;
    this.lockedFrozenHipRef = null;
    this.oldPivotBaseline = null;
    this.frozenHipImage = null;
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
    reading: AxisYawReading & {
      hybridMode?: FrameDebug["hybridMode"];
      bothShoulderRomDeg?: number | null;
      visibleShoulderRomDeg?: number | null;
    },
    mode: FrameDebug["occlusionMode"],
    occlusionActive: boolean,
    reliable: FrameDebug["reliableShoulder"],
    leftRecon: boolean,
    rightRecon: boolean,
    validity: FrameDebug["frameValid"],
    reason: FrameDebug["rejectReason"]
  ): FrameDebug {
    if (!sample) {
      return {
        ...EMPTY_FRAME,
        baselineSealed: this.readyBaseline != null,
        readyBaselineCaptured: this.readyBaseline != null,
        primaryLandmark: primarySide(this.direction),
        comparisonLandmark: comparisonSide(this.direction),
      };
    }
    return {
      ...EMPTY_FRAME,
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
      liveShoulderYawDeg: reading.currentShoulderAngleDeg,
      neutralShoulderYawDeg: reading.startingShoulderAngleDeg,
      oldShoulderLineDeg: reading.experimentalOldPrimaryDeg,
      upperTorsoYawDeg: reading.currentShoulderVsFrozenHipDeg,
      pelvisRotationDeg: reading.liveHipDeviationDeg,
      thoracicRotationDeg: reading.signedTlRotationDeg,
      multiLandmarkYawDeg: reading.experimentalOldPrimaryDeg,
      shoulderRotationDeg: reading.signedTlRotationDeg,
      frameValid: validity,
      rejectReason: reason,
      reliableShoulder: reliable,
      occlusionMode: mode,
      occlusionActive,
      leftReconstructed: leftRecon,
      rightReconstructed: rightRecon,
      baselineSealed: this.readyBaseline != null,
      primaryLandmark: primarySide(this.direction),
      comparisonLandmark: comparisonSide(this.direction),
      primaryConfidence: reading.leftShoulderConfidence,
      comparisonConfidence: reading.rightShoulderConfidence,
      startingPrimaryAngleDeg: reading.startingShoulderAngleDeg,
      currentPrimaryAngleDeg: reading.currentShoulderAngleDeg,
      primaryChangeFromBaselineDeg: reading.signedTlRotationDeg,
      comparisonChangeDeg: reading.liveHipDeviationDeg,
      pelvisSubtractDeg: 0,
      readyBaselineCaptured: this.readyBaseline != null,
      absoluteShoulderYawDeg: reading.currentShoulderAngleDeg,
      baselineShoulderYawDeg: reading.startingShoulderAngleDeg,
      shoulderYawChangeDeg: reading.signedTlRotationDeg,
      absoluteHipYawDeg: reading.liveHipAngleDeg,
      baselineHipYawDeg: reading.frozenHipReferenceDeg,
      hipYawChangeDeg: reading.liveHipDeviationDeg,
      signedTlRotationDeg: reading.signedTlRotationDeg,
      experimentalOldPrimaryDeg: reading.experimentalOldPrimaryDeg,
      frozenHipReferenceDeg: reading.frozenHipReferenceDeg,
      startingShoulderAngleDeg: reading.startingShoulderAngleDeg,
      startingShoulderToHipOffsetDeg: reading.startingShoulderToHipOffsetDeg,
      currentShoulderVsFrozenHipDeg: reading.currentShoulderVsFrozenHipDeg,
      liveHipDeviationDeg: reading.liveHipDeviationDeg,
      hipDeviationWarning:
        reading.liveHipDeviationDeg != null &&
        Math.abs(reading.liveHipDeviationDeg) >= this.config.hipDeviationWarnDeg,
      frozenLeftHip: reading.frozenLeftHip,
      frozenRightHip: reading.frozenRightHip,
      frozenHipImage: this.frozenHipImage,
      hybridMode: reading.hybridMode ?? null,
      bothShoulderRomDeg: reading.bothShoulderRomDeg ?? null,
      visibleShoulderRomDeg: reading.visibleShoulderRomDeg ?? null,
      rejectedOutlier: validity === "reject",
      baselineLocked: this.readyBaseline != null,
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
      shoulderRawDeg: frame.signedTlRotationDeg,
      pelvisRawDeg: frame.liveHipDeviationDeg,
      thoracicRawDeg: frame.signedTlRotationDeg,
      rawRom: frame.rawRom,
      filteredRom: frame.filteredRom,
      maxRawRom: this.rawPeak,
      maxFilteredRom: this.filteredPeak,
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

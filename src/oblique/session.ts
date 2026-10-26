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
import {
  computeAxialTrunkRom,
  extractImageSample,
  sealAxialTrunkBaseline,
  type AxialTrunkBaseline,
} from "./axialTrunkRom";
import { AngleSmoother, isSpike } from "./temporal";
import { detectChinSnap, validateFrame } from "./validation";
import { hipVector, shoulderVector } from "./vectors";
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
  baselineTorsoYawDeg: null,
  currentTorsoYawDeg: null,
  torsoRotationFromBaselineDeg: null,
  baselinePelvisYawDeg: null,
  currentPelvisYawDeg: null,
  pelvisRotationFromBaselineDeg: null,
  torsoRelativePelvisDeg: null,
  depthDiffYawDeg: null,
  foreshorteningDeg: null,
  visibleShoulderOrbitDeg: null,
  axialSelectedSource: null,
  axialOcclusion: null,
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
  /** Primary axial trunk / pelvis baseline — sealed at READY, frozen. */
  private axialBaseline: AxialTrunkBaseline | null = null;
  /** Frozen hip / torso yaw at READY — logged each frame to prove it never moves. */
  private lockedFrozenHipRef: number | null = null;
  private lockedTorsoYaw: number | null = null;
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
    // HARD ZERO: locked pelvis + torso axial orientation at READY = 0°.
    const imageSample = this.lastImage ? extractImageSample(this.lastImage) : null;
    const axial = sealAxialTrunkBaseline(this.lastSample, imageSample, this.direction, now);
    if (!axial) return;
    this.axialBaseline = axial;
    this.lockedFrozenHipRef = axial.pelvisYawDeg;
    this.lockedTorsoYaw = axial.torsoYawDeg;
    Object.freeze(axial);
    Object.freeze(axial.pelvisAxis);
    Object.freeze(axial.torsoAxis);
    Object.freeze(axial.leftHip);
    Object.freeze(axial.rightHip);
    Object.freeze(axial.leftShoulder);
    Object.freeze(axial.rightShoulder);

    // Keep hybrid baseline for side-by-side debug comparison only.
    const sealed = sealHybridBaseline(this.lastSample, this.direction, now);
    this.readyBaseline = sealed;
    this.oldPivotBaseline = sealReadyBaseline(this.lastSample, this.direction, now);
    if (this.lastImage && this.lastImage.length > LM.rightHip) {
      const li = this.lastImage[LM.leftHip];
      const ri = this.lastImage[LM.rightHip];
      this.frozenHipImage = {
        left: { x: li.x, y: li.y },
        right: { x: ri.x, y: ri.y },
      };
    } else {
      this.frozenHipImage = null;
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
    if (sealed) {
      Object.freeze(sealed.frozenHipAxis);
      Object.freeze(sealed.baselineLeftHip);
      Object.freeze(sealed.baselineRightHip);
    }
    console.log(
      `[oblique] BASELINE LOCKED axial trunk · direction=${this.direction} ` +
        `pelvisYaw=${axial.pelvisYawDeg.toFixed(1)}° torsoYaw=${axial.torsoYawDeg.toFixed(1)}° ` +
        `torsoVsPelvis=${axial.torsoVsPelvisOffsetDeg.toFixed(1)}° → ROM 0.0°`
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
    this.axialBaseline = null;
    this.lockedFrozenHipRef = null;
    this.lockedTorsoYaw = null;
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
    this.axialBaseline = null;
    this.lockedFrozenHipRef = null;
    this.lockedTorsoYaw = null;
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

    // Guard: sealed axial baseline must never move after READY.
    if (this.axialBaseline && this.lockedTorsoYaw != null && this.lockedFrozenHipRef != null) {
      if (this.axialBaseline.torsoYawDeg !== this.lockedTorsoYaw) {
        console.error(
          `[oblique] TORSO BASELINE DRIFT locked=${this.lockedTorsoYaw} now=${this.axialBaseline.torsoYawDeg}`
        );
      }
      if (this.axialBaseline.pelvisYawDeg !== this.lockedFrozenHipRef) {
        console.error(
          `[oblique] PELVIS BASELINE DRIFT locked=${this.lockedFrozenHipRef} now=${this.axialBaseline.pelvisYawDeg}`
        );
      }
    }

    const occ = this.occlusion.apply(rawSample, this.direction, this.baseline, this.config);
    const chinSide = detectChinSnap(rawSample, this.baseline, this.config);
    const imageSample = this.lastImage ? extractImageSample(this.lastImage) : null;

    // PRIMARY: axial trunk rotation (world XZ torso/pelvis). 2D slope is diagnostic only.
    const axial = this.axialBaseline
      ? computeAxialTrunkRom(rawSample, imageSample, this.axialBaseline, {
          minConfidence: this.config.landmarkConfidence,
          softConfidence: this.config.softLandmarkConfidence,
        })
      : null;

    // Legacy hybrid kept for debug comparison only — does NOT drive Raw Max.
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

    let rawRom = axial ? directionalRom(axial.selectedRomDeg, this.direction) : null;
    this.lastEstimatorSource = axial?.selectedSource ?? "none";

    // Occlusion hold: far shoulder loss is expected — don't let ROM collapse to ~0.
    const farUnreliable = axial?.occlusion !== "none" && axial?.occlusion != null;
    if (
      this.movementStarted &&
      farUnreliable &&
      this.lastRaw != null &&
      this.lastRaw >= 12 &&
      rawRom != null &&
      rawRom < this.lastRaw * 0.55
    ) {
      this.heldRom = this.lastRaw;
      this.heldRomUntil = now + 500;
    }
    if (this.heldRom != null && now <= this.heldRomUntil && (rawRom == null || rawRom < this.heldRom)) {
      rawRom = this.heldRom;
      this.lastEstimatorSource = `${axial?.selectedSource ?? "axial"}+hold`;
    } else if (now > this.heldRomUntil) {
      this.heldRom = null;
    }

    const displayRaw = this.axialBaseline ? rawRom : 0;

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
        `[oblique] state=${this.state} trial=${this.direction} src=${axial?.selectedSource ?? "none"}\n` +
          `BASELINE ${this.axialBaseline ? "LOCKED" : "open"} ` +
          `torso0=${this.lockedTorsoYaw?.toFixed(1)} pelvis0=${this.lockedFrozenHipRef?.toFixed(1)}\n` +
          `2D slope(diag):${axial?.shoulderSlope2dDeg?.toFixed(1)} ` +
          `torsoΔ:${axial?.worldTorsoYawFromBaselineDeg?.toFixed(1)} ` +
          `pelvisΔ:${axial?.worldPelvisYawFromBaselineDeg?.toFixed(1)} ` +
          `torsoRelPelvis:${axial?.torsoRelativePelvisDeg?.toFixed(1)}\n` +
          `depth:${axial?.depthDiffYawDeg?.toFixed(1)} foreshort:${axial?.foreshorteningDeg?.toFixed(1)} ` +
          `visOrbit:${axial?.visibleShoulderOrbitDeg?.toFixed(1)} imgOrbit:${axial?.imagePrimaryOrbitDeg?.toFixed(1)}\n` +
          `SELECTED:${displayRaw?.toFixed(1)} max:${this.rawPeak?.toFixed(1)} occ:${axial?.occlusion ?? "—"} ` +
          `W LS z=${rawSample.leftShoulder.z.toFixed(3)} RS z=${rawSample.rightShoulder.z.toFixed(3)}`
      );
    }

    if (this.state !== "TRIAL_COMPLETE" && this.state !== "SESSION_COMPLETE" && this.state !== "INVALID") {
      this.advance(now, dt, frame.thumbUp === true, validation.validity !== "reject");
    }

    const conf = this.confidencePct();
    const trusted =
      axial?.trustedShoulder ??
      (reading.trustedShoulder as FrameDebug["reliableShoulder"]);
    const frameDebug = this.debugFrame(
      rawSample,
      reading,
      axial?.occlusion !== "none" && axial?.occlusion
        ? "SINGLE_SHOULDER_ASSISTED"
        : occ.mode,
      Boolean(axial?.occlusion && axial.occlusion !== "none") || occ.occlusionActive,
      trusted === "left" || trusted === "right" || trusted === "both" || trusted === "none"
        ? trusted
        : "none",
      occ.leftReconstructed,
      occ.rightReconstructed,
      validation.validity,
      validation.reason
    );
    frameDebug.rawRom = displayRaw;
    frameDebug.filteredRom = filtered;
    frameDebug.maxRawRom = this.axialBaseline ? this.rawPeak : 0;
    frameDebug.maxValidRom = this.validPeak;
    frameDebug.hybridMode = reading.hybridMode;
    frameDebug.bothShoulderRomDeg = reading.bothShoulderRomDeg;
    frameDebug.visibleShoulderRomDeg = reading.visibleShoulderRomDeg;
    frameDebug.rejectedOutlier = validation.validity === "reject" || spike;
    frameDebug.maxFilteredRom = this.filteredPeak;
    frameDebug.estimatorExistingDeg = reading.selectedRawRomDeg;
    frameDebug.estimator2dLineDeg = axial?.shoulderSlope2dDeg ?? null;
    frameDebug.estimatorWorldYawDeg = axial?.worldTorsoYawFromBaselineDeg ?? null;
    frameDebug.estimatorImageOrbitDeg = axial?.imagePrimaryOrbitDeg ?? null;
    frameDebug.estimatorSelectedSource = this.lastEstimatorSource;
    frameDebug.worldSignedUnclampedDeg = axial?.signedAxialDeg ?? null;
    frameDebug.baselineLocked = this.axialBaseline != null;
    frameDebug.imageLeftShoulder = axial?.image?.leftShoulder ?? null;
    frameDebug.imageRightShoulder = axial?.image?.rightShoulder ?? null;
    frameDebug.imageLeftHip = axial?.image?.leftHip ?? null;
    frameDebug.imageRightHip = axial?.image?.rightHip ?? null;
    frameDebug.worldLeftShoulder = axial?.world.leftShoulder ?? rawSample.leftShoulder;
    frameDebug.worldRightShoulder = axial?.world.rightShoulder ?? rawSample.rightShoulder;
    frameDebug.worldLeftHip = axial?.world.leftHip ?? rawSample.leftHip;
    frameDebug.worldRightHip = axial?.world.rightHip ?? rawSample.rightHip;
    frameDebug.baselineTorsoYawDeg = axial?.baselineTorsoYawDeg ?? null;
    frameDebug.currentTorsoYawDeg = axial?.currentTorsoYawDeg ?? null;
    frameDebug.torsoRotationFromBaselineDeg = axial?.worldTorsoYawFromBaselineDeg ?? null;
    frameDebug.baselinePelvisYawDeg = axial?.baselinePelvisYawDeg ?? null;
    frameDebug.currentPelvisYawDeg = axial?.currentPelvisYawDeg ?? null;
    frameDebug.pelvisRotationFromBaselineDeg = axial?.worldPelvisYawFromBaselineDeg ?? null;
    frameDebug.torsoRelativePelvisDeg = axial?.torsoRelativePelvisDeg ?? null;
    frameDebug.depthDiffYawDeg = axial?.depthDiffYawDeg ?? null;
    frameDebug.foreshorteningDeg = axial?.foreshorteningDeg ?? null;
    frameDebug.visibleShoulderOrbitDeg = axial?.visibleShoulderOrbitDeg ?? null;
    frameDebug.axialSelectedSource = axial?.selectedSource ?? null;
    frameDebug.axialOcclusion = axial?.occlusion ?? null;
    // Overlay frozen hip from axial baseline when available.
    if (this.axialBaseline && !frameDebug.frozenLeftHip) {
      frameDebug.frozenLeftHip = this.axialBaseline.leftHip;
      frameDebug.frozenRightHip = this.axialBaseline.rightHip;
      frameDebug.frozenHipReferenceDeg = this.axialBaseline.pelvisYawDeg;
    }

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
        measurementMode: axial?.selectedSource ?? reading.hybridMode,
        trustedShoulder: String(axial?.trustedShoulder ?? reading.trustedShoulder),
        isOutlier: validation.validity === "reject" || spike,
        occlusionState: axial?.occlusion && axial.occlusion !== "none" ? axial.occlusion : "clear",
        rejectReason: spike ? "Angle spike" : validation.reason,
        estimatorHybridDeg: reading.selectedRawRomDeg,
        estimator2dLineDeg: axial?.shoulderSlope2dDeg ?? null,
        estimatorWorldYawDeg: axial?.worldTorsoYawFromBaselineDeg ?? null,
        estimatorImageOrbitDeg: axial?.imagePrimaryOrbitDeg ?? null,
        estimatorSelectedSource: this.lastEstimatorSource,
        worldSignedUnclampedDeg: axial?.signedAxialDeg ?? null,
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
    this.axialBaseline = null;
    this.lockedFrozenHipRef = null;
    this.lockedTorsoYaw = null;
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
        baselineSealed: this.axialBaseline != null,
        readyBaselineCaptured: this.axialBaseline != null,
        baselineLocked: this.axialBaseline != null,
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
      baselineSealed: this.axialBaseline != null,
      primaryLandmark: primarySide(this.direction),
      comparisonLandmark: comparisonSide(this.direction),
      primaryConfidence: reading.leftShoulderConfidence,
      comparisonConfidence: reading.rightShoulderConfidence,
      startingPrimaryAngleDeg: reading.startingShoulderAngleDeg,
      currentPrimaryAngleDeg: reading.currentShoulderAngleDeg,
      primaryChangeFromBaselineDeg: reading.signedTlRotationDeg,
      comparisonChangeDeg: reading.liveHipDeviationDeg,
      pelvisSubtractDeg: 0,
      readyBaselineCaptured: this.axialBaseline != null,
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
      baselineLocked: this.axialBaseline != null,
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

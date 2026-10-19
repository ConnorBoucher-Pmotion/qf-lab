import { dist3, median, midpoint, stdev } from "../pose/coordinateNormalization";
import { PoseFilter } from "../pose/landmarkFiltering";
import { OneEuroFilter } from "../pose/oneEuro";
import { LM, type Vec } from "../pose/types";
import {
  evaluateAcceptance,
  isAngleSpike,
  landmarkVis,
  occlusionLabel,
  trialQuality,
  updateCandidate,
  type CandidatePeak,
} from "./tlAcceptance";
import { handPosture, handsSettled, postureChecks, presentedHand, setupChecks, trialChecks, grade } from "./tlCompensation";
import { CAMERA_NOTE, type TLConfig } from "./tlConfig";
import { trackingConfidence } from "./tlQuality";
import {
  ROTATION_ALGORITHMS,
  cameraFacing,
  captureYaws,
  detectSigns,
  directionalRom,
  leanDegrees,
  mag,
  primaryAngle,
  readRotation,
  sub,
  type CameraFacing,
  type FrameSigns,
  type RotationAlgorithm,
  type RotationReading,
  type V3,
  type YawBaseline,
} from "./tlRotation";
import type {
  AlgorithmLive,
  CompensationSnapshot,
  ConstraintCheck,
  RotationDirection,
  TLEvent,
  TLMetrics,
  TLResult,
  TLSnapshot,
  TLStateName,
  TrackingStatus,
} from "./tlTypes";

type CalSample = { world: Vec[]; image: Vec[] };

type Baseline = {
  yaws: YawBaseline;
  signs: FrameSigns;
  midHip: Vec;
  leftHip: Vec;
  rightHip: Vec;
  leftKnee: Vec;
  rightKnee: Vec;
  hipWidth: number;
  lateral: number;
  forward: number;
  tilt: number;
  imageLeft: Vec;
  imageRight: Vec;
  imageMid: Vec;
};

const EMPTY_METRICS: TLMetrics = {
  present: false,
  shoulderYawDeg: null,
  pelvisYawDeg: null,
  headYawDeg: null,
  algorithms: { legacy: null, shoulderYaw: null, torsoPelvis: null, depthWidth: null },
  pelvisRotationDeg: null,
  pelvisTranslationPct: null,
  lateralLeanDeg: null,
  forwardLeanDeg: null,
  kneeShiftPct: null,
  hipShiftPct: null,
  shoulderTiltDeg: null,
  headLeadDeg: null,
  imageLineDeltaDeg: null,
  velocityDegPerSec: null,
  leftShoulder: null,
  rightShoulder: null,
  leftHip: null,
  rightHip: null,
  leftKnee: null,
  rightKnee: null,
  shoulderMid: null,
  hipMid: null,
  shoulderVector: null,
  pelvisVector: null,
  imageLeftShoulder: null,
  imageRightShoulder: null,
  imageLeftHip: null,
  imageRightHip: null,
};

export class TLSession {
  private poseFilter: PoseFilter;
  private angleFilter = new OneEuroFilter(1.2, 0.04);
  private ema: number | null = null;
  private lastFiltered: number | null = null;
  private lastAccepted: number | null = null;
  private lastSpikeRom: number | null = null;
  private outlierRun = 0;
  private state: TLStateName = "SEARCHING";
  private baseline: Baseline | null = null;
  private calib: CalSample[] = [];
  private calibStart = 0;
  private stableFor = 0;
  private confirmFrames = 0;
  private holdFor = 0;
  private failFor = 0;
  private weakFor = 0;
  private lastRom: number | null = null;
  private lastT: number | null = null;
  private rawPeak: number | null = null;
  private filteredPeak: number | null = null;
  private validPeak: number | null = null;
  private candidate: CandidatePeak | null = null;
  private farLowFor = 0;
  private occlusionSeen = false;
  private scoreSum = 0;
  private scoreN = 0;
  private algoPeaks: Record<RotationAlgorithm, { left: number | null; right: number | null }> = emptyAlgoPeaks();
  private countdownEndsAt: number | null = null;
  private rotateCueAt: number | null = null;
  private captureEndsAt: number | null = null;
  private countdownSpan = 0;
  private thumbFor = 0;
  private thumbSeen = false;
  private readyOpen = false;
  private voiceLatch = false;
  private handsHold = false;
  private readyFailFor = 0;
  private activeFor = 0;
  private atValid: CompensationSnapshot | null = null;
  private atRaw: CompensationSnapshot | null = null;
  private movementStarted = false;
  private rotationStartedAt: number | null = null;
  private calibStartedAt: number | null = null;
  private eventLog: Array<{ label: string; at: number }> = [];
  private result: TLResult | null = null;
  private warned = new Set<string>();
  private failed = new Set<string>();
  private blockedBy = "Waiting for a pose.";
  private stillYaws: number[] = [];
  private stillHips: V3[] = [];
  private frameTimes: number[] = [];
  private direction: RotationDirection;

  constructor(
    private config: TLConfig,
    direction: RotationDirection
  ) {
    this.direction = direction;
    this.poseFilter = new PoseFilter(this.filterOptions());
  }

  setConfig(config: TLConfig): void {
    const enterTest = config.romTestMode && !this.config.romTestMode;
    this.config = config;
    this.poseFilter.options = this.filterOptions();
    this.angleFilter.minCutoff = config.angleMinCutoffHz;
    this.angleFilter.beta = config.angleBeta;
    if (enterTest && this.baseline && !this.movementStarted && !this.result && this.countdownEndsAt == null) {
      this.beginMeasuring(this.lastT ?? performance.now());
    }
  }

  /** Manual start. Ignored until a neutral baseline exists. Does not record peaks during the countdown. */
  arm(now: number): void {
    if (!this.baseline || this.result || this.movementStarted || this.countdownEndsAt != null || this.handsHold) return;
    if (this.state !== "READY" && this.state !== "READY_CONFIRMING") return;
    this.voiceLatch = true;
    if (this.config.countdownMs <= 0 || this.config.romTestMode) {
      this.beginMeasuring(now);
      return;
    }
    this.startCountdown(now, this.config.countdownMs);
  }

  /** Spoken "ready". Same countdown as a finished thumbs-up, without the 2 second hold. */
  hearReady(now: number): void {
    if (this.voiceLatch || !this.readyOpen) return;
    if (this.state !== "READY" && this.state !== "READY_CONFIRMING") return;
    this.note("Voice ready", now);
    this.arm(now);
  }

  /** Development override. Stores the current peaks without waiting for the hold. */
  acceptPeak(): void {
    if (!this.movementStarted || this.result) return;
    const now = this.lastT ?? performance.now();
    if (this.validPeak == null && this.lastFiltered != null) this.validPeak = directionalRom(this.lastFiltered, this.direction);
    this.finish(true, now, "Peak accepted manually.", true);
  }

  setDirection(direction: RotationDirection): void {
    if (direction === this.direction) return;
    this.direction = direction;
    this.reset();
  }

  reset(): void {
    this.initializeNewTrial();
    this.weakFor = 0;
    this.lastT = null;
    this.frameTimes = [];
    this.state = "SEARCHING";
  }

  /** Discard the unfinished attempt and capture a new neutral. Stored results stay in the trial list. */
  nextTrial(): void {
    this.initializeNewTrial();
    this.state = "POSITIONING";
  }

  /**
   * Clears every temporary measurement: baseline, peaks, hold, filters, and the
   * movement gate. Does not touch the saved trial list.
   */
  private initializeNewTrial(): void {
    this.poseFilter.reset();
    this.angleFilter.reset();
    this.ema = null;
    this.lastFiltered = null;
    this.lastAccepted = null;
    this.outlierRun = 0;
    this.baseline = null;
    this.stableFor = 0;
    this.stillYaws = [];
    this.stillHips = [];
    this.lastRom = null;
    this.clearAttempt();
  }

  /** True while a thumbs-up can fill the readiness hold. */
  wantsThumb(): boolean {
    return (this.state === "READY" || this.state === "READY_CONFIRMING") && this.baseline != null && !this.movementStarted && this.result == null;
  }

  push(frame: { width: number; height: number; image: Vec[]; world: Vec[]; thumbUp?: boolean; gestureReady?: boolean }, now: number): TLSnapshot {
    const dt = this.lastT == null ? 0 : Math.max(0, now - this.lastT);
    this.lastT = now;
    this.frameTimes.push(now);
    this.frameTimes = this.frameTimes.filter((t) => now - t < 1000);
    const filtered = frame.world.length >= 33 && frame.image.length >= 33 ? this.poseFilter.apply(frame.image, frame.world, now) : null;
    const image = filtered?.gatedImage ?? [];
    const world = filtered?.gatedWorld ?? [];
    const smoothedImage = filtered?.image ?? [];
    const smoothedWorld = filtered?.world ?? [];
    const tracking = this.tracking(world, dt);
    const reading = world.length >= 33 ? readRotation(world, image, this.baseline?.yaws ?? null) : null;
    const smoothedReading = smoothedWorld.length >= 33 ? readRotation(smoothedWorld, smoothedImage, this.baseline?.yaws ?? null) : null;
    const signedRaw = reading?.torsoPelvisDeg ?? null;
    const signedSmoothed = smoothedReading ? primaryAngle(smoothedReading, this.config.algorithm) : null;
    const smoothed = tracking.present ? this.smooth(signedRaw, now) : { raw: signedRaw, filtered: this.lastFiltered };
    const rawRom = directionalRom(smoothed.raw, this.direction);
    const current = directionalRom(smoothed.filtered, this.direction);
    const velocity = this.velocity(current, dt);
    const metrics = this.metrics(world, image, reading, velocity, tracking);
    const measured = cameraFacing(world);
    const facing: CameraFacing = {
      ...measured,
      warnDeg: this.config.setupFacingWarnDeg,
      failDeg: this.config.setupFacingFailDeg,
      status: grade(measured.scoreDeg, this.config.setupFacingWarnDeg, this.config.setupFacingFailDeg),
    };
    const posture = handPosture(world);
    const setup = this.setup(image, frame.width, frame.height, reading, metrics, facing, posture);
    const checks = this.baseline ? trialChecks(this.compInput(metrics), this.config, posture) : [];
    this.observeChecks(checks, now);
    const movementHard = this.movementStarted && checks.some((check) => check.category === "hard" && check.status === "fail" && check.id !== "hands-behind");
    if (this.movementStarted) this.failFor = movementHard ? this.failFor + dt : 0;
    else this.failFor = 0;
    const hardFailed = movementHard && this.failFor >= this.config.hardFailPersistMs;
    const vis = landmarkVis(world);
    const soft = Math.max(0.12, this.config.landmarkConfidence * 0.45);
    this.farLowFor = vis.farShoulder < soft ? this.farLowFor + dt : 0;
    const spike = this.movementStarted && rawRom != null && isAngleSpike(this.lastSpikeRom, rawRom, dt, this.config.maxAngleJumpDeg, this.config.maxAngularVelocityDegPerSec);
    const acceptance = evaluateAcceptance({
      checks,
      vis,
      config: this.config,
      farLowForMs: this.farLowFor,
      direction: this.direction,
      spike,
      hardPersistFailed: hardFailed,
    });
    if (acceptance.occlusion === "expected-far-shoulder" || acceptance.occlusion === "prolonged") this.occlusionSeen = true;
    const thumbUp = frame.thumbUp === true || (frame.gestureReady === false && presentedHand(world));
    this.advance({
      now,
      dt,
      current,
      raw: rawRom,
      velocity,
      tracking,
      setup,
      hardFailed,
      hardNow: movementHard,
      metrics,
      image,
      world,
      reading,
      thumbUp,
      posture,
      acceptance,
    });
    this.blockedBy = this.explain(setup, tracking, current);
    const measuring = this.state === "ACTIVE" || this.state === "MEASURING" || this.state === "PEAK" || this.state === "HOLD" || this.state === "TRACKING_LOST";
    const depthRom = reading?.depthWidthDeg == null ? null : directionalRom(reading.depthWidthDeg, this.direction);

    return {
      state: this.state,
      instruction: this.instruction(setup, tracking),
      direction: this.direction,
      algorithm: this.config.algorithm,
      countdownLabel: this.countdownLabel(now),
      algorithmsLive: this.algorithmRows(reading),
      neutralShoulderYawDeg: this.baseline?.yaws.shoulderYawDeg ?? null,
      neutralPelvisYawDeg: this.baseline?.yaws.pelvisYawDeg ?? null,
      shoulderSpanRatio: reading?.shoulderSpanRatio ?? null,
      imageWidthDeg: reading?.imageWidthDeg ?? null,
      imageShoulderYawDeg: reading?.imageShoulderYawDeg ?? null,
      romTestMode: this.config.romTestMode,
      captureRemainingMs: this.captureEndsAt == null ? null : Math.max(0, this.captureEndsAt - now),
      thumbProgress: this.config.thumbStableMs <= 0 ? 0 : Math.max(0, Math.min(1, this.thumbFor / this.config.thumbStableMs)),
      thumbSeen: this.thumbSeen,
      canStart: this.readyOpen,
      movementMessage: !this.movementStarted
        ? ""
        : acceptance.rejectReason
          ? acceptance.rejectReason
          : acceptance.occlusion === "expected-far-shoulder"
            ? "Movement valid · expected far-shoulder occlusion"
            : "Movement valid",
      movementValid: acceptance.movementValid,
      trackingBand: acceptance.band,
      trackingScore: Math.round(acceptance.score * 100),
      occlusionState: acceptance.occlusion,
      occlusionLabel: occlusionLabel(acceptance.occlusion, this.direction),
      rejectReason: acceptance.rejectReason,
      leftShoulderVisibility: vis.leftShoulder,
      rightShoulderVisibility: vis.rightShoulder,
      leftHipVisibility: vis.leftHip,
      rightHipVisibility: vis.rightHip,
      depthAssistedRom: depthRom,
      rawShoulderYawDeg: reading?.shoulderYawDeg ?? null,
      rawPelvisYawDeg: reading?.pelvisYawDeg ?? null,
      smoothedShoulderYawDeg: smoothedReading?.shoulderYawDeg ?? null,
      smoothedPelvisYawDeg: smoothedReading?.pelvisYawDeg ?? null,
      metrics,
      tracking,
      setupChecks: setup,
      checks,
      cameraFacing: facing,
      rom: {
        current,
        raw: smoothed.raw == null ? null : directionalRom(smoothed.raw, this.direction),
        landmarkSmoothed: signedSmoothed == null ? null : directionalRom(signedSmoothed, this.direction),
        filtered: current,
        active: !this.movementStarted ? null : this.result ? this.validPeak : current,
        validPeak: this.movementStarted ? this.validPeak : null,
        rawPeak: this.movementStarted ? this.rawPeak : null,
        filteredPeak: this.movementStarted ? this.filteredPeak : null,
      },
      holdProgress: this.captureEndsAt != null && this.config.captureWindowMs > 0 ? Math.max(0, Math.min(1, this.activeFor / this.config.captureWindowMs)) : 0,
      calibrationProgress: this.calibrationProgress(now),
      baselineReady: this.baseline != null,
      calibrationComplete: this.baseline != null,
      assessmentArmed: this.baseline != null && this.result == null && (this.state === "READY" || this.state === "READY_CONFIRMING" || measuring),
      movementStarted: this.movementStarted,
      blockedBy: this.blockedBy,
      movementStartFrames: this.confirmFrames,
      movementStartFramesRequired: this.config.movementConfirmFrames,
      cameraActive: true,
      poseLoop: "active",
      lastPoseAt: now,
      hardFailed,
      quality: Math.round(acceptance.score * 100) || trackingConfidence(tracking.score, checks.filter((check) => check.status === "warn").length, hardFailed ? 1 : 0, false),
      result: this.result,
      events: this.bakedEvents(),
      imagePose: smoothedImage.length >= 33 ? smoothedImage : image,
      rawPose: frame.image,
      reference: this.referenceLine(image),
      fps: this.frameTimes.length,
      cameraNote: CAMERA_NOTE,
    };
  }

  private advance(input: {
    now: number;
    dt: number;
    current: number | null;
    raw: number | null;
    velocity: number | null;
    tracking: TrackingStatus;
    setup: ConstraintCheck[];
    hardFailed: boolean;
    hardNow: boolean;
    metrics: TLMetrics;
    image: Vec[];
    world: Vec[];
    reading: RotationReading | null;
    thumbUp: boolean;
    posture: ReturnType<typeof handPosture>;
    acceptance: ReturnType<typeof evaluateAcceptance>;
  }): void {
    if (this.result && (this.state === "COMPLETE" || this.state === "INVALID")) return;
    const { now, dt, current, raw, tracking, setup, metrics, image, world, reading, thumbUp, posture, acceptance } = input;
    if (!tracking.present) {
      this.state = "SEARCHING";
      if (!this.config.romTestMode && this.weakFor > this.config.trackingResetMs) {
        this.movementStarted ? this.finish(false, now, "Tracking was lost before the hold was confirmed.") : this.reset();
      }
      return;
    }
    if (!tracking.criticalOk) {
      if (this.countdownEndsAt != null) {
        this.countdownEndsAt = null;
        this.rotateCueAt = null;
        this.state = "READY";
        return;
      }
      if (this.movementStarted) {
        // Expected far-shoulder occlusion keeps criticalOk true; only real loss pauses here.
        if (this.weakFor < this.config.trackingLostMs) {
          this.updatePeaks(raw, current, metrics, acceptance, now, false);
          this.state = "ACTIVE";
          return;
        }
        this.state = "TRACKING_LOST";
        if (!this.config.romTestMode && this.weakFor > this.config.trackingResetMs) this.finish(false, now, "Tracking was lost before the capture window ended.");
      } else if (this.weakFor > this.config.trackingResetMs) {
        this.baseline = null;
        this.state = "POSITIONING";
      }
      return;
    }
    if (!this.baseline) {
      this.calibrate(now, dt, setup, metrics, image, world);
      return;
    }
    if (this.countdownEndsAt != null) {
      if (now < this.countdownEndsAt) {
        this.state = "COUNTDOWN";
        this.readyOpen = false;
        this.thumbSeen = false;
        return;
      }
      if (!handsSettled(posture)) {
        this.countdownEndsAt = null;
        this.rotateCueAt = null;
        this.handsHold = true;
        this.state = "COUNTDOWN";
        this.readyOpen = false;
        this.thumbSeen = false;
        return;
      }
      this.handsHold = false;
      this.beginMeasuring(now);
      return;
    }
    if (this.handsHold) {
      this.readyOpen = false;
      this.thumbSeen = false;
      this.state = "COUNTDOWN";
      if (!handsSettled(posture)) return;
      this.handsHold = false;
      this.note("Hands back", now);
      this.startCountdown(now, Math.min(1500, this.config.countdownMs || 1500));
      return;
    }
    if (!this.movementStarted) {
      const blocked = setup.some((check) => check.blocking && (check.status === "fail" || check.status === "na"));
      this.readyFailFor = blocked ? this.readyFailFor + dt : 0;
      this.readyOpen = !blocked;
      this.thumbSeen = !blocked && thumbUp;
      if (!blocked && thumbUp) this.thumbFor = Math.min(this.config.thumbStableMs, this.thumbFor + dt);
      else this.thumbFor = Math.max(0, this.thumbFor - dt * 3);
      if (blocked && this.readyFailFor > 700) {
        this.baseline = null;
        this.thumbFor = 0;
        this.readyFailFor = 0;
        this.readyOpen = false;
        this.thumbSeen = false;
        this.state = "POSITIONING";
        return;
      }
      this.state = !blocked && thumbUp && this.thumbFor > 0 ? "READY_CONFIRMING" : "READY";
      if (!blocked && thumbUp && this.thumbFor >= this.config.thumbStableMs) {
        this.note("Thumbs up", now);
        this.arm(now);
      }
      return;
    }
    this.activeFor += dt;
    this.noteAlgorithms(reading);
    this.updatePeaks(raw, current, metrics, acceptance, now, acceptance.band === "invalid" && acceptance.rejectReason === "Large landmark jump");
    if (this.config.romTestMode) {
      this.state = "MEASURING";
      return;
    }
    if (this.captureEndsAt != null && now >= this.captureEndsAt) {
      this.finish(true, now, "Capture window complete.");
      return;
    }
    this.state = "ACTIVE";
  }

  private updatePeaks(
    raw: number | null,
    current: number | null,
    metrics: TLMetrics,
    acceptance: ReturnType<typeof evaluateAcceptance>,
    now: number,
    spiked: boolean
  ): void {
    if (raw != null && (this.rawPeak == null || raw > this.rawPeak)) {
      this.rawPeak = raw;
      this.atRaw = compOf(metrics);
    }
    if (current != null && (this.filteredPeak == null || current > this.filteredPeak)) this.filteredPeak = current;
    this.scoreSum += acceptance.score;
    this.scoreN += 1;
    const sample = raw ?? current;
    if (sample == null) return;
    if (!spiked) this.lastSpikeRom = sample;
    if (acceptance.acceptPeak) {
      if (this.validPeak == null || sample > this.validPeak) {
        this.validPeak = sample;
        this.atValid = compOf(metrics);
      }
      this.candidate = null;
      return;
    }
    if (acceptance.candidateOnly) {
      const next = updateCandidate(this.candidate, sample, now, 450, 2.5);
      this.candidate = next.candidate;
      if (next.promoted != null && (this.validPeak == null || next.promoted > this.validPeak)) {
        this.validPeak = next.promoted;
        this.atValid = compOf(metrics);
      }
    }
  }

  private calibrate(now: number, dt: number, setup: ConstraintCheck[], metrics: TLMetrics, image: Vec[], world: Vec[]): void {
    const blocked = setup.some((check) => check.blocking && (check.status === "fail" || check.status === "na"));
    const yaw = metrics.shoulderYawDeg;
    const hip = metrics.hipMid;
    const still = !blocked && yaw != null && hip != null && this.rememberStill(yaw, hip, metrics);
    if (!still) {
      this.stableFor = 0;
      this.calib = [];
      this.state = "POSITIONING";
      return;
    }
    this.stableFor += dt;
    if (this.stableFor < this.config.stableMs) {
      this.state = "STABLE";
      return;
    }
    if (this.calib.length === 0) {
      this.calibStart = now;
      this.calibStartedAt = now;
      this.note("Neutral detected", now);
    }
    this.calib.push({ world: world.map(copyVec), image: image.map(copyVec) });
    this.state = "CALIBRATING";
    if (now - this.calibStart < this.config.calibrationMs || this.calib.length < this.config.minCalibrationFrames) return;
    const built = this.buildBaseline();
    if (!built) {
      this.calib = [];
      this.stableFor = 0;
      this.state = "POSITIONING";
      return;
    }
    this.baseline = built;
    this.calib = [];
    this.angleFilter.reset();
    this.ema = null;
    this.lastFiltered = null;
    this.lastAccepted = null;
    this.lastRom = null;
    this.note("Calibration complete", now);
    if (this.config.romTestMode) this.beginMeasuring(now);
    else this.state = "READY";
  }

  private startCountdown(now: number, span: number): void {
    const length = Math.max(0, span);
    this.countdownSpan = length;
    this.thumbFor = 0;
    this.thumbSeen = false;
    this.readyOpen = false;
    this.handsHold = false;
    if (length <= 0) {
      this.beginMeasuring(now);
      return;
    }
    this.rotateCueAt = now + length;
    this.countdownEndsAt = now + length + 400;
    this.state = "COUNTDOWN";
    this.note("Countdown started", now);
  }

  private beginMeasuring(now: number): void {
    this.countdownEndsAt = null;
    this.rotateCueAt = null;
    this.captureEndsAt = this.config.romTestMode ? null : now + this.config.captureWindowMs;
    this.thumbFor = 0;
    this.thumbSeen = false;
    this.readyOpen = false;
    this.handsHold = false;
    this.candidate = null;
    this.farLowFor = 0;
    this.occlusionSeen = false;
    this.scoreSum = 0;
    this.scoreN = 0;
    this.lastSpikeRom = null;
    this.movementStarted = true;
    this.rotationStartedAt = now;
    this.activeFor = 0;
    this.rawPeak = null;
    this.filteredPeak = null;
    this.validPeak = null;
    this.atRaw = null;
    this.atValid = null;
    this.holdFor = 0;
    this.algoPeaks = emptyAlgoPeaks();
    this.angleFilter.reset();
    this.ema = null;
    this.lastFiltered = null;
    this.lastAccepted = null;
    this.lastRom = null;
    this.state = this.config.romTestMode ? "MEASURING" : "ACTIVE";
    this.note("Rotation started", now);
  }

  private finish(accepted: boolean, now: number, why: string, manual = false): void {
    if (this.result) return;
    const valid = this.validPeak;
    const ok = valid != null && valid > 0;
    this.note(ok ? "Best valid rotation saved" : why, now);
    this.note(ok ? "Assessment complete" : "Assessment stopped", now);
    const failed = [...this.failed];
    const scorePct = this.scoreN > 0 ? Math.round((this.scoreSum / this.scoreN) * 100) : trackingConfidence(1, this.warned.size, failed.length, false);
    const quality = trialQuality(scorePct, this.occlusionSeen, ok);
    this.result = {
      version: 1,
      id: `tl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      direction: this.direction,
      series: "",
      trialNumber: 0,
      accepted: ok,
      algorithm: "torsoPelvis",
      measuredRom: valid,
      rawMaximum: this.rawPeak,
      confidence: scorePct,
      holdMs: this.holdFor || null,
      failedConstraints: failed,
      warningEvents: [...this.warned],
      failureEvents: failed,
      events: this.bakedEvents(),
      atValid: this.atValid,
      atRaw: this.atRaw,
      thresholds: {
        pelvisRotationWarnDeg: this.config.pelvisRotationWarnDeg,
        pelvisRotationFailDeg: this.config.pelvisRotationFailDeg,
        pelvisTranslationWarnPct: this.config.pelvisTranslationWarnPct,
        pelvisTranslationFailPct: this.config.pelvisTranslationFailPct,
        lateralLeanWarnDeg: this.config.lateralLeanWarnDeg,
        lateralLeanFailDeg: this.config.lateralLeanFailDeg,
        forwardLeanWarnDeg: this.config.forwardLeanWarnDeg,
        forwardLeanFailDeg: this.config.forwardLeanFailDeg,
        kneeShiftWarnPct: this.config.kneeShiftWarnPct,
        kneeShiftFailPct: this.config.kneeShiftFailPct,
        hipShiftWarnPct: this.config.hipShiftWarnPct,
        hipShiftFailPct: this.config.hipShiftFailPct,
      },
      endChecks: [],
      instruction: ok ? "Capture window complete." : valid == null ? "No valid rotation was captured in that direction." : why,
      preRollMs: 0,
      trialQuality: quality,
      qualityNote: this.occlusionSeen ? "Brief expected shoulder occlusion detected" : "",
      cameraGuideOffsetDeg: this.config.cameraGuideOffsetDeg,
    };
    this.state = accepted || manual ? "COMPLETE" : "INVALID";
  }

  private setup(image: Vec[], width: number, height: number, reading: ReturnType<typeof readRotation> | null, metrics: TLMetrics, facing: CameraFacing, posture: ReturnType<typeof handPosture>): ConstraintCheck[] {
    const upright = maxAbs(metrics.lateralLeanDeg, metrics.forwardLeanDeg);
    const square = reading?.torsoPelvisDeg == null ? null : Math.abs(reading.torsoPelvisDeg);
    const handsBlocking = this.state !== "READY" && this.state !== "READY_CONFIRMING" && this.state !== "COUNTDOWN";
    return [...setupChecks({ ...blankComp(), facingYawDeg: facing.scoreDeg, uprightDeg: upright, squareDeg: square, lateralLeanDeg: metrics.lateralLeanDeg, forwardLeanDeg: metrics.forwardLeanDeg }, this.config, facing), ...postureChecks(posture, handsBlocking), ...framingChecks(image, width, height)];
  }

  private metrics(world: Vec[], image: Vec[], reading: ReturnType<typeof readRotation> | null, velocity: number | null, tracking: TrackingStatus): TLMetrics {
    if (!reading || world.length < 33) return { ...EMPTY_METRICS, present: tracking.present };
    const signs = this.baseline?.signs ?? detectSigns(world);
    const lean = signs ? leanDegrees(world, signs) : { lateral: null, forward: null, tilt: null };
    const leftHip = world[LM.leftHip];
    const rightHip = world[LM.rightHip];
    const leftShoulder = world[LM.leftShoulder];
    const rightShoulder = world[LM.rightShoulder];
    const leftKnee = world[LM.leftKnee];
    const rightKnee = world[LM.rightKnee];
    const hipMid = midpoint(leftHip, rightHip);
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipWidth = this.baseline?.hipWidth ?? Math.max(dist3(leftHip, rightHip), 1e-4);
    const base = this.baseline;
    return {
      present: true,
      shoulderYawDeg: reading.shoulderYawDeg,
      pelvisYawDeg: reading.pelvisYawDeg,
      headYawDeg: reading.headYawDeg,
      algorithms: {
        legacy: directionalRom(reading.legacyDeg, this.direction),
        shoulderYaw: directionalRom(reading.shoulderFromNeutralDeg, this.direction),
        torsoPelvis: directionalRom(reading.torsoPelvisDeg, this.direction),
        depthWidth: directionalRom(reading.depthWidthDeg, this.direction),
      },
      pelvisRotationDeg: base && reading.pelvisYawDeg != null ? Math.abs(reading.pelvisYawDeg - base.yaws.pelvisYawDeg) : null,
      pelvisTranslationPct: base ? (dist3(hipMid, base.midHip) / hipWidth) * 100 : null,
      lateralLeanDeg: base && lean.lateral != null ? lean.lateral - base.lateral : lean.lateral,
      forwardLeanDeg: base && lean.forward != null ? lean.forward - base.forward : lean.forward,
      kneeShiftPct: base ? (Math.max(dist3(leftKnee, base.leftKnee), dist3(rightKnee, base.rightKnee)) / hipWidth) * 100 : null,
      hipShiftPct: base ? (Math.max(dist3(leftHip, base.leftHip), dist3(rightHip, base.rightHip)) / hipWidth) * 100 : null,
      shoulderTiltDeg: base && lean.tilt != null ? lean.tilt - base.tilt : lean.tilt,
      headLeadDeg: reading.headYawDeg != null && reading.shoulderYawDeg != null ? reading.headYawDeg - reading.shoulderYawDeg : null,
      imageLineDeltaDeg: reading.imageLineDeltaDeg,
      velocityDegPerSec: velocity,
      leftShoulder,
      rightShoulder,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      shoulderMid,
      hipMid,
      shoulderVector: sub(rightShoulder, leftShoulder),
      pelvisVector: sub(rightHip, leftHip),
      imageLeftShoulder: imagePoint(image, LM.leftShoulder),
      imageRightShoulder: imagePoint(image, LM.rightShoulder),
      imageLeftHip: imagePoint(image, LM.leftHip),
      imageRightHip: imagePoint(image, LM.rightHip),
    };
  }

  private compInput(metrics: TLMetrics) {
    return { ...blankComp(), ...metrics };
  }

  private buildBaseline(): Baseline | null {
    if (this.calib.length < 4) return null;
    const world = medianPose(this.calib.map((sample) => sample.world));
    const image = medianPose(this.calib.map((sample) => sample.image));
    const signs = detectSigns(world);
    if (!signs) return null;
    const yaws = captureYaws(world, image, signs);
    const lean = leanDegrees(world, signs);
    if (!yaws || lean.lateral == null || lean.forward == null) return null;
    const leftHip = world[LM.leftHip];
    const rightHip = world[LM.rightHip];
    return {
      yaws,
      signs,
      midHip: midpoint(leftHip, rightHip),
      leftHip,
      rightHip,
      leftKnee: world[LM.leftKnee],
      rightKnee: world[LM.rightKnee],
      hipWidth: Math.max(dist3(leftHip, rightHip), 1e-4),
      lateral: lean.lateral,
      forward: lean.forward,
      tilt: lean.tilt ?? 0,
      imageLeft: image[LM.leftShoulder],
      imageRight: image[LM.rightShoulder],
      imageMid: midpoint(image[LM.leftShoulder], image[LM.rightShoulder]),
    };
  }

  private rememberStill(yaw: number, hip: Vec, metrics: TLMetrics): boolean {
    this.stillYaws.push(yaw);
    this.stillHips.push(hip);
    if (this.stillYaws.length > 18) this.stillYaws.shift();
    if (this.stillHips.length > 18) this.stillHips.shift();
    if (this.stillYaws.length < 6) return false;
    if (stdev(this.stillYaws) > this.config.maxCalibrationYawSdDeg) return false;
    const span = (key: "x" | "y" | "z") => Math.max(...this.stillHips.map((point) => point[key])) - Math.min(...this.stillHips.map((point) => point[key]));
    const hipWidth = Math.max(dist3(metrics.leftHip ?? hip, metrics.rightHip ?? hip), 1e-4);
    return Math.hypot(span("x"), span("y"), span("z")) / hipWidth <= this.config.maxCalibrationPelvisJitter;
  }

  private smooth(raw: number | null, now: number): { raw: number | null; filtered: number | null } {
    if (raw == null || !Number.isFinite(raw)) return { raw, filtered: this.lastFiltered };
    if (this.lastAccepted != null && Math.abs(raw - this.lastAccepted) > this.config.angleOutlierDeg) {
      this.outlierRun += 1;
      if (this.outlierRun < this.config.reacquireFrames) return { raw, filtered: this.lastFiltered };
    } else this.outlierRun = 0;
    this.lastAccepted = raw;
    let filtered = raw;
    if (this.config.angleFilter === "oneEuro") filtered = this.angleFilter.filter(raw, now, 1);
    else if (this.config.angleFilter === "ema") {
      this.ema = this.ema == null ? raw : this.ema + this.config.angleEmaAlpha * (raw - this.ema);
      filtered = this.ema;
    }
    this.lastFiltered = filtered;
    return { raw, filtered };
  }

  private velocity(current: number | null, dt: number): number | null {
    if (current == null) return null;
    if (this.lastRom == null || dt <= 0) {
      this.lastRom = current;
      return null;
    }
    const velocity = ((current - this.lastRom) * 1000) / dt;
    this.lastRom = current;
    return velocity;
  }

  private tracking(world: Vec[], dt: number): TrackingStatus {
    const min = this.config.landmarkConfidence;
    const soft = Math.max(0.12, min * 0.45);
    const points = landmarkVis(world);
    const vis = (index: number) => world[index]?.visibility ?? 0;
    const hips = Math.min(points.leftHip, points.rightHip);
    const knees = world.length >= 33 ? Math.min(vis(LM.leftKnee), vis(LM.rightKnee)) : 0;
    const ears = world.length >= 33 ? Math.min(vis(LM.leftEar), vis(LM.rightEar)) : 0;
    const shoulders = points.nearShoulder;
    const present = points.nearShoulder > 0.05 && hips > 0.05;
    // During ACTIVE, knees and the far shoulder may drop without ending the trial.
    const farOk = points.farShoulder >= soft || (this.movementStarted && this.farLowFor <= this.config.occlusionHoldMs);
    const criticalOk = present && points.nearShoulder >= soft && hips >= soft && (this.movementStarted ? farOk : points.farShoulder >= min && knees >= min);
    this.weakFor = criticalOk ? 0 : this.weakFor + dt;
    const score = Math.max(0, Math.min(1, points.nearShoulder * 0.5 + Math.max(points.farShoulder, soft) * 0.2 + hips * 0.3));
    return {
      present,
      criticalOk,
      score: present ? score : 0,
      absentMs: present ? 0 : this.weakFor,
      criticalBadMs: this.weakFor,
      shoulders,
      hips,
      knees,
      ears,
    };
  }

  private referenceLine(image: Vec[]): TLSnapshot["reference"] {
    const base = this.baseline;
    if (!base || image.length < 33) return null;
    const mid = midpoint(image[LM.leftShoulder], image[LM.rightShoulder]);
    const left = sub(base.imageLeft, base.imageMid);
    const right = sub(base.imageRight, base.imageMid);
    const current = mag(sub(image[LM.rightShoulder], image[LM.leftShoulder]));
    const saved = Math.max(mag(sub(base.imageRight, base.imageLeft)), 1);
    const scale = current / saved;
    return { x1: mid.x + left.x * scale, y1: mid.y + left.y * scale, x2: mid.x + right.x * scale, y2: mid.y + right.y * scale };
  }

  private calibrationProgress(now: number): number {
    if (this.state === "STABLE") return this.config.stableMs <= 0 ? 1 : Math.min(1, this.stableFor / this.config.stableMs);
    if (this.state === "CALIBRATING") return this.config.calibrationMs <= 0 ? 1 : Math.min(1, (now - this.calibStart) / this.config.calibrationMs);
    return 0;
  }

  private observeChecks(checks: ConstraintCheck[], now: number): void {
    if (!this.movementStarted) return;
    for (const check of checks) {
      if (check.category !== "hard") continue;
      if (check.status === "warn" && !this.warned.has(check.id)) {
        this.warned.add(check.id);
        this.note(`${check.label} warning`, now);
      }
      if (check.status === "fail" && !this.failed.has(check.id)) {
        this.failed.add(check.id);
        this.note(`${check.label} failure`, now);
      }
      if (check.status === "pass" && (this.warned.has(check.id) || this.failed.has(check.id))) {
        this.warned.delete(check.id);
        this.failed.delete(check.id);
        this.note(`${check.label} back inside the limit`, now);
      }
    }
  }

  private countdownLabel(now: number): string | null {
    if (this.handsHold || this.countdownEndsAt == null || this.rotateCueAt == null || now >= this.countdownEndsAt) return null;
    if (now >= this.rotateCueAt) return this.direction === "left" ? "ROTATE LEFT" : "ROTATE RIGHT";
    const third = this.countdownSpan / 3;
    const remain = this.rotateCueAt - now;
    if (third <= 0) return "1";
    if (remain > third * 2) return "3";
    if (remain > third) return "2";
    return "1";
  }

  private algorithmRows(reading: RotationReading | null): AlgorithmLive[] {
    return ROTATION_ALGORITHMS.map((id) => ({
      id,
      current: this.baseline && reading ? primaryAngle(reading, id) : null,
      leftPeak: this.movementStarted ? this.algoPeaks[id].left : null,
      rightPeak: this.movementStarted ? this.algoPeaks[id].right : null,
    }));
  }

  private noteAlgorithms(reading: RotationReading | null): void {
    if (!reading) return;
    for (const id of ROTATION_ALGORITHMS) {
      const signed = primaryAngle(reading, id);
      if (signed == null || !Number.isFinite(signed)) continue;
      const slot = this.algoPeaks[id];
      if (signed > 0 && (slot.right == null || signed > slot.right)) slot.right = signed;
      if (signed < 0 && (slot.left == null || -signed > slot.left)) slot.left = -signed;
    }
  }

  private explain(setup: ConstraintCheck[], tracking: TrackingStatus, current: number | null): string {
    if (this.state === "SEARCHING" || !tracking.present) return "Waiting for both shoulders and both hips.";
    if (this.state === "TRACKING_LOST" || !tracking.criticalOk) return "Landmarks dropped. Shoulders, hips, and knees must be visible again.";
    if (this.state === "POSITIONING") {
      const failed = setup.find((check) => check.blocking && (check.status === "fail" || check.status === "na"));
      return failed ? failed.message : "Hold still. Neutral calibration has not started.";
    }
    if (this.state === "STABLE") return `Hold still. Neutral calibration starts in ${Math.max(0, Math.round(this.config.stableMs - this.stableFor))} ms.`;
    if (this.state === "CALIBRATING") return `Capturing a new neutral. ${this.calib.length}/${this.config.minCalibrationFrames} frames.`;
    if (this.state === "READY" || this.state === "READY_CONFIRMING") {
      const blocked = setup.find((check) => check.blocking && (check.status === "fail" || check.status === "na"));
      if (blocked) return blocked.message;
      if (this.thumbSeen) return `Thumbs up held ${Math.round(this.thumbFor)}/${this.config.thumbStableMs} ms.`;
      return "Position looks good. Hold a thumbs up for 2 seconds, or say Ready.";
    }
    if (this.handsHold) return "Return both hands behind your head before the rotation starts.";
    if (this.state === "COUNTDOWN") return "Countdown. Put both hands behind your head. The capture window starts when it says rotate.";
    if (this.state === "ACTIVE" || this.state === "MEASURING") {
      const remain = this.captureEndsAt == null ? null : Math.max(0, this.captureEndsAt - (this.lastT ?? 0));
      const left = remain == null ? "" : ` ${Math.ceil(remain / 100) / 10} s left.`;
      const live = current == null ? "—" : `${Math.max(0, current).toFixed(1)}°`;
      return `Capturing the best valid ${this.direction} rotation. Live ${live}.${left} Shoulder rotation is expected.`;
    }
    if (this.state === "PEAK" || this.state === "HOLD") return `Holding the peak ${Math.round(this.holdFor)}/${this.config.holdMs} ms. Leaving ±${this.config.peakWindowDeg}° resets the timer.`;
    if (this.state === "COMPLETE") return "Trial stored. Next trial clears this calibration and waits for a new rotation.";
    return this.result?.instruction ?? "Trial stopped.";
  }

  private instruction(setup: ConstraintCheck[], tracking: TrackingStatus): string {
    if (this.state === "COMPLETE") {
      const rom = this.result?.measuredRom;
      const side = this.direction === "left" ? "Left" : "Right";
      return this.result?.accepted && rom != null ? `${side} TL Junction ROM ${rom.toFixed(1)}°.` : (this.result?.instruction ?? "Assessment stopped.");
    }
    if (this.state === "INVALID") return this.result?.instruction ?? "Assessment stopped.";
    if (this.state === "TRACKING_LOST" || !tracking.present) return "Tracking lost. Sit so both shoulders, both hips, and both knees are visible.";
    if (this.handsHold) return "Return both hands behind your head.";
    if (this.state === "READY") return "Position looks good. Hold 👍 for 2 seconds or say \"Ready\".";
    if (this.state === "READY_CONFIRMING") return "👍 Ready gesture detected — keep holding.";
    if (this.state === "COUNTDOWN") return "Ready! Get both hands behind your head.";
    if (this.state === "ACTIVE" || this.state === "MEASURING") return this.direction === "left" ? "ROTATE LEFT" : "ROTATE RIGHT";
    if (this.state === "PEAK" || this.state === "HOLD") return "Hold your maximum position until the bar fills.";
    if (this.state === "CALIBRATING") return "Hold the neutral position. Face forward, sit tall, and keep the knees still.";
    if (this.state === "STABLE") return "Hold still. Neutral calibration is about to start.";
    const failed = setup.find((check) => check.blocking && check.status === "fail");
    if (failed?.id === "frame-size-small") return "Move closer.";
    if (failed?.id === "frame-size-large") return "Move backward.";
    if (failed?.id === "center") return "Center yourself.";
    if (failed?.id === "edges") return "Both shoulders, hips, and knees must be inside the frame.";
    if (failed?.id === "upright") return "Sit taller.";
    if (failed?.id === "facing") return "Turn to face the camera and keep your pelvis forward.";
    if (!tracking.criticalOk) return "Both shoulders, both hips, and both knees must be visible.";
    return "Hold still. Sit upright, hands clasped behind your head, elbows out.";
  }

  private note(label: string, now: number): void {
    if (this.eventLog[this.eventLog.length - 1]?.label === label) return;
    this.eventLog.push({ label, at: now });
  }

  private bakedEvents(): TLEvent[] {
    const origin = this.rotationStartedAt ?? this.calibStartedAt ?? this.eventLog[0]?.at ?? 0;
    return this.eventLog.map((event) => ({ label: event.label, offsetMs: Math.round(event.at - origin) }));
  }

  private clearAttempt(): void {
    this.calib = [];
    this.confirmFrames = 0;
    this.holdFor = 0;
    this.failFor = 0;
    this.rawPeak = null;
    this.validPeak = null;
    this.atValid = null;
    this.atRaw = null;
    this.movementStarted = false;
    this.countdownEndsAt = null;
    this.rotateCueAt = null;
    this.captureEndsAt = null;
    this.countdownSpan = 0;
    this.thumbFor = 0;
    this.thumbSeen = false;
    this.readyOpen = false;
    this.voiceLatch = false;
    this.handsHold = false;
    this.readyFailFor = 0;
    this.candidate = null;
    this.farLowFor = 0;
    this.occlusionSeen = false;
    this.scoreSum = 0;
    this.scoreN = 0;
    this.lastSpikeRom = null;
    this.activeFor = 0;
    this.algoPeaks = emptyAlgoPeaks();
    this.filteredPeak = null;
    this.rotationStartedAt = null;
    this.calibStartedAt = null;
    this.eventLog = [];
    this.result = null;
    this.warned.clear();
    this.failed.clear();
  }

  private filterOptions() {
    return {
      minCutoffHz: this.config.landmarkMinCutoffHz,
      beta: this.config.landmarkBeta,
      outlierJumpHipWidths: this.config.outlierJumpHipWidths,
      reacquireFrames: this.config.reacquireFrames,
    };
  }
}

function compOf(metrics: TLMetrics): CompensationSnapshot {
  return {
    pelvisRotationDeg: metrics.pelvisRotationDeg,
    pelvisTranslationPct: metrics.pelvisTranslationPct,
    lateralLeanDeg: metrics.lateralLeanDeg,
    forwardLeanDeg: metrics.forwardLeanDeg,
    kneeShiftPct: metrics.kneeShiftPct,
    hipShiftPct: metrics.hipShiftPct,
    shoulderTiltDeg: metrics.shoulderTiltDeg,
    headLeadDeg: metrics.headLeadDeg,
  };
}

function blankComp() {
  return {
    pelvisRotationDeg: null,
    pelvisTranslationPct: null,
    lateralLeanDeg: null,
    forwardLeanDeg: null,
    kneeShiftPct: null,
    hipShiftPct: null,
    shoulderTiltDeg: null,
    headLeadDeg: null,
    facingYawDeg: null,
    uprightDeg: null,
    squareDeg: null,
  };
}

function maxAbs(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
}

function emptyAlgoPeaks(): Record<RotationAlgorithm, { left: number | null; right: number | null }> {
  return {
    legacy: { left: null, right: null },
    shoulderYaw: { left: null, right: null },
    torsoPelvis: { left: null, right: null },
    depthWidth: { left: null, right: null },
  };
}

function imagePoint(image: Vec[], index: number): Vec | null {
  const point = image[index];
  return point ? point : null;
}

function copyVec(point: Vec): Vec {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility };
}

function medianPose(samples: Vec[][]): Vec[] {
  const out: Vec[] = [];
  for (let index = 0; index < 33; index += 1) {
    out.push({
      x: median(samples.map((pose) => pose[index]?.x ?? 0)),
      y: median(samples.map((pose) => pose[index]?.y ?? 0)),
      z: median(samples.map((pose) => pose[index]?.z ?? 0)),
      visibility: median(samples.map((pose) => pose[index]?.visibility ?? 0)),
    });
  }
  return out;
}

function framingChecks(image: Vec[], width: number, height: number): ConstraintCheck[] {
  if (image.length < 33 || width < 2 || height < 2) return [];
  const hip = midpoint(image[LM.leftHip], image[LM.rightHip]);
  const shoulder = midpoint(image[LM.leftShoulder], image[LM.rightShoulder]);
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) / height;
  const offCenter = Math.abs(hip.x / width - 0.5);
  const edge = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee].some((index) => {
    const point = image[index];
    return point.x < width * 0.02 || point.x > width * 0.98 || point.y < height * 0.02 || point.y > height * 0.98;
  });
  return [
    flag("frame-size-small", "Move closer", torso < 0.16),
    flag("frame-size-large", "Move backward", torso > 0.72),
    flag("center", "Center yourself", offCenter > 0.28),
    flag("edges", "Stay inside the frame", edge),
  ];
}

function flag(id: string, label: string, failing: boolean): ConstraintCheck {
  return {
    id,
    label,
    category: "setup",
    value: failing ? 1 : 0,
    warn: null,
    fail: 1,
    unit: "",
    status: failing ? "fail" : "pass",
    blocking: true,
    message: failing ? label : "OK",
  };
}

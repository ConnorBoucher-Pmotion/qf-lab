import { dist3, median, midpoint, stdev } from "../pose/coordinateNormalization";
import { PoseFilter } from "../pose/landmarkFiltering";
import { OneEuroFilter } from "../pose/oneEuro";
import { LM, type Vec } from "../pose/types";
import {
  evaluateAcceptance,
  isAngleSpike,
  landmarkVis,
  trialQuality,
  updateCandidate,
  type CandidatePeak,
} from "./srAcceptance";
import { armsSettled, framingChecks, presentedHand, setupChecks, trialChecks, grade } from "./srConstraints";
import { CAMERA_NOTE, type SRConfig } from "./srConfig";
import { trackingConfidence } from "./srQuality";
import {
  arcOf,
  cameraFacing,
  captureSideBaseline,
  readShoulder,
  type CameraFacing,
  type SideBaseline,
  type ShoulderReading,
  type V3,
} from "./srGeometry";
import type {
  CompensationSnapshot,
  ConstraintCheck,
  RejectTally,
  Side,
  SideAngles,
  SideRom,
  SREvent,
  SRMetrics,
  SRResult,
  SRSnapshot,
  SRStateName,
  TrackingStatus,
} from "./srTypes";

type CalSample = { world: Vec[]; image: Vec[] };

type Baseline = {
  left: SideBaseline;
  right: SideBaseline;
  midHip: Vec;
  leftHip: Vec;
  rightHip: Vec;
  hipWidth: number;
  lateral: number;
  forward: number;
  imageLeftShoulder: Vec;
  imageRightShoulder: Vec;
};

type SidePeaks = {
  rawEr: number | null;
  rawIr: number | null;
  validEr: number | null;
  validIr: number | null;
  filteredEr: number | null;
  filteredIr: number | null;
  candidateEr: CandidatePeak | null;
  candidateIr: CandidatePeak | null;
  lastSpike: number | null;
  filter: OneEuroFilter;
  ema: number | null;
  lastFiltered: number | null;
  lastAccepted: number | null;
  outlierRun: number;
};

const EMPTY_SIDE: SideAngles = {
  abductionDeg: null,
  elbowFlexionDeg: null,
  signedRotationDeg: null,
  elbowHeightDiff: null,
  elbowDriftPct: null,
  shoulderShrugPct: null,
  confidence: 0,
};

const EMPTY_METRICS: SRMetrics = {
  present: false,
  left: EMPTY_SIDE,
  right: EMPTY_SIDE,
  lateralLeanDeg: null,
  forwardLeanDeg: null,
  shoulderTiltDeg: null,
  shoulderHeightDiff: null,
  velocityDegPerSec: null,
  leftShoulder: null,
  rightShoulder: null,
  leftElbow: null,
  rightElbow: null,
  leftWrist: null,
  rightWrist: null,
  leftHip: null,
  rightHip: null,
  shoulderMid: null,
  hipMid: null,
  imageLeftShoulder: null,
  imageRightShoulder: null,
  imageLeftElbow: null,
  imageRightElbow: null,
  imageLeftWrist: null,
  imageRightWrist: null,
};

export class SRSession {
  private poseFilter: PoseFilter;
  private state: SRStateName = "SEARCHING";
  private baseline: Baseline | null = null;
  private calib: CalSample[] = [];
  private calibStart = 0;
  private stableFor = 0;
  private failFor = 0;
  private weakFor = 0;
  private lastT: number | null = null;
  private left = emptyPeaks();
  private right = emptyPeaks();
  private scoreSum = 0;
  private scoreN = 0;
  private minScore = 1;
  private countdownEndsAt: number | null = null;
  private rotateCueAt: number | null = null;
  private captureEndsAt: number | null = null;
  private countdownSpan = 0;
  private thumbFor = 0;
  private thumbSeen = false;
  private readyOpen = false;
  private voiceLatch = false;
  private armsHold = false;
  private readyFailFor = 0;
  private activeFor = 0;
  private atValid: CompensationSnapshot | null = null;
  private atRaw: CompensationSnapshot | null = null;
  private movementStarted = false;
  private movementConfirmed = false;
  private confirmFrames = 0;
  private movementStartedAt: number | null = null;
  private calibStartedAt: number | null = null;
  private eventLog: Array<{ label: string; at: number }> = [];
  private result: SRResult | null = null;
  private warned = new Set<string>();
  private failed = new Set<string>();
  private blockedBy = "Waiting for a pose.";
  private stillAngles: number[] = [];
  private stillHips: V3[] = [];
  private frameTimes: number[] = [];
  private rejectedFrameCount = 0;
  private validFrameCount = 0;
  private rejectTallies = new Map<string, number>();
  private shrugEvents = 0;
  private abdSum = { left: 0, right: 0, n: 0 };
  private elbowSum = { left: 0, right: 0, n: 0 };
  private abdMaxDev = { left: 0, right: 0 };
  private elbowMaxDev = { left: 0, right: 0 };
  private lastVelocity: number | null = null;
  private lastCombined: number | null = null;

  constructor(private config: SRConfig) {
    this.poseFilter = new PoseFilter(this.filterOptions());
  }

  setConfig(config: SRConfig): void {
    const enterTest = config.romTestMode && !this.config.romTestMode;
    this.config = config;
    this.poseFilter.options = this.filterOptions();
    this.left.filter.minCutoff = config.angleMinCutoffHz;
    this.left.filter.beta = config.angleBeta;
    this.right.filter.minCutoff = config.angleMinCutoffHz;
    this.right.filter.beta = config.angleBeta;
    if (enterTest && this.baseline && !this.movementStarted && !this.result && this.countdownEndsAt == null) {
      this.beginMeasuring(this.lastT ?? performance.now());
    }
  }

  arm(now: number): void {
    if (!this.baseline || this.result || this.movementStarted || this.countdownEndsAt != null || this.armsHold) return;
    if (this.state !== "READY" && this.state !== "READY_CONFIRMING") return;
    this.voiceLatch = true;
    if (this.config.countdownMs <= 0 || this.config.romTestMode) {
      this.beginMeasuring(now);
      return;
    }
    this.startCountdown(now, this.config.countdownMs);
  }

  hearReady(now: number): void {
    if (this.voiceLatch || !this.readyOpen) return;
    if (this.state !== "READY" && this.state !== "READY_CONFIRMING") return;
    this.note("Voice ready", now);
    this.arm(now);
  }

  acceptPeak(): void {
    if (!this.movementStarted || this.result) return;
    const now = this.lastT ?? performance.now();
    this.finish(true, now, "Peak accepted manually.", true);
  }

  reset(): void {
    this.initializeNewTrial();
    this.weakFor = 0;
    this.lastT = null;
    this.frameTimes = [];
    this.state = "SEARCHING";
  }

  nextTrial(): void {
    this.initializeNewTrial();
    this.state = "POSITIONING";
  }

  private initializeNewTrial(): void {
    this.poseFilter.reset();
    this.resetPeaks(this.left);
    this.resetPeaks(this.right);
    this.baseline = null;
    this.stableFor = 0;
    this.stillAngles = [];
    this.stillHips = [];
    this.clearAttempt();
  }

  wantsThumb(): boolean {
    return (this.state === "READY" || this.state === "READY_CONFIRMING") && this.baseline != null && !this.movementStarted && this.result == null;
  }

  push(frame: { width: number; height: number; image: Vec[]; world: Vec[]; thumbUp?: boolean; gestureReady?: boolean }, now: number): SRSnapshot {
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
    const baselineSides = this.baseline ? { left: this.baseline.left, right: this.baseline.right } : null;
    const reading = world.length >= 33 ? readShoulder(world, baselineSides) : null;
    const smoothedReading = smoothedWorld.length >= 33 ? readShoulder(smoothedWorld, baselineSides) : null;
    const leftRaw = reading?.left.signedRotationDeg ?? null;
    const rightRaw = reading?.right.signedRotationDeg ?? null;
    const leftSmooth = tracking.present ? this.smoothSide(this.left, leftRaw, now) : { raw: leftRaw, filtered: this.left.lastFiltered };
    const rightSmooth = tracking.present ? this.smoothSide(this.right, rightRaw, now) : { raw: rightRaw, filtered: this.right.lastFiltered };
    const metrics = this.metrics(world, image, reading, tracking);
    const measured = cameraFacing(world);
    const facing: CameraFacing = {
      ...measured,
      warnDeg: this.config.setupFacingWarnDeg,
      failDeg: this.config.setupFacingFailDeg,
      status: grade(measured.scoreDeg, this.config.setupFacingWarnDeg, this.config.setupFacingFailDeg),
    };
    const setup = this.setup(image, frame.width, frame.height, reading, facing);
    const checks = this.baseline && reading ? trialChecks(reading, this.config) : [];
    this.observeChecks(checks, now);
    const movementHard = this.movementStarted && checks.some((check) => check.category === "hard" && check.status === "fail");
    if (this.movementStarted) this.failFor = movementHard ? this.failFor + dt : 0;
    else this.failFor = 0;
    const hardFailed = movementHard && this.failFor >= this.config.hardFailPersistMs;
    const vis = landmarkVis(world);
    const leftSpike =
      this.movementStarted && leftSmooth.raw != null && isAngleSpike(this.left.lastSpike, leftSmooth.raw, dt, this.config.maxAngleJumpDeg, this.config.maxAngularVelocityDegPerSec);
    const rightSpike =
      this.movementStarted && rightSmooth.raw != null && isAngleSpike(this.right.lastSpike, rightSmooth.raw, dt, this.config.maxAngleJumpDeg, this.config.maxAngularVelocityDegPerSec);
    const spike = leftSpike || rightSpike;
    const acceptance = evaluateAcceptance({ checks, vis, config: this.config, spike, hardPersistFailed: hardFailed });
    const thumbUp = frame.thumbUp === true || (frame.gestureReady === false && presentedHand(world));
    this.advance({
      now,
      dt,
      leftRaw: leftSmooth.raw,
      leftFiltered: leftSmooth.filtered,
      rightRaw: rightSmooth.raw,
      rightFiltered: rightSmooth.filtered,
      tracking,
      setup,
      hardFailed,
      metrics,
      image,
      world,
      reading,
      thumbUp,
      acceptance,
    });
    this.blockedBy = this.explain(setup, tracking);
    const leftRom = this.sideRom("left", leftSmooth.filtered);
    const rightRom = this.sideRom("right", rightSmooth.filtered);
    const asymmetry = asymmetryOf(leftRom, rightRom);
    const combinedValid = Math.max(leftRom.validArc ?? 0, rightRom.validArc ?? 0) || null;
    const combinedRaw = Math.max(leftRom.rawArc ?? 0, rightRom.rawArc ?? 0) || null;

    return {
      state: this.state,
      instruction: this.instruction(setup, tracking),
      countdownLabel: this.countdownLabel(now),
      romTestMode: this.config.romTestMode,
      captureRemainingMs: this.captureEndsAt == null ? null : Math.max(0, this.captureEndsAt - now),
      thumbProgress: this.config.thumbStableMs <= 0 ? 0 : Math.max(0, Math.min(1, this.thumbFor / this.config.thumbStableMs)),
      thumbSeen: this.thumbSeen,
      canStart: this.readyOpen,
      movementMessage: !this.movementStarted
        ? ""
        : acceptance.rejectReason
          ? acceptance.rejectReason
          : "Movement valid",
      movementValid: acceptance.movementValid,
      trackingBand: acceptance.band,
      trackingScore: Math.round(acceptance.score * 100),
      rejectReason: acceptance.rejectReason,
      leftShoulderVisibility: vis.leftShoulder,
      rightShoulderVisibility: vis.rightShoulder,
      leftElbowVisibility: vis.leftElbow,
      rightElbowVisibility: vis.rightElbow,
      leftWristVisibility: vis.leftWrist,
      rightWristVisibility: vis.rightWrist,
      leftHipVisibility: vis.leftHip,
      rightHipVisibility: vis.rightHip,
      metrics,
      tracking,
      setupChecks: setup,
      checks,
      cameraFacing: facing,
      left: leftRom,
      right: rightRom,
      asymmetryDeg: asymmetry,
      holdProgress: this.captureEndsAt != null && this.config.captureWindowMs > 0 ? Math.max(0, Math.min(1, this.activeFor / this.config.captureWindowMs)) : 0,
      calibrationProgress: this.calibrationProgress(now),
      baselineReady: this.baseline != null,
      calibrationComplete: this.baseline != null,
      assessmentArmed: this.baseline != null && this.result == null && (this.state === "READY" || this.state === "READY_CONFIRMING" || this.movementStarted),
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
      rejectedFrameCount: this.rejectedFrameCount,
      validFrameCount: this.validFrameCount,
      rom: {
        current: combinedValid,
        raw: combinedRaw,
        landmarkSmoothed: smoothedReading?.left.signedRotationDeg ?? null,
        filtered: leftSmooth.filtered,
        active: !this.movementStarted ? null : this.result ? combinedValid : leftSmooth.filtered,
        validPeak: this.movementStarted ? combinedValid : null,
        rawPeak: this.movementStarted ? combinedRaw : null,
        filteredPeak: this.movementStarted ? combinedValid : null,
      },
      direction: "right",
    };
  }

  private advance(input: {
    now: number;
    dt: number;
    leftRaw: number | null;
    leftFiltered: number | null;
    rightRaw: number | null;
    rightFiltered: number | null;
    tracking: TrackingStatus;
    setup: ConstraintCheck[];
    hardFailed: boolean;
    metrics: SRMetrics;
    image: Vec[];
    world: Vec[];
    reading: ShoulderReading | null;
    thumbUp: boolean;
    acceptance: ReturnType<typeof evaluateAcceptance>;
  }): void {
    if (this.result && (this.state === "COMPLETE" || this.state === "INVALID")) return;
    const { now, dt, leftRaw, leftFiltered, rightRaw, rightFiltered, tracking, setup, metrics, image, world, reading, thumbUp, acceptance } = input;
    if (!tracking.present) {
      this.state = "SEARCHING";
      if (!this.config.romTestMode && this.weakFor > this.config.trackingResetMs) {
        this.movementStarted ? this.finish(false, now, "Tracking was lost before the capture window ended.") : this.reset();
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
        if (this.weakFor < this.config.trackingLostMs) {
          this.updatePeaks(leftRaw, leftFiltered, rightRaw, rightFiltered, metrics, acceptance, now);
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
      this.calibrate(now, dt, setup, metrics, image, world, reading);
      return;
    }
    if (this.countdownEndsAt != null) {
      if (now < this.countdownEndsAt) {
        this.state = "COUNTDOWN";
        this.readyOpen = false;
        this.thumbSeen = false;
        if (reading && !armsSettled(reading, this.config) && now >= (this.rotateCueAt ?? 0) - 200) {
          // During the ROTATE cue, arms should be back in goalpost; otherwise wait.
        }
        return;
      }
      if (reading && !armsSettled(reading, this.config)) {
        this.countdownEndsAt = null;
        this.rotateCueAt = null;
        this.armsHold = true;
        this.state = "COUNTDOWN";
        this.readyOpen = false;
        this.thumbSeen = false;
        return;
      }
      this.armsHold = false;
      this.beginMeasuring(now);
      return;
    }
    if (this.armsHold) {
      this.readyOpen = false;
      this.thumbSeen = false;
      this.state = "COUNTDOWN";
      if (!reading || !armsSettled(reading, this.config)) return;
      this.armsHold = false;
      this.note("Arms back to goalpost", now);
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
    this.updatePeaks(leftRaw, leftFiltered, rightRaw, rightFiltered, metrics, acceptance, now);
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
    leftRaw: number | null,
    leftFiltered: number | null,
    rightRaw: number | null,
    rightFiltered: number | null,
    metrics: SRMetrics,
    acceptance: ReturnType<typeof evaluateAcceptance>,
    now: number
  ): void {
    // Gate meaningful movement before counting ROM (prevents jitter completion).
    const leftMag = Math.max(Math.abs(leftFiltered ?? 0), Math.abs(leftRaw ?? 0));
    const rightMag = Math.max(Math.abs(rightFiltered ?? 0), Math.abs(rightRaw ?? 0));
    const moved = Math.max(leftMag, rightMag) >= this.config.minMovementDeg;
    if (!this.movementConfirmed) {
      this.confirmFrames = moved ? this.confirmFrames + 1 : 0;
      if (this.confirmFrames < this.config.movementConfirmFrames) return;
      this.movementConfirmed = true;
      this.note("Movement detected", now);
    }

    if (!acceptance.movementValid || acceptance.rejectReason) {
      this.rejectedFrameCount += 1;
      const reason = acceptance.rejectReason || "Constraint failed";
      this.rejectTallies.set(reason, (this.rejectTallies.get(reason) ?? 0) + 1);
    } else {
      this.validFrameCount += 1;
    }

    this.scoreSum += acceptance.score;
    this.scoreN += 1;
    this.minScore = Math.min(this.minScore, acceptance.score);

    if (metrics.left.abductionDeg != null && metrics.right.abductionDeg != null) {
      this.abdSum.left += metrics.left.abductionDeg;
      this.abdSum.right += metrics.right.abductionDeg;
      this.abdSum.n += 1;
      if (this.baseline) {
        this.abdMaxDev.left = Math.max(this.abdMaxDev.left, Math.abs(metrics.left.abductionDeg - this.baseline.left.abductionDeg));
        this.abdMaxDev.right = Math.max(this.abdMaxDev.right, Math.abs(metrics.right.abductionDeg - this.baseline.right.abductionDeg));
      }
    }
    if (metrics.left.elbowFlexionDeg != null && metrics.right.elbowFlexionDeg != null) {
      this.elbowSum.left += metrics.left.elbowFlexionDeg;
      this.elbowSum.right += metrics.right.elbowFlexionDeg;
      this.elbowSum.n += 1;
      if (this.baseline) {
        this.elbowMaxDev.left = Math.max(this.elbowMaxDev.left, Math.abs(metrics.left.elbowFlexionDeg - this.baseline.left.elbowFlexionDeg));
        this.elbowMaxDev.right = Math.max(this.elbowMaxDev.right, Math.abs(metrics.right.elbowFlexionDeg - this.baseline.right.elbowFlexionDeg));
      }
    }
    if ((metrics.left.shoulderShrugPct ?? 0) >= this.config.shoulderShrugFailPct || (metrics.right.shoulderShrugPct ?? 0) >= this.config.shoulderShrugFailPct) {
      this.shrugEvents += 1;
    }

    this.updateSidePeaks(this.left, leftRaw, leftFiltered, acceptance, now);
    this.updateSidePeaks(this.right, rightRaw, rightFiltered, acceptance, now);

    const leftRom = this.sideRom("left", leftFiltered);
    const rightRom = this.sideRom("right", rightFiltered);
    const rawArc = Math.max(leftRom.rawArc ?? 0, rightRom.rawArc ?? 0);
    const validArc = Math.max(leftRom.validArc ?? 0, rightRom.validArc ?? 0);
    if (rawArc > 0) this.atRaw = compOf(metrics);
    if (validArc > 0 && acceptance.acceptPeak) this.atValid = compOf(metrics);

    const combined = ((leftFiltered ?? 0) + (rightFiltered ?? 0)) / 2;
    if (this.lastCombined != null && this.lastT != null) {
      // velocity tracked for debug
    }
    this.lastCombined = combined;
  }

  private updateSidePeaks(side: SidePeaks, raw: number | null, filtered: number | null, acceptance: ReturnType<typeof evaluateAcceptance>, now: number): void {
    if (raw != null) {
      if (raw > 0 && (side.rawEr == null || raw > side.rawEr)) side.rawEr = raw;
      if (raw < 0 && (side.rawIr == null || -raw > side.rawIr)) side.rawIr = -raw;
      if (!acceptance.rejectReason || acceptance.rejectReason !== "Large landmark jump") side.lastSpike = raw;
    }
    if (filtered != null) {
      if (filtered > 0 && (side.filteredEr == null || filtered > side.filteredEr)) side.filteredEr = filtered;
      if (filtered < 0 && (side.filteredIr == null || -filtered > side.filteredIr)) side.filteredIr = -filtered;
    }
    const sample = raw ?? filtered;
    if (sample == null) return;
    if (acceptance.acceptPeak) {
      if (sample > 0 && (side.validEr == null || sample > side.validEr)) side.validEr = sample;
      if (sample < 0 && (side.validIr == null || -sample > side.validIr)) side.validIr = -sample;
      side.candidateEr = null;
      side.candidateIr = null;
      return;
    }
    if (acceptance.candidateOnly) {
      if (sample > 0) {
        const next = updateCandidate(side.candidateEr, sample, now, this.config.peakPersistMs * 2.5, this.config.peakWindowDeg);
        side.candidateEr = next.candidate;
        if (next.promoted != null && (side.validEr == null || next.promoted > side.validEr)) side.validEr = next.promoted;
      } else if (sample < 0) {
        const next = updateCandidate(side.candidateIr, -sample, now, this.config.peakPersistMs * 2.5, this.config.peakWindowDeg);
        side.candidateIr = next.candidate;
        if (next.promoted != null && (side.validIr == null || next.promoted > side.validIr)) side.validIr = next.promoted;
      }
    }
  }

  private calibrate(now: number, dt: number, setup: ConstraintCheck[], metrics: SRMetrics, image: Vec[], world: Vec[], reading: ShoulderReading | null): void {
    const blocked = setup.some((check) => check.blocking && (check.status === "fail" || check.status === "na"));
    const still = !blocked && reading != null && this.rememberStill(reading, metrics);
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
    this.resetPeaks(this.left);
    this.resetPeaks(this.right);
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
    this.armsHold = false;
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
    this.armsHold = false;
    this.scoreSum = 0;
    this.scoreN = 0;
    this.minScore = 1;
    this.movementStarted = true;
    this.movementConfirmed = false;
    this.confirmFrames = 0;
    this.movementStartedAt = now;
    this.activeFor = 0;
    this.resetPeaks(this.left);
    this.resetPeaks(this.right);
    this.atRaw = null;
    this.atValid = null;
    this.rejectedFrameCount = 0;
    this.validFrameCount = 0;
    this.rejectTallies.clear();
    this.shrugEvents = 0;
    this.abdSum = { left: 0, right: 0, n: 0 };
    this.elbowSum = { left: 0, right: 0, n: 0 };
    this.abdMaxDev = { left: 0, right: 0 };
    this.elbowMaxDev = { left: 0, right: 0 };
    this.state = this.config.romTestMode ? "MEASURING" : "ACTIVE";
    this.note("Rotation started", now);
  }

  private finish(accepted: boolean, now: number, why: string, manual = false): void {
    if (this.result) return;
    const left = this.sideRom("left", this.left.lastFiltered);
    const right = this.sideRom("right", this.right.lastFiltered);
    const validArc = Math.max(left.validArc ?? 0, right.validArc ?? 0);
    const rawArc = Math.max(left.rawArc ?? 0, right.rawArc ?? 0);
    const ok = validArc > 0 || (left.validEr != null || left.validIr != null || right.validEr != null || right.validIr != null);
    this.note(ok ? "Best valid rotation saved" : why, now);
    this.note(ok ? "Assessment complete" : "Assessment stopped", now);
    const failed = [...this.failed];
    const scorePct = this.scoreN > 0 ? Math.round((this.scoreSum / this.scoreN) * 100) : trackingConfidence(1, this.warned.size, failed.length, false);
    const quality = trialQuality(scorePct, ok);
    const rejectedReasons: RejectTally[] = [...this.rejectTallies.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    this.result = {
      version: 1,
      id: `sr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      series: "",
      trialNumber: 0,
      accepted: ok,
      measuredRom: ok ? validArc || null : null,
      rawMaximum: rawArc || null,
      confidence: scorePct,
      holdMs: this.activeFor || null,
      failedConstraints: failed,
      warningEvents: [...this.warned],
      failureEvents: failed,
      events: this.bakedEvents(),
      atValid: this.atValid,
      atRaw: this.atRaw,
      thresholds: {
        shoulderAbductionWarnDeg: this.config.shoulderAbductionWarnDeg,
        shoulderAbductionFailDeg: this.config.shoulderAbductionFailDeg,
        elbowFlexionWarnDeg: this.config.elbowFlexionWarnDeg,
        elbowFlexionFailDeg: this.config.elbowFlexionFailDeg,
        elbowDriftWarnPct: this.config.elbowDriftWarnPct,
        elbowDriftFailPct: this.config.elbowDriftFailPct,
        shoulderShrugWarnPct: this.config.shoulderShrugWarnPct,
        shoulderShrugFailPct: this.config.shoulderShrugFailPct,
        lateralLeanWarnDeg: this.config.lateralLeanWarnDeg,
        lateralLeanFailDeg: this.config.lateralLeanFailDeg,
        forwardLeanWarnDeg: this.config.forwardLeanWarnDeg,
        forwardLeanFailDeg: this.config.forwardLeanFailDeg,
      },
      endChecks: [],
      instruction: ok ? "Capture window complete." : "No valid rotation was captured.",
      preRollMs: 0,
      trialQuality: quality,
      qualityNote: "",
      left,
      right,
      asymmetryDeg: asymmetryOf(left, right),
      startingLeftAbductionDeg: this.baseline?.left.abductionDeg ?? null,
      startingRightAbductionDeg: this.baseline?.right.abductionDeg ?? null,
      startingLeftElbowDeg: this.baseline?.left.elbowFlexionDeg ?? null,
      startingRightElbowDeg: this.baseline?.right.elbowFlexionDeg ?? null,
      avgLeftAbductionDeg: this.abdSum.n ? this.abdSum.left / this.abdSum.n : null,
      avgRightAbductionDeg: this.abdSum.n ? this.abdSum.right / this.abdSum.n : null,
      maxLeftAbductionDevDeg: this.abdMaxDev.left || null,
      maxRightAbductionDevDeg: this.abdMaxDev.right || null,
      avgLeftElbowDeg: this.elbowSum.n ? this.elbowSum.left / this.elbowSum.n : null,
      avgRightElbowDeg: this.elbowSum.n ? this.elbowSum.right / this.elbowSum.n : null,
      maxLeftElbowDevDeg: this.elbowMaxDev.left || null,
      maxRightElbowDevDeg: this.elbowMaxDev.right || null,
      torsoLeanDeg: maxAbs(this.atValid?.lateralLeanDeg ?? null, this.atValid?.forwardLeanDeg ?? null),
      elbowDriftPct: Math.max(this.atValid?.leftElbowDriftPct ?? 0, this.atValid?.rightElbowDriftPct ?? 0) || null,
      shoulderShrugEvents: this.shrugEvents,
      avgTrackingConfidence: scorePct,
      minTrackingConfidence: Math.round(this.minScore * 100),
      rejectedFrameCount: this.rejectedFrameCount,
      rejectedReasons,
      validFrameCount: this.validFrameCount,
      durationMs: Math.round(this.activeFor),
      configSnapshot: {
        shoulderAbductionTargetDeg: this.config.shoulderAbductionTargetDeg,
        elbowFlexionTargetDeg: this.config.elbowFlexionTargetDeg,
        minMovementDeg: this.config.minMovementDeg,
        captureWindowMs: this.config.captureWindowMs,
        thumbStableMs: this.config.thumbStableMs,
        landmarkConfidence: this.config.landmarkConfidence,
      },
    };
    this.state = accepted || manual ? "COMPLETE" : "INVALID";
  }

  private setup(image: Vec[], width: number, height: number, reading: ShoulderReading | null, facing: CameraFacing): ConstraintCheck[] {
    if (!reading) return framingChecks(image, width, height);
    // Ready / thumbs-up / countdown briefly leave the goalpost; do not hard-block those windows.
    // Matching TL Junction: posture that conflicts with the ready gesture is non-blocking here.
    const armBlocking = this.state !== "READY" && this.state !== "READY_CONFIRMING" && this.state !== "COUNTDOWN";
    return [...setupChecks(reading, facing, this.config, armBlocking), ...framingChecks(image, width, height)];
  }

  private metrics(world: Vec[], image: Vec[], reading: ShoulderReading | null, tracking: TrackingStatus): SRMetrics {
    if (!reading || world.length < 33) return { ...EMPTY_METRICS, present: tracking.present };
    return {
      present: true,
      left: {
        abductionDeg: reading.left.abductionDeg,
        elbowFlexionDeg: reading.left.elbowFlexionDeg,
        signedRotationDeg: reading.left.signedRotationDeg,
        elbowHeightDiff: reading.left.elbowHeightDiff,
        elbowDriftPct: reading.left.elbowDriftPct,
        shoulderShrugPct: reading.left.shoulderShrugPct,
        confidence: reading.left.confidence,
      },
      right: {
        abductionDeg: reading.right.abductionDeg,
        elbowFlexionDeg: reading.right.elbowFlexionDeg,
        signedRotationDeg: reading.right.signedRotationDeg,
        elbowHeightDiff: reading.right.elbowHeightDiff,
        elbowDriftPct: reading.right.elbowDriftPct,
        shoulderShrugPct: reading.right.shoulderShrugPct,
        confidence: reading.right.confidence,
      },
      lateralLeanDeg: this.baseline && reading.lateralLeanDeg != null ? reading.lateralLeanDeg - this.baseline.lateral : reading.lateralLeanDeg,
      forwardLeanDeg: this.baseline && reading.forwardLeanDeg != null ? reading.forwardLeanDeg - this.baseline.forward : reading.forwardLeanDeg,
      shoulderTiltDeg: reading.shoulderTiltDeg,
      shoulderHeightDiff: reading.shoulderHeightDiff,
      velocityDegPerSec: this.lastVelocity,
      leftShoulder: world[LM.leftShoulder],
      rightShoulder: world[LM.rightShoulder],
      leftElbow: world[LM.leftElbow],
      rightElbow: world[LM.rightElbow],
      leftWrist: world[LM.leftWrist],
      rightWrist: world[LM.rightWrist],
      leftHip: world[LM.leftHip],
      rightHip: world[LM.rightHip],
      shoulderMid: midpoint(world[LM.leftShoulder], world[LM.rightShoulder]),
      hipMid: midpoint(world[LM.leftHip], world[LM.rightHip]),
      imageLeftShoulder: image[LM.leftShoulder] ?? null,
      imageRightShoulder: image[LM.rightShoulder] ?? null,
      imageLeftElbow: image[LM.leftElbow] ?? null,
      imageRightElbow: image[LM.rightElbow] ?? null,
      imageLeftWrist: image[LM.leftWrist] ?? null,
      imageRightWrist: image[LM.rightWrist] ?? null,
    };
  }

  private buildBaseline(): Baseline | null {
    if (this.calib.length < 4) return null;
    const world = medianPose(this.calib.map((sample) => sample.world));
    const image = medianPose(this.calib.map((sample) => sample.image));
    const left = captureSideBaseline(world, "left");
    const right = captureSideBaseline(world, "right");
    const reading = readShoulder(world, null);
    if (!left || !right || reading.lateralLeanDeg == null || reading.forwardLeanDeg == null) return null;
    const leftHip = world[LM.leftHip];
    const rightHip = world[LM.rightHip];
    return {
      left,
      right,
      midHip: midpoint(leftHip, rightHip),
      leftHip,
      rightHip,
      hipWidth: Math.max(dist3(leftHip, rightHip), 1e-4),
      lateral: reading.lateralLeanDeg,
      forward: reading.forwardLeanDeg,
      imageLeftShoulder: image[LM.leftShoulder],
      imageRightShoulder: image[LM.rightShoulder],
    };
  }

  private rememberStill(reading: ShoulderReading, metrics: SRMetrics): boolean {
    const angle = ((reading.left.signedRotationDeg ?? 0) + (reading.right.signedRotationDeg ?? 0)) / 2;
    const hip = metrics.hipMid;
    if (!hip) return false;
    this.stillAngles.push(angle);
    this.stillHips.push(hip);
    if (this.stillAngles.length > 18) this.stillAngles.shift();
    if (this.stillHips.length > 18) this.stillHips.shift();
    if (this.stillAngles.length < 6) return false;
    if (stdev(this.stillAngles) > this.config.maxCalibrationJitterDeg) return false;
    const span = (key: "x" | "y" | "z") => Math.max(...this.stillHips.map((point) => point[key])) - Math.min(...this.stillHips.map((point) => point[key]));
    const hipWidth = Math.max(dist3(metrics.leftHip ?? hip, metrics.rightHip ?? hip), 1e-4);
    return Math.hypot(span("x"), span("y"), span("z")) / hipWidth <= 0.08;
  }

  private smoothSide(side: SidePeaks, raw: number | null, now: number): { raw: number | null; filtered: number | null } {
    if (raw == null || !Number.isFinite(raw)) return { raw, filtered: side.lastFiltered };
    if (side.lastAccepted != null && Math.abs(raw - side.lastAccepted) > this.config.angleOutlierDeg) {
      side.outlierRun += 1;
      if (side.outlierRun < this.config.reacquireFrames) return { raw, filtered: side.lastFiltered };
    } else side.outlierRun = 0;
    side.lastAccepted = raw;
    let filtered = raw;
    if (this.config.angleFilter === "oneEuro") filtered = side.filter.filter(raw, now, 1);
    else if (this.config.angleFilter === "ema") {
      side.ema = side.ema == null ? raw : side.ema + this.config.angleEmaAlpha * (raw - side.ema);
      filtered = side.ema;
    }
    side.lastFiltered = filtered;
    return { raw, filtered };
  }

  private sideRom(side: Side, current: number | null): SideRom {
    const peaks = side === "left" ? this.left : this.right;
    const rawEr = peaks.rawEr;
    const rawIr = peaks.rawIr;
    const validEr = peaks.validEr;
    const validIr = peaks.validIr;
    return {
      rawEr,
      rawIr,
      validEr,
      validIr,
      rawArc: arcOf(rawEr, rawIr),
      validArc: arcOf(validEr, validIr),
      currentSigned: this.movementStarted || this.baseline ? current : null,
    };
  }

  private tracking(world: Vec[], dt: number): TrackingStatus {
    const min = this.config.landmarkConfidence;
    const soft = Math.max(0.12, min * 0.45);
    const points = landmarkVis(world);
    const shoulders = Math.min(points.leftShoulder, points.rightShoulder);
    const elbows = Math.min(points.leftElbow, points.rightElbow);
    const wrists = Math.min(points.leftWrist, points.rightWrist);
    const hips = Math.min(points.leftHip, points.rightHip);
    const present = shoulders > 0.05 && hips > 0.05;
    const criticalOk = present && shoulders >= soft && elbows >= soft && wrists >= soft && hips >= soft;
    this.weakFor = criticalOk ? 0 : this.weakFor + dt;
    const score = Math.max(0, Math.min(1, shoulders * 0.3 + elbows * 0.25 + wrists * 0.25 + hips * 0.2));
    return {
      present,
      criticalOk,
      score: present ? score : 0,
      absentMs: present ? 0 : this.weakFor,
      criticalBadMs: this.weakFor,
      shoulders,
      elbows,
      wrists,
      hips,
    };
  }

  private referenceLine(image: Vec[]): SRSnapshot["reference"] {
    const base = this.baseline;
    if (!base || image.length < 33) return null;
    return {
      x1: base.imageLeftShoulder.x,
      y1: base.imageLeftShoulder.y,
      x2: base.imageRightShoulder.x,
      y2: base.imageRightShoulder.y,
    };
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
    if (this.armsHold || this.countdownEndsAt == null || this.rotateCueAt == null || now >= this.countdownEndsAt) return null;
    if (now >= this.rotateCueAt) return "ROTATE";
    const third = this.countdownSpan / 3;
    const remain = this.rotateCueAt - now;
    if (third <= 0) return "1";
    if (remain > third * 2) return "3";
    if (remain > third) return "2";
    return "1";
  }

  private explain(setup: ConstraintCheck[], tracking: TrackingStatus): string {
    if (this.state === "SEARCHING" || !tracking.present) return "Waiting for shoulders, elbows, wrists, and hips.";
    if (this.state === "TRACKING_LOST" || !tracking.criticalOk) return "Landmarks dropped. Shoulders, elbows, wrists, and hips must be visible again.";
    if (this.state === "POSITIONING") {
      const failed = setup.find((check) => check.blocking && (check.status === "fail" || check.status === "na"));
      return failed ? failed.message : "Hold the goalpost position. Baseline has not started.";
    }
    if (this.state === "STABLE") return `Hold still. Baseline starts in ${Math.max(0, Math.round(this.config.stableMs - this.stableFor))} ms.`;
    if (this.state === "CALIBRATING") return `Capturing baseline. ${this.calib.length}/${this.config.minCalibrationFrames} frames.`;
    if (this.state === "READY" || this.state === "READY_CONFIRMING") {
      const blocked = setup.find((check) => check.blocking && (check.status === "fail" || check.status === "na"));
      if (blocked) return blocked.message;
      if (this.thumbSeen) return `Thumbs up held ${Math.round(this.thumbFor)}/${this.config.thumbStableMs} ms.`;
      return "Position looks good. Hold a thumbs up for 2 seconds, or say Ready.";
    }
    if (this.armsHold) return "Return both arms to the goalpost position before rotation starts.";
    if (this.state === "COUNTDOWN") return "Countdown. Return to goalpost. Capture starts when it says ROTATE.";
    if (this.state === "ACTIVE" || this.state === "MEASURING") {
      const remain = this.captureEndsAt == null ? null : Math.max(0, this.captureEndsAt - (this.lastT ?? 0));
      const left = remain == null ? "" : ` ${Math.ceil(remain / 100) / 10} s left.`;
      return `Capturing external and internal rotation.${left} Keep the upper arms still.`;
    }
    if (this.state === "COMPLETE") return "Trial stored. Next trial clears this baseline and waits for a new capture.";
    return this.result?.instruction ?? "Trial stopped.";
  }

  private instruction(setup: ConstraintCheck[], tracking: TrackingStatus): string {
    if (this.state === "COMPLETE") {
      const left = this.result?.left.validArc;
      const right = this.result?.right.validArc;
      return this.result?.accepted
        ? `Shoulder Rotation complete. L arc ${left?.toFixed(1) ?? "—"}° · R arc ${right?.toFixed(1) ?? "—"}°.`
        : (this.result?.instruction ?? "Assessment stopped.");
    }
    if (this.state === "INVALID") return this.result?.instruction ?? "Assessment stopped.";
    if (this.state === "TRACKING_LOST" || !tracking.present) return "Tracking lost. Sit so shoulders, elbows, wrists, and hips are visible.";
    if (this.armsHold) return "Return both arms to the goalpost position.";
    if (this.state === "READY") return "Position looks good. Hold 👍 for 2 seconds or say \"Ready\".";
    if (this.state === "READY_CONFIRMING") return "👍 Ready gesture detected — keep holding.";
    if (this.state === "COUNTDOWN") return "Ready! Return to the goalpost position.";
    if (this.state === "ACTIVE" || this.state === "MEASURING") return "ROTATE — external then internal, both sides";
    if (this.state === "CALIBRATING") return "Hold the goalpost position. Arms out, elbows bent, forearms up.";
    if (this.state === "STABLE") return "Hold still. Baseline capture is about to start.";
    const failed = setup.find((check) => check.blocking && check.status === "fail");
    if (failed) return failed.message;
    if (!tracking.criticalOk) return "Shoulders, elbows, wrists, and hips must be visible.";
    return "Hold still. Sit upright in a goalpost position — arms at shoulder height, elbows bent ~90°, forearms up.";
  }

  private note(label: string, now: number): void {
    if (this.eventLog[this.eventLog.length - 1]?.label === label) return;
    this.eventLog.push({ label, at: now });
  }

  private bakedEvents(): SREvent[] {
    const origin = this.movementStartedAt ?? this.calibStartedAt ?? this.eventLog[0]?.at ?? 0;
    return this.eventLog.map((event) => ({ label: event.label, offsetMs: Math.round(event.at - origin) }));
  }

  private clearAttempt(): void {
    this.calib = [];
    this.confirmFrames = 0;
    this.failFor = 0;
    this.movementStarted = false;
    this.movementConfirmed = false;
    this.countdownEndsAt = null;
    this.rotateCueAt = null;
    this.captureEndsAt = null;
    this.countdownSpan = 0;
    this.thumbFor = 0;
    this.thumbSeen = false;
    this.readyOpen = false;
    this.voiceLatch = false;
    this.armsHold = false;
    this.readyFailFor = 0;
    this.scoreSum = 0;
    this.scoreN = 0;
    this.minScore = 1;
    this.activeFor = 0;
    this.movementStartedAt = null;
    this.calibStartedAt = null;
    this.eventLog = [];
    this.result = null;
    this.warned.clear();
    this.failed.clear();
    this.rejectedFrameCount = 0;
    this.validFrameCount = 0;
    this.rejectTallies.clear();
    this.shrugEvents = 0;
    this.atValid = null;
    this.atRaw = null;
  }

  private resetPeaks(side: SidePeaks): void {
    side.rawEr = null;
    side.rawIr = null;
    side.validEr = null;
    side.validIr = null;
    side.filteredEr = null;
    side.filteredIr = null;
    side.candidateEr = null;
    side.candidateIr = null;
    side.lastSpike = null;
    side.filter.reset();
    side.ema = null;
    side.lastFiltered = null;
    side.lastAccepted = null;
    side.outlierRun = 0;
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

function emptyPeaks(): SidePeaks {
  return {
    rawEr: null,
    rawIr: null,
    validEr: null,
    validIr: null,
    filteredEr: null,
    filteredIr: null,
    candidateEr: null,
    candidateIr: null,
    lastSpike: null,
    filter: new OneEuroFilter(3, 0.35),
    ema: null,
    lastFiltered: null,
    lastAccepted: null,
    outlierRun: 0,
  };
}

function compOf(metrics: SRMetrics): CompensationSnapshot {
  return {
    lateralLeanDeg: metrics.lateralLeanDeg,
    forwardLeanDeg: metrics.forwardLeanDeg,
    leftAbductionDeg: metrics.left.abductionDeg,
    rightAbductionDeg: metrics.right.abductionDeg,
    leftElbowFlexionDeg: metrics.left.elbowFlexionDeg,
    rightElbowFlexionDeg: metrics.right.elbowFlexionDeg,
    leftElbowDriftPct: metrics.left.elbowDriftPct,
    rightElbowDriftPct: metrics.right.elbowDriftPct,
    leftShoulderShrugPct: metrics.left.shoulderShrugPct,
    rightShoulderShrugPct: metrics.right.shoulderShrugPct,
    maxElbowDriftPct: Math.max(metrics.left.elbowDriftPct ?? 0, metrics.right.elbowDriftPct ?? 0) || null,
    maxShoulderShrugPct: Math.max(metrics.left.shoulderShrugPct ?? 0, metrics.right.shoulderShrugPct ?? 0) || null,
  };
}

function asymmetryOf(left: SideRom, right: SideRom): number | null {
  if (left.validArc == null || right.validArc == null) return null;
  return Math.abs(left.validArc - right.validArc);
}

function maxAbs(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
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

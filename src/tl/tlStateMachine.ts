import { dist3, median, midpoint, stdev } from "../pose/coordinateNormalization";
import { PoseFilter } from "../pose/landmarkFiltering";
import { OneEuroFilter } from "../pose/oneEuro";
import { LM, type Vec } from "../pose/types";
import { setupChecks, trialChecks } from "./tlCompensation";
import { CAMERA_NOTE, type TLConfig } from "./tlConfig";
import { trackingConfidence } from "./tlQuality";
import {
  captureYaws,
  detectSigns,
  directionalRom,
  leanDegrees,
  mag,
  primaryAngle,
  readRotation,
  sub,
  type FrameSigns,
  type V3,
  type YawBaseline,
} from "./tlRotation";
import type {
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
  algorithms: { shoulderNeutral: null, shoulderVsPelvis: null, worldTorso: null, imageDepth: null },
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
};

export class TLSession {
  private poseFilter: PoseFilter;
  private angleFilter = new OneEuroFilter(1.2, 0.04);
  private ema: number | null = null;
  private lastFiltered: number | null = null;
  private lastAccepted: number | null = null;
  private outlierRun = 0;
  private state: TLStateName = "SEARCHING";
  private baseline: Baseline | null = null;
  private calib: CalSample[] = [];
  private calibStart = 0;
  private stableFor = 0;
  private confirmFor = 0;
  private holdFor = 0;
  private failFor = 0;
  private weakFor = 0;
  private lastRom: number | null = null;
  private lastT: number | null = null;
  private rawPeak: number | null = null;
  private validPeak: number | null = null;
  private atValid: CompensationSnapshot | null = null;
  private atRaw: CompensationSnapshot | null = null;
  private movementStarted = false;
  private rotationStartedAt: number | null = null;
  private calibStartedAt: number | null = null;
  private eventLog: Array<{ label: string; at: number }> = [];
  private result: TLResult | null = null;
  private warned = new Set<string>();
  private failed = new Set<string>();
  private peakNoted = false;
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
    this.config = config;
    this.poseFilter.options = this.filterOptions();
    this.angleFilter.minCutoff = config.angleMinCutoffHz;
    this.angleFilter.beta = config.angleBeta;
  }

  setDirection(direction: RotationDirection): void {
    if (direction === this.direction) return;
    this.direction = direction;
    this.reset();
  }

  reset(): void {
    this.poseFilter.reset();
    this.angleFilter.reset();
    this.ema = null;
    this.lastFiltered = null;
    this.lastAccepted = null;
    this.outlierRun = 0;
    this.state = "SEARCHING";
    this.baseline = null;
    this.clearAttempt();
    this.stableFor = 0;
    this.weakFor = 0;
    this.stillYaws = [];
    this.stillHips = [];
    this.lastRom = null;
    this.lastT = null;
  }

  nextTrial(): void {
    this.clearAttempt();
    this.lastRom = null;
    this.angleFilter.reset();
    this.ema = null;
    this.lastFiltered = null;
    this.lastAccepted = null;
    this.state = this.baseline ? "READY" : "POSITIONING";
  }

  push(frame: { width: number; height: number; image: Vec[]; world: Vec[] }, now: number): TLSnapshot {
    const dt = this.lastT == null ? 0 : Math.max(0, now - this.lastT);
    this.lastT = now;
    this.frameTimes.push(now);
    this.frameTimes = this.frameTimes.filter((t) => now - t < 1000);
    const filtered = frame.world.length >= 33 && frame.image.length >= 33 ? this.poseFilter.apply(frame.image, frame.world, now) : null;
    const image = filtered?.image ?? [];
    const world = filtered?.world ?? [];
    const tracking = this.tracking(world, dt);
    const reading = world.length >= 33 ? readRotation(world, image, this.baseline?.yaws ?? null) : null;
    const signedRaw = reading ? primaryAngle(reading, this.config.algorithm) : null;
    const smoothed = tracking.criticalOk ? this.smooth(signedRaw, now) : { raw: signedRaw, filtered: this.lastFiltered };
    const current = directionalRom(smoothed.filtered, this.direction);
    const velocity = this.velocity(current, dt);
    const metrics = this.metrics(world, reading, velocity, tracking);
    const setup = this.setup(image, frame.width, frame.height, reading, metrics);
    const checks = this.baseline ? trialChecks(this.compInput(metrics), this.config) : [];
    this.observeChecks(checks, now);
    const hardNow = checks.some((check) => check.category === "hard" && check.status === "fail");
    this.failFor = hardNow ? this.failFor + dt : 0;
    const hardFailed = hardNow && this.failFor >= this.config.hardFailPersistMs;
    this.advance({ now, dt, current, velocity, tracking, setup, hardFailed, metrics, image, world });

    return {
      state: this.state,
      instruction: this.instruction(setup, tracking),
      direction: this.direction,
      algorithm: this.config.algorithm,
      metrics,
      tracking,
      setupChecks: setup,
      checks,
      rom: {
        current,
        raw: smoothed.raw == null ? null : directionalRom(smoothed.raw, this.direction),
        filtered: current,
        validPeak: this.validPeak,
        rawPeak: this.rawPeak,
      },
      holdProgress: this.config.holdMs <= 0 ? 0 : Math.max(0, Math.min(1, this.holdFor / this.config.holdMs)),
      calibrationProgress: this.calibrationProgress(now),
      baselineReady: this.baseline != null,
      movementStarted: this.movementStarted,
      hardFailed,
      quality: trackingConfidence(tracking.score, checks.filter((check) => check.status === "warn").length, hardFailed ? 1 : 0, false),
      result: this.result,
      events: this.bakedEvents(),
      imagePose: image,
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
    velocity: number | null;
    tracking: TrackingStatus;
    setup: ConstraintCheck[];
    hardFailed: boolean;
    metrics: TLMetrics;
    image: Vec[];
    world: Vec[];
  }): void {
    if (this.result && (this.state === "COMPLETE" || this.state === "INVALID")) return;
    const { now, dt, current, velocity, tracking, setup, hardFailed, metrics, image, world } = input;
    if (!tracking.present) {
      this.state = "SEARCHING";
      if (this.weakFor > this.config.trackingResetMs) this.movementStarted ? this.finish(false, now, "Tracking was lost before the hold was confirmed.") : this.reset();
      return;
    }
    if (!tracking.criticalOk) {
      if (this.weakFor < this.config.trackingLostMs) return;
      if (this.movementStarted) {
        this.state = "TRACKING_LOST";
        if (this.weakFor > this.config.trackingResetMs) this.finish(false, now, "Tracking was lost before the hold was confirmed.");
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
    if (!this.movementStarted) {
      this.state = "READY";
      this.watchStart(current, velocity, dt, now);
      return;
    }
    if (current != null) {
      if (this.rawPeak == null || current > this.rawPeak) {
        this.rawPeak = current;
        this.atRaw = compOf(metrics);
      }
      if (!hardFailed && (this.validPeak == null || current > this.validPeak)) {
        this.validPeak = current;
        this.atValid = compOf(metrics);
      }
    }
    const nearPeak = current != null && this.rawPeak != null && this.rawPeak - current <= this.config.peakWindowDeg;
    const slow = velocity != null && Math.abs(velocity) <= this.config.peakVelocityDegPerSec;
    const holding = nearPeak && slow && current != null && current >= this.config.minMovementDeg;
    if (!holding) {
      this.holdFor = 0;
      this.state = "ROTATING";
      return;
    }
    this.holdFor += dt;
    this.state = this.holdFor < 400 ? "PEAK" : "HOLD";
    if (!this.peakNoted) {
      this.peakNoted = true;
      this.note(`Peak ROM ${current.toFixed(1)}°`, now);
    }
    if (this.holdFor >= this.config.holdMs) this.finish(true, now, "Hold confirmed.");
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
    this.state = "READY";
    this.note("Calibration complete", now);
  }

  private watchStart(current: number | null, velocity: number | null, dt: number, now: number): void {
    const moving = current != null && velocity != null && current >= this.config.minMovementDeg && velocity >= this.config.minVelocityDegPerSec;
    this.confirmFor = moving ? this.confirmFor + dt : 0;
    if (this.confirmFor < this.config.movementConfirmMs) return;
    this.movementStarted = true;
    this.rotationStartedAt = now;
    this.state = "ROTATING";
    this.note("Rotation started", now);
  }

  private finish(accepted: boolean, now: number, why: string): void {
    if (this.result) return;
    const valid = this.validPeak;
    const ok = accepted && valid != null && valid >= this.config.minMovementDeg;
    this.note(ok ? "Hold confirmed" : why, now);
    this.note(ok ? "Assessment complete" : "Assessment stopped", now);
    const failed = [...this.failed];
    this.result = {
      version: 1,
      id: `tl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      direction: this.direction,
      series: "",
      trialNumber: 0,
      accepted: ok,
      algorithm: this.config.algorithm,
      measuredRom: valid,
      rawMaximum: this.rawPeak,
      confidence: trackingConfidence(1, this.warned.size, failed.length, false),
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
      instruction: ok ? "Hold confirmed." : valid == null ? "No valid rotation was captured before compensation or tracking failed." : why,
      preRollMs: 0,
    };
    this.state = ok ? "COMPLETE" : "INVALID";
  }

  private setup(image: Vec[], width: number, height: number, reading: ReturnType<typeof readRotation> | null, metrics: TLMetrics): ConstraintCheck[] {
    if (this.baseline) return [];
    const upright = maxAbs(metrics.lateralLeanDeg, metrics.forwardLeanDeg);
    const facing = reading?.pelvisYawDeg == null ? null : Math.abs(reading.pelvisYawDeg);
    const square = reading?.shoulderVsPelvisDeg == null ? null : Math.abs(reading.shoulderVsPelvisDeg);
    return [...setupChecks({ ...blankComp(), facingYawDeg: facing, uprightDeg: upright, squareDeg: square, lateralLeanDeg: metrics.lateralLeanDeg, forwardLeanDeg: metrics.forwardLeanDeg }, this.config), ...framingChecks(image, width, height)];
  }

  private metrics(world: Vec[], reading: ReturnType<typeof readRotation> | null, velocity: number | null, tracking: TrackingStatus): TLMetrics {
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
        shoulderNeutral: directionalRom(reading.shoulderNeutralDeg, this.direction),
        shoulderVsPelvis: directionalRom(reading.shoulderVsPelvisDeg, this.direction),
        worldTorso: directionalRom(reading.worldTorsoDeg, this.direction),
        imageDepth: directionalRom(reading.imageDepthDeg, this.direction),
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
    const vis = (index: number) => world[index]?.visibility ?? 0;
    const shoulders = world.length >= 33 ? Math.min(vis(LM.leftShoulder), vis(LM.rightShoulder)) : 0;
    const hips = world.length >= 33 ? Math.min(vis(LM.leftHip), vis(LM.rightHip)) : 0;
    const knees = world.length >= 33 ? Math.min(vis(LM.leftKnee), vis(LM.rightKnee)) : 0;
    const ears = world.length >= 33 ? Math.min(vis(LM.leftEar), vis(LM.rightEar)) : 0;
    const present = shoulders > 0.05 && hips > 0.05;
    const criticalOk = shoulders >= min && hips >= min && knees >= min;
    this.weakFor = criticalOk ? 0 : this.weakFor + dt;
    return {
      present,
      criticalOk,
      score: criticalOk ? Math.max(0, Math.min(1, Math.min(shoulders, hips, knees))) : 0,
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

  private instruction(setup: ConstraintCheck[], tracking: TrackingStatus): string {
    if (this.state === "COMPLETE") return this.result?.accepted ? "Assessment complete. Return to the middle, then start the next trial." : (this.result?.instruction ?? "Assessment stopped.");
    if (this.state === "INVALID") return this.result?.instruction ?? "Assessment stopped.";
    if (this.state === "TRACKING_LOST" || !tracking.present) return "Tracking lost. Sit so both shoulders, both hips, and both knees are visible.";
    if (this.state === "READY") return `Ready. Rotate as far as comfortably possible to your ${this.direction}. No bouncing. No forced rotation.`;
    if (this.state === "ROTATING") return "Keep the pelvis and knees still. Rotate only as far as is comfortable.";
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
    return "Hold still. Feet flat, knees about 90°, arms crossed or a stick across the shoulders.";
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
    this.confirmFor = 0;
    this.holdFor = 0;
    this.failFor = 0;
    this.rawPeak = null;
    this.validPeak = null;
    this.atValid = null;
    this.atRaw = null;
    this.movementStarted = false;
    this.rotationStartedAt = null;
    this.calibStartedAt = null;
    this.eventLog = [];
    this.result = null;
    this.warned.clear();
    this.failed.clear();
    this.peakNoted = false;
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

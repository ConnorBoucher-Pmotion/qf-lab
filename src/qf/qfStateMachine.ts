import { PoseFilter } from "../pose/landmarkFiltering";
import { LM, type Side, type Vec } from "../pose/types";
import { AnglePipeline, type AngleStep } from "./qfAnglePipeline";
import { CalibrationBuffer } from "./qfCalibration";
import { setupMessage, trackingMessage } from "./qfCompensationDetector";
import { PROVISIONAL_QF_CONFIG, type QFConfig } from "./qfConfig";
import { blockingSetupFailures, buildMeasurementChecks, buildSetupChecks, constraintValueMap, hardFailures } from "./qfConstraints";
import { median } from "../pose/coordinateNormalization";
import { emptyMetrics, extractMetrics, sharedPelvisShift, type QFObservation } from "./qfMeasurement";
import { computeAngles, emptyAngles } from "./qfMeasurementEngine";
import { HoldTracker } from "./qfHold";
import { scoreQuality } from "./qfQuality";
import { TrackingMonitor, emptyTracking } from "./qfTracking";
import type {
  CheckStatus,
  ConstraintCheck,
  HoldAnalysis,
  HoldSummary,
  QFBaseline,
  QFMetrics,
  QFResult,
  QFSnapshot,
  QFStateName,
  Stillness,
  TrackingStatus,
} from "./qfTypes";

/**
 * QF session.
 *
 *   SEARCHING → POSITIONING → CALIBRATING → READY → ARMED → MEASURING ⇄ HOLDING → VALIDATING → RESULT
 *                                                                      ⇅
 *                                                               TRACKING_WARNING
 *   READY records the starting angle. ARMED waits for real movement.
 *   The end-range hold does not run until movement has started, so a still
 *   starting pose cannot become the result.
 *   Any active state → INVALID on a sustained hard fail or sustained tracking loss.
 *   RESULT and INVALID latch until nextTrial() or reset().
 *
 * The baseline is kept across trials. It is only dropped when the athlete
 * leaves, the pelvis moves far from the start position, or a hard check fails
 * in READY for `readyRecalibrateMs`.
 */

const START_POSITION_LOST_MS = 1000;
const MIN_CLEAN_FRACTION = 0.7;

const ACTIVE: QFStateName[] = ["MEASURING", "HOLDING", "VALIDATING", "TRACKING_WARNING"];

export class QFSession {
  private config: QFConfig;
  private side: Side;
  private filter: PoseFilter;
  private angles = new AnglePipeline();
  private calibration = new CalibrationBuffer();
  private tracking = new TrackingMonitor();
  private hold = new HoldTracker();

  private state: QFStateName = "SEARCHING";
  private instruction = "Sit facing the camera so your hips, knees and feet are in view.";
  private baseline: QFBaseline | null = null;
  private result: QFResult | null = null;
  private lastSize = { width: 1, height: 1 };

  private setupFailSince: number | null = null;
  private calibrationStillness: Stillness | null = null;
  private hardSince = new Map<string, number>();
  private readyHardSince: number | null = null;
  private lostSince: number | null = null;
  private validateStart: number | null = null;
  private rawMaximum: number | null = null;
  private lastAnalysis: HoldAnalysis | null = null;
  private serial = 0;
  private counters = { rejectedLandmarks: 0, reacquired: 0, angleOutliers: 0 };
  private pelvisSamples: Array<{ t: number; ratio: number }> = [];
  private baselineAngle: number | null = null;
  private readySamples: Array<{ t: number; angle: number }> = [];
  private movementStarted = false;
  private movementAboveSince: number | null = null;
  private angleTrace: Array<{ t: number; angle: number }> = [];
  private angularVelocity: number | null = null;

  constructor(config: QFConfig = PROVISIONAL_QF_CONFIG, side: Side = "right") {
    this.config = config;
    this.side = side;
    this.filter = new PoseFilter(filterOptions(config));
  }

  setConfig(config: QFConfig): void {
    this.config = config;
    this.filter.options = filterOptions(config);
  }

  setSide(side: Side): void {
    if (side === this.side) return;
    this.side = side;
    this.reset();
  }

  reset(): void {
    this.filter.reset();
    this.angles.reset();
    this.tracking.reset();
    this.dropBaseline();
    this.state = "SEARCHING";
    this.instruction = "Sit facing the camera so your hips, knees and feet are in view.";
    this.counters = { rejectedLandmarks: 0, reacquired: 0, angleOutliers: 0 };
  }

  /** Clears the result and keeps the pose calibration. The next trial records its own starting angle. */
  nextTrial(): void {
    this.result = null;
    this.clearAttempt();
    this.resetMovement();
    if (this.baseline) {
      this.state = "READY";
      this.instruction = "Hold starting position.";
    } else {
      this.state = "POSITIONING";
      this.instruction = "Move into starting position.";
    }
  }

  push(obs: QFObservation, tMs: number): QFSnapshot {
    this.lastSize = { width: obs.width, height: obs.height };
    const present = obs.image.length >= 33 && obs.world.length >= 33;
    if (!present) return this.onAbsent(obs, tMs);

    const filtered = this.filter.apply(obs.image, obs.world, tMs);
    this.counters.rejectedLandmarks += filtered.rejected;
    this.counters.reacquired += filtered.reacquired;
    const smooth: QFObservation = { ...obs, image: filtered.image, world: filtered.world };
    const ref = this.baseline?.angleRef ?? null;
    const rawAngles = computeAngles(obs.image, obs.world, this.side, ref);
    const step = this.angles.push(computeAngles(filtered.gatedImage, filtered.gatedWorld, this.side, ref), tMs, this.config);
    this.counters.angleOutliers += step.outliers;

    const tracking = this.tracking.update(filtered.image, obs.width, obs.height, this.side, this.config, tMs);
    const metrics = extractMetrics(smooth, this.side, this.baseline);
    const setupChecks = buildSetupChecks(metrics, tracking, this.config);

    const hadBaseline = this.baseline !== null;
    if (!hadBaseline && this.state !== "RESULT" && this.state !== "INVALID") {
      this.onSetup(setupChecks, filtered.gatedImage, filtered.gatedWorld, step, tMs);
    }
    if (this.baseline) this.applyPelvisTranslation(metrics, filtered.gatedImage, tMs);
    const checks = this.baseline ? buildMeasurementChecks(metrics, this.config, this.baseline.worldFlexionTrusted) : [];

    if (hadBaseline && this.state !== "RESULT" && this.state !== "INVALID") {
      const angle = step.filtered[this.config.primaryMethod];
      this.trackAngle(angle, tMs);
      if (this.state === "READY" || this.state === "ARMED") {
        this.onReady(metrics, checks, tracking, step, tMs);
      } else if (ACTIVE.includes(this.state)) {
        this.onActive(checks, tracking, step, rawAngles[this.config.primaryMethod], tMs);
      } else {
        this.state = "READY";
      }
    }

    return this.snapshot(metrics, tracking, setupChecks, checks, { raw: rawAngles, clean: step.clean, filtered: step.filtered }, smooth.image, obs.image);
  }

  private onAbsent(obs: QFObservation, tMs: number): QFSnapshot {
    const tracking = this.tracking.update(null, obs.width, obs.height, this.side, this.config, tMs);
    if (ACTIVE.includes(this.state)) {
      this.hold.breakRun();
      if (tracking.absentMs >= this.config.trackingLostMs) {
        this.fail("Measurement unavailable — reposition the camera so the whole leg and hips stay in view.", ["tracking-lost"], []);
      } else {
        this.state = "TRACKING_WARNING";
        this.instruction = "Tracking lost; hold still.";
      }
    } else if (this.state !== "RESULT" && this.state !== "INVALID" && tracking.absentMs >= this.config.searchGraceMs) {
      this.dropBaseline();
      this.filter.reset();
      this.angles.reset();
      this.state = "SEARCHING";
      this.instruction = "Sit facing the camera so your hips, knees and feet are in view.";
    }
    const empty = { raw: emptyAngles(), clean: emptyAngles(), filtered: emptyAngles() };
    return this.snapshot(emptyMetrics(), tracking, [], [], empty, [], []);
  }

  private onSetup(setupChecks: ConstraintCheck[], gatedImage: Vec[], gatedWorld: Vec[], step: AngleStep, tMs: number): void {
    const blocking = blockingSetupFailures(setupChecks);
    if (blocking.length > 0) {
      if (this.setupFailSince == null) this.setupFailSince = tMs;
      if (this.state === "CALIBRATING" && tMs - this.setupFailSince < this.config.setupGraceMs) return;
      this.state = "POSITIONING";
      this.instruction = setupMessage(setupChecks, "Move into starting position.");
      this.calibration.reset();
      this.calibrationStillness = null;
      return;
    }
    this.setupFailSince = null;
    const smoothedShank = step.filtered.absolute2d;
    if (smoothedShank == null) return;
    this.state = "CALIBRATING";
    this.calibration.push({ t: tMs, image: gatedImage, world: gatedWorld, smoothedShankDeg: smoothedShank }, this.config);
    const status = this.calibration.isReady(this.side, this.config);
    this.calibrationStillness = status.still;
    if (!status.ready) {
      this.instruction = status.reason ?? "Hold still.";
      return;
    }
    const baseline = this.calibration.finish(this.side, this.lastSize.width, this.lastSize.height);
    if (!baseline) return;
    this.baseline = baseline;
    this.angles.reset();
    this.clearAttempt();
    this.resetMovement();
    this.state = "READY";
    this.instruction = "Hold starting position.";
  }

  private onReady(metrics: QFMetrics, checks: ConstraintCheck[], tracking: TrackingStatus, step: AngleStep, tMs: number): void {
    if ((metrics.pelvisTranslation ?? 0) > this.config.baselineLostHipWidths) {
      if (this.lostSince == null) this.lostSince = tMs;
      if (tMs - this.lostSince >= START_POSITION_LOST_MS) return this.recalibrate("Start position changed; recalibrating. Sit still.");
    } else {
      this.lostSince = null;
    }
    if (!tracking.criticalOk) {
      if (tracking.criticalBadMs >= this.config.trackingLostMs) return this.recalibrate("Tracking lost; reposition so the whole leg is visible.");
      this.instruction = trackingMessage(tracking);
      return;
    }
    const hard = hardFailures(checks);
    if (hard.length > 0) {
      if (this.readyHardSince == null) this.readyHardSince = tMs;
      if (tMs - this.readyHardSince >= this.config.readyRecalibrateMs) return this.recalibrate("Start position changed; recalibrating. Sit still.");
      this.instruction = hard[0].message;
      return;
    }
    this.readyHardSince = null;

    const angle = step.filtered[this.config.primaryMethod];
    if (angle == null) {
      this.instruction = "Selected angle method unavailable in this setup; choose another in Debug.";
      return;
    }
    if (this.baselineAngle == null) {
      this.collectReadyHold(angle, tMs);
      return;
    }
    this.considerMovement(angle, tMs);
  }

  private collectReadyHold(angle: number, tMs: number): void {
    this.state = "READY";
    this.readySamples.push({ t: tMs, angle });
    const cutoff = tMs - this.config.readyHoldMs;
    while (this.readySamples.length > 1 && this.readySamples[0].t < cutoff) this.readySamples.shift();
    const angles = this.readySamples.map((sample) => sample.angle);
    const span = this.readySamples[this.readySamples.length - 1].t - this.readySamples[0].t;
    const range = Math.max(...angles) - Math.min(...angles);
    if (range > this.config.readyHoldToleranceDeg) {
      this.readySamples = [{ t: tMs, angle }];
      this.instruction = "Hold starting position.";
      return;
    }
    if (span < this.config.readyHoldMs * 0.95 || this.readySamples.length < 8) {
      this.instruction = "Hold starting position.";
      return;
    }
    this.baselineAngle = median(angles);
    this.readySamples = [];
    this.movementAboveSince = null;
    this.state = "ARMED";
    this.instruction = "Ready — begin the QF movement.";
  }

  private considerMovement(angle: number, tMs: number): void {
    const baseline = this.baselineAngle ?? angle;
    const excursion = angle - baseline;
    if (excursion < this.config.startMovementDeg) {
      this.movementAboveSince = null;
      this.state = "ARMED";
      this.instruction = excursion <= -this.config.startMovementDeg ? "Move the foot outward, away from the other leg." : "Ready — begin the QF movement.";
      return;
    }
    if (this.angularVelocity != null && this.angularVelocity < -Math.abs(this.config.movementVelocityDegPerSec)) {
      this.movementAboveSince = null;
      this.state = "ARMED";
      this.instruction = "Ready — begin the QF movement.";
      return;
    }
    if (this.movementAboveSince == null) this.movementAboveSince = tMs;
    if (tMs - this.movementAboveSince < this.config.movementConfirmMs) {
      this.state = "ARMED";
      this.instruction = "Ready — begin the QF movement.";
      return;
    }
    this.movementStarted = true;
    this.hold.reset();
    this.validateStart = null;
    this.state = "MEASURING";
    this.instruction = "Continue to your end range.";
  }

  private onActive(checks: ConstraintCheck[], tracking: TrackingStatus, step: AngleStep, rawPrimary: number | null, tMs: number): void {
    const primary = this.config.primaryMethod;
    if (rawPrimary != null) this.rawMaximum = this.rawMaximum == null ? rawPrimary : Math.max(this.rawMaximum, rawPrimary);

    if (!tracking.criticalOk) {
      this.hold.breakRun();
      this.validateStart = null;
      if (tracking.criticalBadMs >= this.config.trackingLostMs) {
        const worst = tracking.groups.find((g) => g.critical && !g.ok);
        this.fail("Measurement unavailable — reposition the camera so the whole leg and hips stay in view.", [`tracking-lost:${worst?.id ?? "critical"}`], checks);
        return;
      }
      this.state = "TRACKING_WARNING";
      this.instruction = trackingMessage(tracking);
      return;
    }

    const persisted = this.persistedHardFailures(checks, tMs);
    if (persisted.length > 0) {
      const first = checks.find((c) => c.id === persisted[0]);
      this.fail(first?.message ?? "Measurement stopped.", persisted, checks);
      return;
    }
    const hard = hardFailures(checks);
    if (hard.length > 0) {
      this.hold.breakRun();
      this.validateStart = null;
      this.state = "MEASURING";
      this.instruction = hard[0].message;
      return;
    }

    const filtered = step.filtered[primary];
    if (filtered == null) {
      this.hold.breakRun();
      this.state = "TRACKING_WARNING";
      this.instruction = "Angle unavailable; hold still.";
      return;
    }
    if (!this.movementStarted) {
      this.state = "ARMED";
      this.instruction = "Ready — begin the QF movement.";
      return;
    }

    const soft: Record<string, CheckStatus> = {};
    for (const check of checks) if (check.category === "soft") soft[check.id] = check.status;
    this.hold.push({ t: tMs, filtered, clean: step.clean, soft });
    const analysis = this.hold.analyze(this.config);
    this.lastAnalysis = analysis;

    const excursion = (analysis.runMedianDeg ?? filtered) - (this.baselineAngle ?? filtered);
    if (!analysis.stable || excursion < this.config.minimumMovementExcursionDeg) {
      this.validateStart = null;
      const settling = analysis.slopeOk && analysis.nearPeak && analysis.runMs > 200 && excursion >= this.config.minimumMovementExcursionDeg;
      this.state = settling ? "HOLDING" : "MEASURING";
      this.instruction = settling
        ? "Hold."
        : !analysis.nearPeak
          ? "Return to your furthest position and hold it."
          : "Continue to your end range.";
      return;
    }

    if (this.state !== "VALIDATING" || this.validateStart == null) {
      this.state = "VALIDATING";
      this.validateStart = tMs;
    }
    this.instruction = "Hold.";
    if (tMs - this.validateStart < this.config.validateMs) return;

    const summary = this.hold.summarize(this.config, primary);
    if (!summary || summary.angles[primary] == null || summary.cleanFraction < MIN_CLEAN_FRACTION) {
      this.hold.breakRun();
      this.validateStart = null;
      this.state = "MEASURING";
      this.instruction = "Too many tracking glitches during the hold; hold again.";
      return;
    }
    this.accept(summary, checks, tracking);
  }

  private accept(summary: HoldSummary, checks: ConstraintCheck[], tracking: TrackingStatus): void {
    if (!this.movementStarted) return;
    const end = summary.angles[this.config.primaryMethod];
    const excursion = end == null || this.baselineAngle == null ? 0 : end - this.baselineAngle;
    if (excursion < this.config.minimumMovementExcursionDeg) return;
    const quality = scoreQuality(checks, tracking, summary);
    this.state = "RESULT";
    this.instruction = "Measurement captured.";
    this.result = this.makeResult(true, summary.angles[this.config.primaryMethod], summary, quality.score, [], checks);
  }

  private fail(instruction: string, failed: string[], checks: ConstraintCheck[]): void {
    this.state = "INVALID";
    this.instruction = instruction;
    this.result = this.makeResult(false, null, this.hold.summarize(this.config, this.config.primaryMethod), 0, failed, checks);
  }

  private makeResult(
    accepted: boolean,
    measuredRom: number | null,
    hold: HoldSummary | null,
    confidence: number,
    failedConstraints: string[],
    checks: ConstraintCheck[]
  ): QFResult {
    this.serial += 1;
    return {
      version: 2,
      id: `${Date.now().toString(36)}-${this.serial}-${this.side}`,
      timestamp: new Date().toISOString(),
      side: this.side,
      series: "",
      trialNumber: 0,
      accepted,
      primaryMethod: this.config.primaryMethod,
      measuredRom,
      angles: hold?.angles ?? emptyAngles(),
      hold,
      rawMaximum: this.rawMaximum,
      confidence,
      failedConstraints,
      camera: this.baseline?.camera ?? null,
      baseline: this.baseline,
      constraintValues: constraintValueMap(checks),
      thresholds: { ...this.config },
      instruction: this.instruction,
    };
  }

  private persistedHardFailures(checks: ConstraintCheck[], tMs: number): string[] {
    const failing = new Set(hardFailures(checks).map((c) => c.id));
    for (const id of [...this.hardSince.keys()]) if (!failing.has(id)) this.hardSince.delete(id);
    const persisted: string[] = [];
    for (const id of failing) {
      if (!this.hardSince.has(id)) this.hardSince.set(id, tMs);
      if (tMs - (this.hardSince.get(id) ?? tMs) >= this.config.hardFailPersistMs) persisted.push(id);
    }
    return persisted;
  }

  private recalibrate(message: string): void {
    this.dropBaseline();
    this.angles.reset();
    this.state = "POSITIONING";
    this.instruction = message;
  }

  private applyPelvisTranslation(metrics: QFMetrics, gatedImage: Vec[], tMs: number): void {
    const baseline = this.baseline;
    if (!baseline || gatedImage.length < 33) return;
    const shared = sharedPelvisShift(gatedImage[LM.leftHip], gatedImage[LM.rightHip], baseline);
    metrics.pelvisTranslationRaw = shared.ratio;
    metrics.pelvisShiftPx = shared.pixels;
    metrics.pelvisCenter = shared.center;
    const windowMs = this.config.pelvisTranslationWindowMs;
    if (windowMs <= 0) {
      metrics.pelvisTranslation = shared.ratio;
      return;
    }
    this.pelvisSamples.push({ t: tMs, ratio: shared.ratio });
    const cutoff = tMs - windowMs;
    while (this.pelvisSamples.length > 1 && this.pelvisSamples[0].t < cutoff) this.pelvisSamples.shift();
    metrics.pelvisTranslation = median(this.pelvisSamples.map((sample) => sample.ratio));
  }

  private trackAngle(angle: number | null, tMs: number): void {
    if (angle == null || !Number.isFinite(angle)) {
      this.angularVelocity = null;
      return;
    }
    this.angleTrace.push({ t: tMs, angle });
    const cutoff = tMs - 400;
    while (this.angleTrace.length > 1 && this.angleTrace[0].t < cutoff) this.angleTrace.shift();
    const last = this.angleTrace[this.angleTrace.length - 1];
    let prev = this.angleTrace[0];
    for (let i = this.angleTrace.length - 2; i >= 0; i -= 1) {
      if (last.t - this.angleTrace[i].t >= 100) {
        prev = this.angleTrace[i];
        break;
      }
    }
    const dt = (last.t - prev.t) / 1000;
    this.angularVelocity = dt >= 0.05 ? (last.angle - prev.angle) / dt : null;
  }

  private resetMovement(): void {
    this.baselineAngle = null;
    this.readySamples = [];
    this.movementStarted = false;
    this.movementAboveSince = null;
    this.angleTrace = [];
    this.angularVelocity = null;
  }

  private dropBaseline(): void {
    this.baseline = null;
    this.pelvisSamples = [];
    this.resetMovement();
    this.result = null;
    this.calibration.reset();
    this.calibrationStillness = null;
    this.setupFailSince = null;
    this.readyHardSince = null;
    this.lostSince = null;
    this.clearAttempt();
  }

  private clearAttempt(): void {
    this.hold.reset();
    this.hardSince.clear();
    this.validateStart = null;
    this.rawMaximum = null;
    this.lastAnalysis = null;
  }

  private snapshot(
    metrics: QFMetrics,
    tracking: TrackingStatus,
    setupChecks: ConstraintCheck[],
    checks: ConstraintCheck[],
    angles: QFSnapshot["angles"],
    imagePose: Vec[],
    rawPose: Vec[]
  ): QFSnapshot {
    const primary = this.config.primaryMethod;
    const quality = scoreQuality(checks, tracking.present ? tracking : emptyTracking());
    const holdVisible = this.state === "HOLDING" || this.state === "VALIDATING";
    const invalid = this.state === "INVALID";
    return {
      state: this.state,
      instruction: this.instruction,
      side: this.side,
      primaryMethod: primary,
      metrics,
      tracking,
      setupChecks,
      checks,
      angles,
      primary: {
        raw: angles.raw[primary],
        filtered: angles.filtered[primary],
        stable: holdVisible ? (this.lastAnalysis?.runMedianDeg ?? null) : null,
        final: this.result?.measuredRom ?? null,
      },
      hold: ACTIVE.includes(this.state) || this.state === "RESULT" ? this.lastAnalysis : null,
      baseline: this.baseline,
      result: this.result,
      quality: invalid ? 0 : this.state === "RESULT" && this.result ? this.result.confidence : quality.score,
      hardFailed: invalid || quality.hardFailed,
      calibrationProgress: this.baseline ? 1 : this.calibration.progress(this.side, this.config),
      calibrationStillness: this.calibrationStillness,
      imagePose,
      rawPose,
      filterStats: { ...this.counters },
      movement: this.movementSnapshot(),
    };
  }

  private movementSnapshot(): QFSnapshot["movement"] {
    const angle = this.angleTrace.length ? this.angleTrace[this.angleTrace.length - 1].angle : null;
    return {
      baselineDeg: this.baselineAngle,
      excursionDeg: this.baselineAngle == null || angle == null ? null : angle - this.baselineAngle,
      velocityDegPerSec: this.angularVelocity,
      started: this.movementStarted,
    };
  }
}

function filterOptions(config: QFConfig) {
  return {
    minCutoffHz: config.landmarkMinCutoffHz,
    beta: config.landmarkBeta,
    outlierJumpHipWidths: config.outlierJumpHipWidths,
    reacquireFrames: config.reacquireFrames,
  };
}

export { emptyMetrics };

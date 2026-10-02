import { angleDelta, dist2, dist3, median, midpoint, stdev } from "../pose/coordinateNormalization";
import { LM, jointIndex, otherSide, type Side, type Vec } from "../pose/types";
import type { QFConfig } from "./qfConfig";
import { buildAngleReference, hangValues, hipLineTiltDeg, shankLateralDeg } from "./qfMeasurementEngine";
import { angleFromDownDeg, angleFromUpDeg, kneeFlexionDeg, pairYawDeg } from "./qfMeasurement";
import type { QFBaseline, Stillness } from "./qfTypes";

/**
 * "Hold still" calibration.
 *
 * Frames are kept over a sliding window of `calibrationMs`. Calibration
 * completes as soon as the window is full and still:
 *   - SD of the smoothed shank angle ≤ maxCalibrationAngleSdDeg
 *   - scatter of mid-hip, knee, ankle ≤ maxCalibrationPelvisJitter (body units)
 * A movement just slides the window on; it does not restart from zero.
 * The baseline is built from the per-landmark median of the gated (unsmoothed,
 * spike-rejected) poses in the window, so one bad frame cannot shift it.
 */

type CalFrame = {
  t: number;
  image: Vec[];
  world: Vec[];
  smoothedShankDeg: number;
};

export class CalibrationBuffer {
  private frames: CalFrame[] = [];

  reset(): void {
    this.frames = [];
  }

  get size(): number {
    return this.frames.length;
  }

  push(frame: CalFrame, config: QFConfig): void {
    const last = this.frames[this.frames.length - 1];
    if (last && frame.t - last.t > config.setupGraceMs) this.frames = [];
    this.frames.push(frame);
    const cutoff = frame.t - config.calibrationMs;
    while (this.frames.length > 1 && this.frames[0].t < cutoff) this.frames.shift();
  }

  stillness(side: Side): Stillness | null {
    if (this.frames.length < 2) return null;
    const hipWidth = median(this.frames.map((f) => dist2(f.image[LM.leftHip], f.image[LM.rightHip])));
    const shankLen = median(this.frames.map((f) => dist2(f.image[jointIndex(side, "knee")], f.image[jointIndex(side, "ankle")])));
    const scatter = (points: Vec[], scale: number) => (scale > 0 ? Math.hypot(stdev(points.map((p) => p.x)), stdev(points.map((p) => p.y))) / scale : 0);
    return {
      shankSdDeg: stdev(this.frames.map((f) => f.smoothedShankDeg)),
      pelvisJitter: scatter(this.frames.map((f) => midpoint(f.image[LM.leftHip], f.image[LM.rightHip])), hipWidth),
      kneeJitter: scatter(this.frames.map((f) => f.image[jointIndex(side, "knee")]), shankLen),
      ankleJitter: scatter(this.frames.map((f) => f.image[jointIndex(side, "ankle")]), shankLen),
      frames: this.frames.length,
      spanMs: this.frames[this.frames.length - 1].t - this.frames[0].t,
    };
  }

  /** 0–1 fill of the window; stillness failures hold it below 1. */
  progress(side: Side, config: QFConfig): number {
    const still = this.stillness(side);
    if (!still) return 0;
    const fill = Math.min(still.spanMs / config.calibrationMs, still.frames / config.minCalibrationFrames);
    return Math.max(0, Math.min(1, fill));
  }

  isReady(side: Side, config: QFConfig): { ready: boolean; still: Stillness | null; reason: string | null } {
    const still = this.stillness(side);
    if (!still) return { ready: false, still, reason: null };
    if (still.spanMs < config.calibrationMs * 0.95 || still.frames < config.minCalibrationFrames) return { ready: false, still, reason: null };
    if (still.shankSdDeg > config.maxCalibrationAngleSdDeg) return { ready: false, still, reason: "Lower leg moving; let it hang still." };
    const jitter = Math.max(still.pelvisJitter, still.kneeJitter, still.ankleJitter);
    if (jitter > config.maxCalibrationPelvisJitter) return { ready: false, still, reason: "Hold still for a moment." };
    return { ready: true, still, reason: null };
  }

  finish(side: Side, width: number, height: number): QFBaseline | null {
    const still = this.stillness(side);
    if (!still || this.frames.length < 2) return null;
    const image = medianPose(this.frames.map((f) => f.image));
    const world = medianPose(this.frames.map((f) => f.world));
    const hang = { absolute: [] as number[], pelvis: [] as number[] };
    for (const frame of this.frames) {
      const values = hangValues(frame.image, side);
      if (values) {
        hang.absolute.push(values.absolute);
        hang.pelvis.push(values.pelvis);
      }
    }

    const hipIdx = jointIndex(side, "hip");
    const kneeIdx = jointIndex(side, "knee");
    const ankleIdx = jointIndex(side, "ankle");
    const lH = image[LM.leftHip];
    const rH = image[LM.rightHip];
    const midHip = midpoint(lH, rH);
    const midShoulder = midpoint(image[LM.leftShoulder], image[LM.rightShoulder]);
    const shouldersSeen = Math.min(image[LM.leftShoulder].visibility, image[LM.rightShoulder].visibility) >= 0.2;

    const flexions = this.frames
      .map((f) => kneeFlexionDeg(f.world[hipIdx], f.world[kneeIdx], f.world[ankleIdx]))
      .filter((v): v is number => v != null);
    const flexion = flexions.length ? median(flexions) : null;
    // A seated 90° knee that world landmarks report far from 90°, or that wobbles, can't be used to detect knee extension.
    const worldFlexionTrusted = flexion != null && flexion > 50 && flexion < 130 && stdev(flexions) < 6;

    const angleRef = buildAngleReference(hang, image, world, side);
    const shankLenPx = dist2(image[kneeIdx], image[ankleIdx]);
    const absoluteHang = shankLateralDeg(image[kneeIdx], image[ankleIdx], side);

    return {
      frameCount: this.frames.length,
      durationMs: still.spanMs,
      stability: still,
      hipWidthPx: dist2(lH, rH),
      shankLenPx,
      torsoLenPx: shouldersSeen ? dist2(midHip, midShoulder) : null,
      pelvisTiltDeg: median(this.frames.map((f) => hipLineTiltDeg(f.image[LM.leftHip], f.image[LM.rightHip]))),
      pelvisYawDeg: pairYawDeg(world[LM.leftHip], world[LM.rightHip]),
      torsoLeanDeg: shouldersSeen ? angleFromUpDeg(midHip, midShoulder) : null,
      torsoYawDeg: shouldersSeen ? pairYawDeg(world[LM.leftShoulder], world[LM.rightShoulder]) : null,
      femurImageDeg: angleFromDownDeg(image[hipIdx], image[kneeIdx]),
      worldShankDepth: world[ankleIdx].z - world[kneeIdx].z,
      worldShankLen: dist3(world[kneeIdx], world[ankleIdx]),
      worldKneeFlexionDeg: flexion,
      worldFlexionTrusted,
      midHip,
      leftHip: lH,
      rightHip: rH,
      testedHip: image[hipIdx],
      testedKnee: image[kneeIdx],
      testedAnkle: image[ankleIdx],
      otherKnee: image[jointIndex(otherSide(side), "knee")],
      angleRef,
      camera: {
        rollProxyDeg: hipLineTiltDeg(lH, rH),
        torsoFromVerticalDeg: shouldersSeen ? angleFromUpDeg(midHip, midShoulder) : null,
        facingYawDeg: Math.abs(pairYawDeg(world[LM.leftHip], world[LM.rightHip])),
        pitchProxy: shankLenPx > 0 ? dist2(image[hipIdx], image[kneeIdx]) / shankLenPx : 0,
        distanceProxy: shankLenPx / height,
        bodyX: midHip.x / width,
        bodyY: midHip.y / height,
        hangAbsoluteDeg: angleDelta(absoluteHang, 0),
        femurElevationDeg: angleRef.femurElevationDeg,
        femurAzimuthDeg: angleRef.femurAzimuthDeg,
      },
      confidence: {
        knee: image[kneeIdx].visibility,
        ankle: image[ankleIdx].visibility,
        hips: Math.min(lH.visibility, rH.visibility),
        shoulders: Math.min(image[LM.leftShoulder].visibility, image[LM.rightShoulder].visibility),
      },
    };
  }
}

export function medianPose(poses: Vec[][]): Vec[] {
  const count = Math.min(...poses.map((p) => p.length));
  const out: Vec[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: median(poses.map((p) => p[i].x)),
      y: median(poses.map((p) => p[i].y)),
      z: median(poses.map((p) => p[i].z)),
      visibility: median(poses.map((p) => p[i].visibility)),
    });
  }
  return out;
}

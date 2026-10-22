import type { ObliqueConfig } from "./config";
import { copyVec, dist, extractLandmarks, vis } from "./landmarks";
import {
  angleDelta,
  hipMidOf,
  hipVector,
  shoulderMidOf,
  shoulderVector,
  shoulderWidthOf,
  subjectHorizontalYawDeg,
  thoracicRelativeYawDeg,
  torsoCenterOf,
} from "./vectors";
import type { LandmarkSample, ObliqueBaseline, ObliqueCameraMode } from "./types";
import type { Vec } from "../pose/types";

type Acc = {
  n: number;
  leftShoulder: Vec;
  rightShoulder: Vec;
  leftHip: Vec;
  rightHip: Vec;
  leftElbow: Vec;
  rightElbow: Vec;
  leftEar: Vec;
  rightEar: Vec;
  nose: Vec;
};

/** Collect 0.5–1 s of stable neutral frames, then seal a subject-specific baseline. */
export class BaselineCollector {
  private acc: Acc | null = null;
  private stableFor = 0;

  reset(): void {
    this.acc = null;
    this.stableFor = 0;
  }

  progress(config: ObliqueConfig): number {
    if (this.acc && this.acc.n >= config.minCalibrationFrames && this.stableFor >= config.calibrationMs) return 1;
    const still = Math.min(1, this.stableFor / Math.max(1, config.stableMs));
    const calib = this.acc ? Math.min(1, this.acc.n / config.minCalibrationFrames) : 0;
    return Math.min(1, still * 0.4 + calib * 0.6);
  }

  /**
   * Returns a finished baseline when enough stable frames are averaged.
   * Otherwise returns null and keeps accumulating.
   */
  push(world: Vec[], dtMs: number, config: ObliqueConfig, cameraMode: ObliqueCameraMode): ObliqueBaseline | null {
    const sample = extractLandmarks(world);
    if (!sample || !isStableSample(sample, config)) {
      this.stableFor = 0;
      this.acc = null;
      return null;
    }
    this.stableFor += dtMs;
    if (this.stableFor < config.stableMs) return null;

    if (!this.acc) {
      this.acc = {
        n: 1,
        leftShoulder: copyVec(sample.leftShoulder),
        rightShoulder: copyVec(sample.rightShoulder),
        leftHip: copyVec(sample.leftHip),
        rightHip: copyVec(sample.rightHip),
        leftElbow: copyVec(sample.leftElbow),
        rightElbow: copyVec(sample.rightElbow),
        leftEar: copyVec(sample.leftEar),
        rightEar: copyVec(sample.rightEar),
        nose: copyVec(sample.nose),
      };
      return null;
    }

    const a = this.acc;
    a.n += 1;
    avgIn(a.leftShoulder, sample.leftShoulder, a.n);
    avgIn(a.rightShoulder, sample.rightShoulder, a.n);
    avgIn(a.leftHip, sample.leftHip, a.n);
    avgIn(a.rightHip, sample.rightHip, a.n);
    avgIn(a.leftElbow, sample.leftElbow, a.n);
    avgIn(a.rightElbow, sample.rightElbow, a.n);
    avgIn(a.leftEar, sample.leftEar, a.n);
    avgIn(a.rightEar, sample.rightEar, a.n);
    avgIn(a.nose, sample.nose, a.n);

    if (a.n < config.minCalibrationFrames || this.stableFor < config.stableMs + config.calibrationMs) return null;
    return seal(a, cameraMode);
  }
}

function isStableSample(sample: LandmarkSample, config: ObliqueConfig): boolean {
  const min = config.landmarkConfidence;
  return (
    vis(sample.leftShoulder) >= min &&
    vis(sample.rightShoulder) >= min &&
    vis(sample.leftHip) >= min &&
    vis(sample.rightHip) >= min
  );
}

function avgIn(target: Vec, sample: Vec, n: number): void {
  const w = 1 / n;
  target.x += (sample.x - target.x) * w;
  target.y += (sample.y - target.y) * w;
  target.z += (sample.z - target.z) * w;
  target.visibility += ((sample.visibility ?? 1) - (target.visibility ?? 1)) * w;
}

function seal(a: Acc, cameraMode: ObliqueCameraMode): ObliqueBaseline {
  const sample: LandmarkSample = {
    leftShoulder: a.leftShoulder,
    rightShoulder: a.rightShoulder,
    leftHip: a.leftHip,
    rightHip: a.rightHip,
    leftElbow: a.leftElbow,
    rightElbow: a.rightElbow,
    leftEar: a.leftEar,
    rightEar: a.rightEar,
    nose: a.nose,
  };
  const sVec = shoulderVector(sample);
  const hVec = hipVector(sample);
  const relative = thoracicRelativeYawDeg(sVec, hVec) ?? 0;
  const shoulderYaw = subjectHorizontalYawDeg(sVec) ?? 0;
  const pelvisYaw = subjectHorizontalYawDeg(hVec) ?? 0;
  return {
    cameraMode,
    frames: a.n,
    leftShoulder: copyVec(a.leftShoulder),
    rightShoulder: copyVec(a.rightShoulder),
    leftHip: copyVec(a.leftHip),
    rightHip: copyVec(a.rightHip),
    leftElbow: copyVec(a.leftElbow),
    rightElbow: copyVec(a.rightElbow),
    leftEar: copyVec(a.leftEar),
    rightEar: copyVec(a.rightEar),
    nose: copyVec(a.nose),
    shoulderVector: sVec,
    hipVector: hVec,
    shoulderMid: shoulderMidOf(sample),
    hipMid: hipMidOf(sample),
    torsoCenter: torsoCenterOf(sample),
    relativeYawDeg: relative,
    shoulderYawDeg: shoulderYaw,
    pelvisYawDeg: pelvisYaw,
    shoulderWidth: shoulderWidthOf(sample),
    leftShoulderToEar: dist(a.leftShoulder, a.leftEar),
    rightShoulderToEar: dist(a.rightShoulder, a.rightEar),
    leftShoulderToNose: dist(a.leftShoulder, a.nose),
    rightShoulderToNose: dist(a.rightShoulder, a.nose),
  };
}

export function baselineDriftDeg(liveRelative: number, baseline: ObliqueBaseline): number {
  return Math.abs(angleDelta(liveRelative, baseline.relativeYawDeg));
}

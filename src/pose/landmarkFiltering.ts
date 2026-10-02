import { OneEuroFilter } from "./oneEuro";
import { dist2, dist3, median } from "./coordinateNormalization";
import { LM, type Vec } from "./types";

export type PoseFilterOptions = {
  minCutoffHz: number;
  beta: number;
  /** A one-frame move larger than this many hip widths is treated as a MediaPipe spike. */
  outlierJumpHipWidths: number;
  /** A "spike" that persists this many frames is real motion and is accepted. */
  reacquireFrames: number;
};

export type FilteredPose = {
  /** One Euro smoothed. `visibility` is the temporally smoothed confidence. */
  image: Vec[];
  world: Vec[];
  /** Unsmoothed, with single-frame spikes replaced by the last accepted point. */
  gatedImage: Vec[];
  gatedWorld: Vec[];
  rejected: number;
  reacquired: number;
};

type Channel = {
  fx: OneEuroFilter;
  fy: OneEuroFilter;
  fz: OneEuroFilter;
  accepted: Vec | null;
  output: Vec | null;
  rejectedRun: number;
  visibility: number | null;
};

const VISIBILITY_ALPHA = 0.3;
const RESET_GAP_MS = 500;
const SCALE_HISTORY = 31;

/**
 * Landmark pipeline: spike gate with re-acquire, then One Euro smoothing.
 *
 * The gate compares against the last accepted raw point, not the held one, and
 * a jump that persists is accepted. The old filter compared against the held
 * point forever, so a single bad re-detection could freeze a landmark.
 */
export class PoseFilter {
  private imageChannels: Channel[] = [];
  private worldChannels: Channel[] = [];
  private hipWidths: number[] = [];
  private worldHipWidths: number[] = [];
  private lastT: number | null = null;

  constructor(public options: PoseFilterOptions) {}

  reset(): void {
    this.imageChannels = [];
    this.worldChannels = [];
    this.hipWidths = [];
    this.worldHipWidths = [];
    this.lastT = null;
  }

  apply(image: Vec[], world: Vec[], tMs: number): FilteredPose {
    if (this.lastT != null && tMs - this.lastT > RESET_GAP_MS) this.reset();
    this.lastT = tMs;
    const imageScale = robustScale(this.hipWidths, hipWidth2d(image), 80);
    const worldScale = robustScale(this.worldHipWidths, hipWidth3d(world), 0.2);
    const img = this.run(this.imageChannels, image, tMs, imageScale, false);
    const wld = this.run(this.worldChannels, world, tMs, worldScale, true);
    return {
      image: img.smoothed,
      world: wld.smoothed,
      gatedImage: img.gated,
      gatedWorld: wld.gated,
      rejected: img.rejected + wld.rejected,
      reacquired: img.reacquired + wld.reacquired,
    };
  }

  private run(channels: Channel[], points: Vec[], tMs: number, scale: number, useZ: boolean) {
    const { minCutoffHz, beta, outlierJumpHipWidths, reacquireFrames } = this.options;
    const limit = outlierJumpHipWidths * scale;
    const smoothed: Vec[] = [];
    const gated: Vec[] = [];
    let rejected = 0;
    let reacquired = 0;

    points.forEach((point, index) => {
      let channel = channels[index];
      if (!channel) {
        channel = newChannel(minCutoffHz, beta);
        channels[index] = channel;
      }
      for (const f of [channel.fx, channel.fy, channel.fz]) {
        f.minCutoff = minCutoffHz;
        f.beta = beta;
      }
      channel.visibility =
        channel.visibility == null ? point.visibility : channel.visibility + (point.visibility - channel.visibility) * VISIBILITY_ALPHA;

      let accept = true;
      if (channel.accepted) {
        const jump = useZ ? dist3(point, channel.accepted) : dist2(point, channel.accepted);
        if (jump > limit) {
          channel.rejectedRun += 1;
          if (channel.rejectedRun < reacquireFrames) {
            accept = false;
          } else {
            channel.rejectedRun = 0;
            reacquired += 1;
            channel.fx.reset();
            channel.fy.reset();
            channel.fz.reset();
          }
        } else {
          channel.rejectedRun = 0;
        }
      }

      const visibility = channel.visibility;
      if (!accept && channel.accepted && channel.output) {
        rejected += 1;
        gated.push({ ...channel.accepted, visibility, held: true });
        smoothed.push({ ...channel.output, visibility, held: true });
        return;
      }

      channel.accepted = { ...point };
      const out: Vec = {
        x: channel.fx.filter(point.x, tMs, scale),
        y: channel.fy.filter(point.y, tMs, scale),
        z: channel.fz.filter(point.z, tMs, scale),
        visibility,
        held: false,
      };
      channel.output = out;
      gated.push({ ...point, visibility, held: false });
      smoothed.push(out);
    });

    return { smoothed, gated, rejected, reacquired };
  }
}

function newChannel(minCutoffHz: number, beta: number): Channel {
  return {
    fx: new OneEuroFilter(minCutoffHz, beta),
    fy: new OneEuroFilter(minCutoffHz, beta),
    fz: new OneEuroFilter(minCutoffHz, beta),
    accepted: null,
    output: null,
    rejectedRun: 0,
    visibility: null,
  };
}

function robustScale(history: number[], current: number, fallback: number): number {
  if (current > 0 && Number.isFinite(current)) {
    history.push(current);
    if (history.length > SCALE_HISTORY) history.shift();
  }
  return history.length > 0 ? median(history) : fallback;
}

function hipWidth2d(points: Vec[]): number {
  if (points.length < 25) return 0;
  return dist2(points[LM.leftHip], points[LM.rightHip]);
}

function hipWidth3d(points: Vec[]): number {
  if (points.length < 25) return 0;
  return dist3(points[LM.leftHip], points[LM.rightHip]);
}

import type { ObliqueConfig } from "./config";

/** Light EMA for filtered ROM. Does not invent peaks. */
export class AngleSmoother {
  private value: number | null = null;

  reset(): void {
    this.value = null;
  }

  push(raw: number | null, config: ObliqueConfig): number | null {
    if (raw == null || !Number.isFinite(raw)) return this.value;
    if (this.value == null) {
      this.value = raw;
      return raw;
    }
    this.value += config.angleEmaAlpha * (raw - this.value);
    return this.value;
  }

  current(): number | null {
    return this.value;
  }
}

export function isSpike(previous: number | null, next: number, dtMs: number, config: ObliqueConfig): boolean {
  if (previous == null || !Number.isFinite(next)) return false;
  const delta = Math.abs(next - previous);
  if (delta > config.maxAngleJumpDeg) return true;
  if (dtMs > 0 && (delta * 1000) / dtMs > config.maxAngularVelocityDegPerSec) return true;
  return false;
}

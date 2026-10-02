/**
 * One Euro filter (Casiez, Roussel, Vogel 2012).
 * Still signal: low cutoff, so jitter is removed.
 * Moving signal: the cutoff rises with speed, so lag stays small.
 *
 * `derivativeScale` lets one beta work across units. Landmarks pass their
 * body scale (hip width), so beta is per hip-width-per-second.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(
    public minCutoff: number,
    public beta: number,
    public dCutoff = 1
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }

  get value(): number | null {
    return this.x;
  }

  filter(value: number, tMs: number, derivativeScale = 1): number {
    if (this.x == null || this.lastT == null) {
      this.x = value;
      this.dx = 0;
      this.lastT = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.lastT) / 1000);
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += smoothing(dt, this.dCutoff) * (rawDx - this.dx);
    const speed = Math.abs(this.dx) / Math.max(1e-9, derivativeScale);
    const cutoff = Math.max(1e-3, this.minCutoff + this.beta * speed);
    this.x += smoothing(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

function smoothing(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

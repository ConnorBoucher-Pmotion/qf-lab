import type { TLSnapshot } from "../tl/tlTypes";

export function QualityIndicator({ snapshot }: { snapshot: TLSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const show = snapshot != null && ["ROTATING", "PEAK", "HOLD", "TRACKING_LOST", "COMPLETE", "INVALID"].includes(state);
  const meter = state === "CALIBRATING" || state === "STABLE" ? (snapshot?.calibrationProgress ?? 0) : state === "PEAK" || state === "HOLD" ? (snapshot?.holdProgress ?? 0) : 0;
  const direction = snapshot?.direction === "left" ? "Left rotation" : "Right rotation";
  return (
    <section className="live-rom">
      <p className="kicker">TL Junction · {direction}</p>
      <p className="angle">{show && snapshot?.rom.filtered != null ? snapshot.rom.filtered.toFixed(1) : "—.—"}</p>
      <p className="angle-unit">current rotation, degrees</p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${Math.round(meter * 100)}%` }} />
      </div>
      <dl className="live-rows tall">
        <div>
          <dt>State</dt>
          <dd className={`pill sev-${toneOf(snapshot)}`}>{state.replace("_", " ")}</dd>
        </div>
        <div>
          <dt>Valid peak</dt>
          <dd>{fmt(snapshot?.rom.validPeak)}</dd>
        </div>
        <div>
          <dt>Raw peak</dt>
          <dd>{fmt(snapshot?.rom.rawPeak)}</dd>
        </div>
        <div>
          <dt>Tracking</dt>
          <dd className={`st-${trackingTone(snapshot)}`}>{trackingLabel(snapshot)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{snapshot ? `${snapshot.quality}%` : "—"}</dd>
        </div>
      </dl>
      <p className="quality-line">Software tracking confidence, not a clinical score.</p>
    </section>
  );
}

function fmt(value: number | null | undefined): string {
  return value == null ? "—.—" : `${value.toFixed(1)}°`;
}

function trackingLabel(snapshot: TLSnapshot | null): string {
  if (!snapshot?.tracking.present) return "LOST";
  if (snapshot.state === "TRACKING_LOST" || !snapshot.tracking.criticalOk) return "WEAK";
  if (snapshot.tracking.score >= 0.7) return "GOOD";
  return "OK";
}

function trackingTone(snapshot: TLSnapshot | null): string {
  const label = trackingLabel(snapshot);
  if (label === "GOOD") return "pass";
  if (label === "LOST") return "fail";
  return "warn";
}

function toneOf(snapshot: TLSnapshot | null): "green" | "yellow" | "red" {
  if (!snapshot || snapshot.state === "INVALID" || snapshot.state === "SEARCHING" || snapshot.state === "TRACKING_LOST" || snapshot.hardFailed) return "red";
  if (snapshot.state === "POSITIONING" || snapshot.state === "CALIBRATING" || snapshot.state === "PEAK" || snapshot.checks.some((check) => check.status === "warn")) return "yellow";
  return "green";
}

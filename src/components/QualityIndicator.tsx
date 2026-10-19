import type { TLSnapshot } from "../tl/tlTypes";

export function QualityIndicator({ snapshot }: { snapshot: TLSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const confirming = state === "READY" || state === "READY_CONFIRMING";
  const active = state === "ACTIVE" || state === "MEASURING" || state === "COUNTDOWN";
  const finished = state === "COMPLETE" && snapshot?.result?.accepted && snapshot.result.measuredRom != null;
  const meter = state === "CALIBRATING" || state === "STABLE" ? (snapshot?.calibrationProgress ?? 0) : confirming ? (snapshot?.thumbProgress ?? 0) : active ? (snapshot?.holdProgress ?? 0) : finished ? 1 : 0;
  const side = snapshot?.direction === "left" ? "LEFT" : "RIGHT";
  const sideName = snapshot?.direction === "left" ? "Left" : "Right";
  const kicker = finished ? `${sideName} TL Junction ROM` : state === "ACTIVE" || state === "MEASURING" ? `ROTATE ${side}` : confirming && snapshot?.canStart ? "Position looks good" : `TL Junction · ${sideName} rotation`;
  const live = finished
    ? snapshot?.result?.measuredRom?.toFixed(1)
    : snapshot?.countdownLabel ?? (snapshot?.rom.filtered != null ? Math.max(0, snapshot.rom.filtered).toFixed(1) : null);
  const remain = snapshot?.captureRemainingMs;
  return (
    <section className="live-rom">
      <p className="kicker">{kicker}</p>
      <p className="angle">{live ?? "—.—"}</p>
      <p className="angle-unit">{finished ? "saved degrees" : snapshot?.countdownLabel ? "get ready" : state === "ACTIVE" ? "live ROM, degrees" : confirming && snapshot?.canStart ? "hold thumbs up or say Ready" : snapshot?.calibrationComplete ? "torso relative to pelvis, degrees" : "live rotation, degrees"}</p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${Math.round(meter * 100)}%` }} />
      </div>
      <dl className="live-rows tall">
        <div>
          <dt>State</dt>
          <dd className={`pill sev-${toneOf(snapshot)}`}>{state.replace("_", " ")}</dd>
        </div>
        <div>
          <dt>Best valid</dt>
          <dd>{fmt(snapshot?.movementStarted ? snapshot.rom.validPeak : null)}</dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{remain == null ? "—" : `${(remain / 1000).toFixed(1)} s`}</dd>
        </div>
        <div>
          <dt>Live ROM</dt>
          <dd>{fmt(snapshot?.rom.filtered == null ? null : Math.max(0, snapshot.rom.filtered))}</dd>
        </div>
        <div>
          <dt>Raw ROM</dt>
          <dd>{fmt(snapshot?.rom.raw)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{snapshot?.movementStarted ? snapshot.movementMessage || "Movement valid" : "Not capturing"}</dd>
        </div>
        <div>
          <dt>Accept band</dt>
          <dd>{snapshot?.movementStarted ? `${snapshot.trackingBand.toUpperCase()} ${snapshot.trackingScore}%` : "—"}</dd>
        </div>
        <div>
          <dt>Pose</dt>
          <dd className={`st-${trackingTone(snapshot)}`}>{trackingLabel(snapshot)}</dd>
        </div>
      </dl>
      <p className="quality-line">{finished ? "Assessment completed." : state === "ACTIVE" ? "The saved result is the highest angle while movement stayed valid." : confirming && snapshot?.thumbSeen ? "Ready gesture detected — keep holding." : "The live number is not a saved result until the capture window starts."}</p>
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

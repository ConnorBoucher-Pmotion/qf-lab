import type { SRSnapshot } from "../sr/srTypes";

export function QualityIndicator({ snapshot }: { snapshot: SRSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const confirming = state === "READY" || state === "READY_CONFIRMING";
  const active = state === "ACTIVE" || state === "MEASURING" || state === "COUNTDOWN";
  const finished = state === "COMPLETE" && snapshot?.result?.accepted;
  const meter = state === "CALIBRATING" || state === "STABLE" ? (snapshot?.calibrationProgress ?? 0) : confirming ? (snapshot?.thumbProgress ?? 0) : active ? (snapshot?.holdProgress ?? 0) : finished ? 1 : 0;
  const bubble = constraintTone(snapshot);
  const kicker = finished
    ? "Shoulder Rotation ROM"
    : state === "ACTIVE" || state === "MEASURING"
      ? "ROTATE"
      : confirming && snapshot?.canStart
        ? "Position looks good"
        : "Shoulder Rotation · IR / ER";
  const live = finished
    ? snapshot?.result?.measuredRom?.toFixed(1)
    : snapshot?.countdownLabel ?? (snapshot?.left.currentSigned != null || snapshot?.right.currentSigned != null ? liveArc(snapshot) : null);
  const remain = snapshot?.captureRemainingMs;
  return (
    <section className="live-rom">
      <p className="kicker">{kicker}</p>
      <p className={`angle sev-${bubble}`}>{live ?? "—.—"}</p>
      <p className="angle-unit">
        {finished
          ? "validated total arc, degrees"
          : snapshot?.countdownLabel
            ? "get ready"
            : state === "ACTIVE"
              ? "live rotation, degrees"
              : confirming && snapshot?.canStart
                ? "hold thumbs up or say Ready"
                : snapshot?.calibrationComplete
                  ? "forearm from baseline, degrees"
                  : "live rotation, degrees"}
      </p>
      <p className={`pill sev-${bubble}`}>{bubbleLabel(bubble)}</p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${Math.round(meter * 100)}%` }} />
      </div>
      <dl className="live-rows tall">
        <div>
          <dt>State</dt>
          <dd className={`pill sev-${toneOf(snapshot)}`}>{state.replace("_", " ")}</dd>
        </div>
        <div>
          <dt>L Valid Arc</dt>
          <dd>{fmt(snapshot?.movementStarted ? snapshot.left.validArc : null)}</dd>
        </div>
        <div>
          <dt>R Valid Arc</dt>
          <dd>{fmt(snapshot?.movementStarted ? snapshot.right.validArc : null)}</dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{remain == null ? "—" : `${(remain / 1000).toFixed(1)} s`}</dd>
        </div>
        <div>
          <dt>Raw L / R</dt>
          <dd>
            {fmt(snapshot?.left.rawArc)} / {fmt(snapshot?.right.rawArc)}
          </dd>
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
      <p className="quality-line">
        {finished
          ? "Assessment completed."
          : state === "ACTIVE"
            ? "Validated ROM only counts while constraints stay satisfied."
            : confirming && snapshot?.thumbSeen
              ? "Ready gesture detected — keep holding."
              : "The live number is not a saved result until the capture window starts."}
      </p>
    </section>
  );
}

function liveArc(snapshot: SRSnapshot | null): string {
  if (!snapshot) return "—.—";
  const l = snapshot.left.currentSigned;
  const r = snapshot.right.currentSigned;
  if (l == null && r == null) return "—.—";
  return `${l == null ? "—" : l.toFixed(1)} / ${r == null ? "—" : r.toFixed(1)}`;
}

function constraintTone(snapshot: SRSnapshot | null): "green" | "yellow" | "red" {
  if (!snapshot) return "red";
  const checks = snapshot.movementStarted ? snapshot.checks : snapshot.setupChecks;
  if (checks.some((check) => check.blocking && check.status === "fail")) return "red";
  if (checks.some((check) => check.status === "warn") || snapshot.hardFailed) return "yellow";
  if (snapshot.state === "SEARCHING" || snapshot.state === "TRACKING_LOST") return "red";
  return "green";
}

function bubbleLabel(tone: "green" | "yellow" | "red"): string {
  if (tone === "green") return "Position Valid";
  if (tone === "yellow") return "Adjust Position";
  return "Position Invalid";
}

function fmt(value: number | null | undefined): string {
  return value == null ? "—.—" : `${value.toFixed(1)}°`;
}

function trackingLabel(snapshot: SRSnapshot | null): string {
  if (!snapshot?.tracking.present) return "LOST";
  if (snapshot.state === "TRACKING_LOST" || !snapshot.tracking.criticalOk) return "WEAK";
  if (snapshot.tracking.score >= 0.7) return "GOOD";
  return "OK";
}

function trackingTone(snapshot: SRSnapshot | null): string {
  const label = trackingLabel(snapshot);
  if (label === "GOOD") return "pass";
  if (label === "LOST") return "fail";
  return "warn";
}

function toneOf(snapshot: SRSnapshot | null): "green" | "yellow" | "red" {
  if (!snapshot || snapshot.state === "INVALID" || snapshot.state === "SEARCHING" || snapshot.state === "TRACKING_LOST" || snapshot.hardFailed) return "red";
  if (snapshot.state === "POSITIONING" || snapshot.state === "CALIBRATING" || snapshot.state === "PEAK" || snapshot.checks.some((check) => check.status === "warn")) return "yellow";
  return "green";
}

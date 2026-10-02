import type { QFSnapshot } from "../qf/qfTypes";

const STATE_LABEL: Record<QFSnapshot["state"], string> = {
  SEARCHING: "SEARCHING",
  POSITIONING: "POSITIONING",
  CALIBRATING: "CALIBRATING",
  READY: "READY",
  ARMED: "ARMED",
  MEASURING: "MEASURING",
  TRACKING_WARNING: "TRACKING",
  HOLDING: "HOLD",
  VALIDATING: "VALID",
  RESULT: "RESULT",
  INVALID: "INVALID",
};

type Tone = "green" | "yellow" | "red";

export function QualityIndicator({ snapshot }: { snapshot: QFSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const angle = state === "RESULT" ? snapshot?.result?.measuredRom : snapshot?.primary.filtered;
  const showAngle = snapshot != null && ["MEASURING", "HOLDING", "VALIDATING", "TRACKING_WARNING", "RESULT"].includes(state);
  const meter = state === "CALIBRATING" ? snapshot?.calibrationProgress : state === "HOLDING" || state === "VALIDATING" ? snapshot?.hold?.progress : 0;
  const tracking = trackingLabel(snapshot);
  const constraints = constraintLabel(snapshot);
  return (
    <section className="live-rom">
      <p className="kicker">QF ROM</p>
      <p className="angle">{showAngle && angle != null ? angle.toFixed(1) : "—.—"}</p>
      <p className="angle-unit">degrees</p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${Math.round((meter ?? 0) * 100)}%` }} />
      </div>
      <dl className="live-rows">
        <div>
          <dt>State</dt>
          <dd className={`pill sev-${toneOf(snapshot)}`}>{STATE_LABEL[state]}</dd>
        </div>
        <div>
          <dt>Tracking</dt>
          <dd className={`st-${tracking.tone}`}>{tracking.label}</dd>
        </div>
        <div>
          <dt>Constraints</dt>
          <dd className={`st-${constraints.tone}`}>{constraints.label}</dd>
        </div>
      </dl>
    </section>
  );
}

function trackingLabel(snapshot: QFSnapshot | null): { label: string; tone: "pass" | "warn" | "fail" } {
  if (!snapshot?.tracking.present) return { label: "—", tone: "fail" };
  if (!snapshot.tracking.criticalOk) return { label: "WEAK", tone: "warn" };
  if (snapshot.tracking.score >= 0.7) return { label: "GOOD", tone: "pass" };
  return { label: "OK", tone: "warn" };
}

function constraintLabel(snapshot: QFSnapshot | null): { label: string; tone: "pass" | "warn" | "fail" } {
  if (!snapshot) return { label: "—", tone: "fail" };
  const checks = [...snapshot.setupChecks, ...snapshot.checks];
  if (snapshot.hardFailed || checks.some((c) => c.category === "hard" && c.status === "fail") || checks.some((c) => c.blocking && c.status === "fail")) {
    return { label: "FAIL", tone: "fail" };
  }
  if (checks.some((c) => c.status === "warn" || (c.category === "soft" && c.status === "fail"))) return { label: "WARN", tone: "warn" };
  if (checks.length === 0) return { label: "—", tone: "warn" };
  return { label: "PASS", tone: "pass" };
}

function toneOf(snapshot: QFSnapshot | null): Tone {
  if (!snapshot) return "red";
  if (snapshot.state === "INVALID" || snapshot.state === "SEARCHING" || snapshot.hardFailed) return "red";
  if (snapshot.state === "POSITIONING" || snapshot.state === "CALIBRATING" || snapshot.state === "TRACKING_WARNING" || snapshot.checks.some((c) => c.status === "warn" || (c.category === "soft" && c.status === "fail"))) {
    return "yellow";
  }
  return "green";
}

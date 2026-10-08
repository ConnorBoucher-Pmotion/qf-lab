import type { ConstraintCheck, TLSnapshot } from "../tl/tlTypes";

export function PositioningGuide({ snapshot }: { snapshot: TLSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const setup = state === "SEARCHING" || state === "POSITIONING" || state === "STABLE" || state === "CALIBRATING";
  const checks = setup ? (snapshot?.setupChecks ?? []) : (snapshot?.checks ?? []);
  return (
    <section className="gate-box">
      <p className="kicker">{setup ? "Position" : "Compensation"}</p>
      <ul className="checklist">
        {checks.length === 0 ? (
          <li className="st-na">
            <span className="mark">—</span>
            <span>Waiting for a person</span>
          </li>
        ) : (
          checks.map((check) => (
            <li key={check.id} className={`st-${check.status === "na" ? "na" : check.status}`}>
              <span className="mark">{mark(check)}</span>
              <span>
                {check.label}
                <small>{check.message}</small>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function mark(check: ConstraintCheck): string {
  if (check.category === "info") return "INFO";
  if (check.status === "pass") return "PASS";
  if (check.status === "warn") return "WARN";
  if (check.status === "na") return "N/A";
  return "FAIL";
}

export function instructionTone(state: TLSnapshot["state"] | undefined): string {
  if (state === "INVALID" || state === "SEARCHING" || state === "TRACKING_LOST" || state == null) return "bad";
  if (state === "POSITIONING" || state === "STABLE" || state === "CALIBRATING" || state === "PEAK") return "warn";
  return "ok";
}

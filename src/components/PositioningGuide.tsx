import type { ConstraintCheck, QFSnapshot } from "../qf/qfTypes";

const EMPTY: ConstraintCheck[] = [];

export function PositioningGuide({ snapshot }: { snapshot: QFSnapshot | null }) {
  const state = snapshot?.state ?? "SEARCHING";
  const setup = state === "SEARCHING" || state === "POSITIONING" || state === "CALIBRATING";
  const checks = setup ? (snapshot?.setupChecks ?? EMPTY) : (snapshot?.checks.filter((c) => c.category === "hard" || c.category === "soft") ?? EMPTY);
  return (
    <section className="gate-box">
      <p className="kicker">{setup ? "Start gates" : "Movement gates"}</p>
      <ul className="checklist">
        {checks.length === 0 ? (
          <li className="st-na">
            <span className="mark">—</span>
            <span>Waiting for a person</span>
          </li>
        ) : (
          checks.map((check) => (
            <li key={check.id} className={`st-${check.status}`}>
              <span className="mark">{mark(check.status)}</span>
              <span>
                {check.label}
                {check.status === "fail" || check.status === "warn" ? <small>{check.message}</small> : null}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function mark(status: ConstraintCheck["status"]): string {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  if (status === "na") return "N/A";
  return "FAIL";
}

export function instructionTone(state: QFSnapshot["state"] | undefined): string {
  if (state === "INVALID" || state === "SEARCHING" || state == null) return "bad";
  if (state === "POSITIONING" || state === "CALIBRATING" || state === "TRACKING_WARNING" || state === "VALIDATING") return "warn";
  return "ok";
}

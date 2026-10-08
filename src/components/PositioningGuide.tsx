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
      <FacingReadout snapshot={snapshot} />
    </section>
  );
}

function FacingReadout({ snapshot }: { snapshot: TLSnapshot | null }) {
  const facing = snapshot?.cameraFacing;
  const meters = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(3));
  const deg = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(1)}°`);
  const status = facing?.status === "pass" ? "PASS" : facing?.status === "warn" ? "WARNING" : facing?.status === "fail" ? "FAIL" : "—";
  return (
    <dl className="readout facing-readout">
      <Item label="Face camera status" value={status} />
      <Item label="Facing score" value={deg(facing?.scoreDeg)} />
      <Item label="Pass below" value={facing ? `${facing.warnDeg}°` : "—"} />
      <Item label="Fail at" value={facing ? `${facing.failDeg}°` : "—"} />
      <Item label="Left shoulder Z" value={meters(facing?.leftShoulderZ)} />
      <Item label="Right shoulder Z" value={meters(facing?.rightShoulderZ)} />
      <Item label="Shoulder Z difference" value={meters(facing?.shoulderZDiff)} />
      <Item label="Left hip Z" value={meters(facing?.leftHipZ)} />
      <Item label="Right hip Z" value={meters(facing?.rightHipZ)} />
      <Item label="Hip Z difference" value={meters(facing?.hipZDiff)} />
      <Item label="Shoulder width" value={meters(facing?.shoulderWidth)} />
      <Item label="Hip width" value={meters(facing?.hipWidth)} />
      <Item label="Shoulder axis" value={deg(facing?.shoulderYawDeg)} />
      <Item label="Hip axis" value={deg(facing?.hipYawDeg)} />
      <p className="facing-reason">{facing?.reason ?? "Waiting for a pose."}</p>
    </dl>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

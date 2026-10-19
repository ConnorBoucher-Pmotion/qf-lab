import { grade } from "../sr/srConstraints";
import type { SRResult, SRTrial } from "../sr/srTypes";
import { videoAction } from "../recording/recordingStore";

type Props = {
  live: SRResult | null;
  latest: SRTrial | null;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onGoniometer: (id: string, value: number | null) => void;
  onNext: () => void;
  onReview: (id: string) => void;
};

const ROWS: Array<{ label: string; value: keyof NonNullable<SRResult["atValid"]>; warn: string; fail: string; unit: string }> = [
  { label: "Lateral trunk lean", value: "lateralLeanDeg", warn: "lateralLeanWarnDeg", fail: "lateralLeanFailDeg", unit: "°" },
  { label: "Forward / back lean", value: "forwardLeanDeg", warn: "forwardLeanWarnDeg", fail: "forwardLeanFailDeg", unit: "°" },
  { label: "Max elbow drift", value: "maxElbowDriftPct", warn: "elbowDriftWarnPct", fail: "elbowDriftFailPct", unit: "%" },
  { label: "Max shoulder shrug", value: "maxShoulderShrugPct", warn: "shoulderShrugWarnPct", fail: "shoulderShrugFailPct", unit: "%" },
];

export function ResultsPanel({ live, latest, videoIds, savingId, onGoniometer, onNext, onReview }: Props) {
  const trial = latest ?? null;
  const reviewId = trial?.id ?? live?.id ?? null;
  const video = reviewId ? videoAction(reviewId, videoIds, savingId) : { label: "—", enabled: false };
  return (
    <section className="card">
      <h2>Trial</h2>
      {!live ? <p className="muted">A captured trial will show up here.</p> : null}
      {live ? (
        <>
          <p className="kicker">Shoulder Abduction IR / ER</p>
          <div className="side-results">
            <SideBlock title="LEFT" rom={live.left} />
            <SideBlock title="RIGHT" rom={live.right} />
          </div>
          <p>
            <b>Difference {fmt(live.asymmetryDeg)}</b>
          </p>
          <p className="muted small">
            Trial quality: {live.trialQuality ?? "—"} · tracking {live.confidence}% · rejected frames {live.rejectedFrameCount} · valid frames {live.validFrameCount}
          </p>
          <p className="muted small">Software tracking confidence, not a clinical score. {live.accepted ? "Capture complete." : live.instruction}</p>
          <ul className="checklist">
            {ROWS.map((row) => {
              const value = live.atValid?.[row.value] ?? null;
              const warn = live.thresholds[row.warn] ?? 0;
              const fail = live.thresholds[row.fail] ?? 0;
              const status = grade(typeof value === "number" ? value : null, warn, fail);
              return (
                <li key={row.label} className={`st-${status}`}>
                  <span className="mark">{status === "pass" ? "PASS" : status === "warn" ? "WARN" : status === "fail" ? "FAIL" : "N/A"}</span>
                  <span>
                    {row.label}
                    <small>
                      {value == null || typeof value !== "number" ? "—" : `${Math.abs(value).toFixed(1)}${row.unit}`} · fail {fail}
                      {row.unit}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
          {live.rejectedReasons.length > 0 ? (
            <p className="muted small">
              Rejected: {live.rejectedReasons.slice(0, 4).map((item) => `${item.reason} (${item.count})`).join("; ")}
            </p>
          ) : null}
          {live.failureEvents.length > 0 ? <p className="muted small">Failure events: {live.failureEvents.join(", ")}</p> : null}
          <div className="row wrap">
            <button type="button" className="primary" onClick={onNext}>
              Next trial
            </button>
            <button type="button" className="video-button" disabled={!video.enabled} onClick={() => reviewId && onReview(reviewId)}>
              {video.label === "—" ? "Replay trial" : video.label === "Review" ? "Replay trial" : video.label}
            </button>
          </div>
          {trial ? (
            <label className="gonio">
              Goniometer (optional)
              <input
                className="gonio-input"
                inputMode="decimal"
                placeholder="degrees"
                defaultValue={trial.goniometer ?? ""}
                key={`${trial.id}-${trial.goniometer ?? "x"}`}
                onBlur={(event) => {
                  const text = event.target.value.trim();
                  onGoniometer(trial.id, text === "" ? null : Number(text));
                }}
              />
              {trial.goniometer != null && trial.signedError != null ? (
                <span className="muted small">
                  CV {fmt(trial.measuredRom)} · goniometer {trial.goniometer.toFixed(1)}° · difference {trial.signedError > 0 ? "+" : ""}
                  {trial.signedError.toFixed(1)}° · absolute {trial.absoluteError?.toFixed(1)}°
                </span>
              ) : null}
            </label>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SideBlock({ title, rom }: { title: string; rom: SRResult["left"] }) {
  return (
    <div className="side-block">
      <p className="kicker">{title}</p>
      <p>
        IR raw {fmt(rom.rawIr)} · validated {fmt(rom.validIr)}
      </p>
      <p>
        ER raw {fmt(rom.rawEr)} · validated {fmt(rom.validEr)}
      </p>
      <p>
        <b>Total {fmt(rom.validArc)}</b> <span className="muted small">(raw {fmt(rom.rawArc)})</span>
      </p>
    </div>
  );
}

function fmt(value: number | null | undefined): string {
  return value == null ? "—.—" : `${value.toFixed(1)}°`;
}

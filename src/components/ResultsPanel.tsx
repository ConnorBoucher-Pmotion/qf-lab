import { ALGORITHM_INFO } from "../tl/tlRotation";
import { grade } from "../tl/tlCompensation";
import type { TLResult, TLTrial } from "../tl/tlTypes";
import { videoAction } from "../recording/recordingStore";

type Props = {
  live: TLResult | null;
  latest: TLTrial | null;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onGoniometer: (id: string, value: number | null) => void;
  onNext: () => void;
  onReview: (id: string) => void;
};

const ROWS: Array<{ label: string; value: keyof NonNullable<TLResult["atValid"]>; warn: string; fail: string; unit: string }> = [
  { label: "Pelvic rotation", value: "pelvisRotationDeg", warn: "pelvisRotationWarnDeg", fail: "pelvisRotationFailDeg", unit: "°" },
  { label: "Pelvic translation", value: "pelvisTranslationPct", warn: "pelvisTranslationWarnPct", fail: "pelvisTranslationFailPct", unit: "%" },
  { label: "Lateral trunk lean", value: "lateralLeanDeg", warn: "lateralLeanWarnDeg", fail: "lateralLeanFailDeg", unit: "°" },
  { label: "Forward / back lean", value: "forwardLeanDeg", warn: "forwardLeanWarnDeg", fail: "forwardLeanFailDeg", unit: "°" },
  { label: "Knee movement", value: "kneeShiftPct", warn: "kneeShiftWarnPct", fail: "kneeShiftFailPct", unit: "%" },
  { label: "Hip movement", value: "hipShiftPct", warn: "hipShiftWarnPct", fail: "hipShiftFailPct", unit: "%" },
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
          <p className="kicker">{live.direction === "left" ? "Left rotation" : "Right rotation"}</p>
          <p>
            <b>Valid ROM {fmt(live.measuredRom)}</b>
          </p>
          <p className="muted small">
            Raw peak {fmt(live.rawMaximum)} · {ALGORITHM_INFO[live.algorithm].label} · confidence {live.confidence}% · hold {live.holdMs == null ? "—" : `${(live.holdMs / 1000).toFixed(1)} s`}
          </p>
          <p className="muted small">Software tracking confidence, not a clinical score. {live.accepted ? "Hold confirmed." : live.instruction}</p>
          <ul className="checklist">
            {ROWS.map((row) => {
              const value = live.atValid?.[row.value] ?? null;
              const warn = live.thresholds[row.warn] ?? 0;
              const fail = live.thresholds[row.fail] ?? 0;
              const status = grade(value, warn, fail);
              return (
                <li key={row.label} className={`st-${status}`}>
                  <span className="mark">{status === "pass" ? "PASS" : status === "warn" ? "WARN" : status === "fail" ? "FAIL" : "N/A"}</span>
                  <span>
                    {row.label}
                    <small>
                      {value == null ? "—" : `${Math.abs(value).toFixed(1)}${row.unit}`} · fail {fail}
                      {row.unit}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
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

function fmt(value: number | null | undefined): string {
  return value == null ? "—.—" : `${value.toFixed(1)}°`;
}

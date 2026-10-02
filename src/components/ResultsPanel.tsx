import { ANGLE_METHODS, ANGLE_METHOD_INFO } from "../qf/qfMeasurementEngine";
import type { QFResult, Trial } from "../qf/qfTypes";
import { videoAction } from "../recording/recordingStore";

type Props = {
  live: QFResult | null;
  latest: Trial | null;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onGoniometer: (id: string, value: number | null) => void;
  onSaveRejection: () => void;
  onNext: () => void;
  onReview: (id: string) => void;
  rejectionSaved: boolean;
};

export function ResultsPanel({ live, latest, videoIds, savingId, onGoniometer, onSaveRejection, onNext, onReview, rejectionSaved }: Props) {
  const reviewId = latest?.id ?? live?.id ?? null;
  const video = reviewId ? videoAction(reviewId, videoIds, savingId) : { label: "—", enabled: false };
  return (
    <section className="card">
      <h2>Trial</h2>
      {live && !live.accepted ? (
        <div className="rejection">
          <p>{live.instruction}</p>
          <p className="muted">Invalid trial. Rejected by: {live.failedConstraints.join(", ") || "constraint"}</p>
          <div className="row wrap">
            <button type="button" onClick={onNext}>
              Try again
            </button>
            <button type="button" onClick={onSaveRejection} disabled={rejectionSaved}>
              {rejectionSaved ? "Saved" : "Save rejected attempt"}
            </button>
            <button type="button" className="video-button" disabled={!video.enabled} onClick={() => reviewId && onReview(reviewId)}>
              {video.label === "—" ? "No video" : video.label}
            </button>
          </div>
        </div>
      ) : null}
      {live?.accepted ? (
        <div className="row wrap">
          <button type="button" className="primary" onClick={onNext}>
            Next trial
          </button>
          <button type="button" className="video-button" disabled={!video.enabled} onClick={() => reviewId && onReview(reviewId)}>
            {video.label === "—" ? "No video" : video.label}
          </button>
        </div>
      ) : null}
      {latest?.accepted ? <LatestTrial trial={latest} onGoniometer={onGoniometer} /> : !live ? <p className="muted">A captured trial will show up here.</p> : null}
    </section>
  );
}

function LatestTrial({ trial, onGoniometer }: { trial: Trial; onGoniometer: Props["onGoniometer"] }) {
  const hold = trial.hold;
  return (
    <div className="gonio">
      <p>
        <b>
          #{trial.trialNumber} · {trial.measuredRom?.toFixed(1)}°
        </b>{" "}
        ({ANGLE_METHOD_INFO[trial.primaryMethod].label}). Confidence {trial.confidence}.
        {hold ? ` Hold ${Math.round(hold.durationMs)} ms, ${hold.frames} frames, SD ${hold.sdDeg.toFixed(2)}°.` : ""}
      </p>
      <p className="muted small">
        {ANGLE_METHODS.filter((m) => m !== trial.primaryMethod)
          .map((m) => `${ANGLE_METHOD_INFO[m].label} ${fmt(trial.angles[m])}°`)
          .join(" · ")}
        {` · raw max ${fmt(trial.rawMaximum)}° (not used)`}
      </p>
      {hold && Object.keys(hold.softWarnings).length > 0 ? (
        <p className="muted small">
          Soft warnings in hold:{" "}
          {Object.entries(hold.softWarnings)
            .map(([id, s]) => `${id} ${Math.round((s.warn + s.fail) * 100)}%`)
            .join(", ")}
        </p>
      ) : null}
      <label>
        Goniometer (degrees)
        <input
          type="number"
          step="0.5"
          value={trial.goniometer ?? ""}
          onChange={(event) => {
            const text = event.target.value;
            onGoniometer(trial.id, text === "" ? null : Number(text));
          }}
        />
      </label>
      {trial.goniometer != null ? (
        <p>
          Camera − goniometer: <b>{fmt(trial.signedError)}°</b> (abs {fmt(trial.absoluteError)}°, {trial.percentError == null ? "—" : `${trial.percentError.toFixed(1)}%`}).
        </p>
      ) : (
        <p className="muted small">Zero the goniometer at the same hang. Signed error is camera minus goniometer. No correction is applied.</p>
      )}
    </div>
  );
}

function fmt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

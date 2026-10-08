import { agreement, describe } from "../tl/tlQuality";
import type { RotationDirection, TLTrial } from "../tl/tlTypes";
import { videoAction } from "../recording/recordingStore";

type Props = {
  trials: TLTrial[];
  direction: RotationDirection;
  series: string;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onSeries: (series: string) => void;
  onReview: (id: string) => void;
  onGoniometer: (id: string, value: number | null) => void;
  onDelete: (id: string) => void;
  onClearSeries: () => void;
};

export function RepeatabilityPanel({ trials, direction, series, videoIds, savingId, onSeries, onReview, onGoniometer, onDelete, onClearSeries }: Props) {
  const rows = trials.filter((trial) => trial.series === series && trial.direction === direction).slice().reverse();
  const accepted = rows.filter((trial) => trial.accepted && trial.measuredRom != null);
  const stats = describe(accepted.map((trial) => trial.measuredRom ?? 0));
  const agree = agreement(rows);
  return (
    <section className="card repeat">
      <h2>Repeated trials</h2>
      <p className="protocol">
        Sit facing the camera, feet flat, knees about 90°, pelvis forward. Cross your arms or hold a stick across the shoulders. Rotate as far as comfortably possible. No bouncing. No forced rotation.
      </p>
      <p className="muted small">
        Start with the camera straight in front, including the head, shoulders, hips, and knees. Rotation uses world-landmark depth. If that disagrees with a goniometer, test a chest-height camera about 20–30° off pure frontal without changing the seated movement.
      </p>
      <label className="inline">
        Series
        <input value={series} onChange={(event) => onSeries(event.target.value)} />
      </label>
      <dl className="stats">
        <Stat label="Average" value={stats.mean} />
        <Stat label="Minimum" value={stats.min} />
        <Stat label="Maximum" value={stats.max} />
        <Stat label="Range" value={stats.range} />
        <Stat label="Std deviation" value={stats.sd} />
        <Stat label="Trials" value={stats.n} digits={0} />
      </dl>
      <dl className="stats">
        <Stat label="Mean CV" value={agree.meanCv} />
        <Stat label="Mean goniometer" value={agree.meanGonio} />
        <Stat label="Mean error" value={agree.meanError} />
        <Stat label="Mean absolute error" value={agree.meanAbsoluteError} />
      </dl>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Trial</th>
              <th>Direction</th>
              <th>Valid ROM</th>
              <th>Raw ROM</th>
              <th>Pelvis</th>
              <th>Lean</th>
              <th>Confidence</th>
              <th>Gonio</th>
              <th>Diff</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trial) => {
              const video = videoAction(trial.id, videoIds, savingId);
              return (
                <tr key={trial.id} className={trial.accepted ? "" : "rejected"}>
                  <td>{trial.trialNumber}</td>
                  <td>{trial.direction}</td>
                  <td>{num(trial.measuredRom)}</td>
                  <td>{num(trial.rawMaximum)}</td>
                  <td>{num(trial.atValid?.pelvisRotationDeg)}</td>
                  <td>{num(trial.atValid?.lateralLeanDeg)}</td>
                  <td>{trial.confidence}%</td>
                  <td>
                    <input
                      className="gonio-input"
                      inputMode="decimal"
                      defaultValue={trial.goniometer ?? ""}
                      key={`${trial.id}-${trial.goniometer ?? "x"}`}
                      onBlur={(event) => {
                        const text = event.target.value.trim();
                        onGoniometer(trial.id, text === "" ? null : Number(text));
                      }}
                    />
                  </td>
                  <td>{trial.signedError == null ? "—" : trial.signedError.toFixed(1)}</td>
                  <td className="row">
                    <button type="button" className="video-button" disabled={!video.enabled} onClick={() => onReview(trial.id)}>
                      {video.label === "Review" ? "Replay" : video.label}
                    </button>
                    <button type="button" className="text-button" onClick={() => onDelete(trial.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No trials in this series yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={onClearSeries} disabled={rows.length === 0}>
        Clear this series
      </button>
    </section>
  );
}

function Stat({ label, value, digits = 1 }: { label: string; value: number | null; digits?: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value == null ? "—" : digits === 0 ? String(value) : value.toFixed(digits)}</dd>
    </div>
  );
}

function num(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

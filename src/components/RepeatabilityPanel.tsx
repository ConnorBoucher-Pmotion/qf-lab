import { agreement, describe } from "../sr/srQuality";
import type { SRTrial } from "../sr/srTypes";
import { videoAction } from "../recording/recordingStore";

type Props = {
  trials: SRTrial[];
  series: string;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onSeries: (series: string) => void;
  onReview: (id: string) => void;
  onGoniometer: (id: string, value: number | null) => void;
  onDelete: (id: string) => void;
  onClearSeries: () => void;
};

export function RepeatabilityPanel({ trials, series, videoIds, savingId, onSeries, onReview, onGoniometer, onDelete, onClearSeries }: Props) {
  const rows = trials.filter((trial) => trial.series === series).slice().reverse();
  const accepted = rows.filter((trial) => trial.accepted && trial.measuredRom != null);
  const stats = describe(accepted.map((trial) => trial.measuredRom ?? 0));
  const agree = agreement(rows);
  return (
    <section className="card repeat">
      <h2>Repeated trials</h2>
      <p className="protocol">
        Sit upright facing the camera. Arms abducted ~90°, elbows bent ~90°, forearms up (goalpost). Rotate the forearms for external rotation (back/up) and internal rotation (forward/down) while keeping the upper arms still. No bouncing. No shoulder shrug.
      </p>
      <label className="inline">
        Series
        <input value={series} onChange={(event) => onSeries(event.target.value)} />
      </label>
      <dl className="stats">
        <Stat label="Average arc" value={stats.mean} />
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
              <th>L IR/ER</th>
              <th>R IR/ER</th>
              <th>L Arc</th>
              <th>R Arc</th>
              <th>Diff</th>
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
                  <td>
                    {num(trial.left.validIr)}/{num(trial.left.validEr)}
                  </td>
                  <td>
                    {num(trial.right.validIr)}/{num(trial.right.validEr)}
                  </td>
                  <td>{num(trial.left.validArc)}</td>
                  <td>{num(trial.right.validArc)}</td>
                  <td>{num(trial.asymmetryDeg)}</td>
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

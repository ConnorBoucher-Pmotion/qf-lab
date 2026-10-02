import { useMemo, useState } from "react";
import { ANGLE_METHODS, ANGLE_METHOD_INFO } from "../qf/qfMeasurementEngine";
import { describe, goniometerBias, type Stats } from "../qf/qfRepeatability";
import type { Trial } from "../qf/qfTypes";
import type { Side } from "../pose/types";
import { videoAction } from "../recording/recordingStore";
import { download } from "../storage/trials";

export const SERIES_PRESETS = ["A · ideal", "B · camera higher", "C · camera lower", "D · camera left/right", "E · different distance"];

type Props = {
  trials: Trial[];
  side: Side;
  series: string;
  videoIds: ReadonlySet<string>;
  savingId: string | null;
  onSeries: (series: string) => void;
  onGoniometer: (id: string, value: number | null) => void;
  onDelete: (id: string) => void;
  onClearSeries: () => void;
  onReview: (id: string) => void;
  onClearRecordings: () => void;
};

/** Trial-to-trial variation is the primary metric. Goniometer agreement is secondary and never corrects anything. */
export function RepeatabilityPanel({ trials, side, series, videoIds, savingId, onSeries, onGoniometer, onDelete, onClearSeries, onReview, onClearRecordings }: Props) {
  const [custom, setCustom] = useState("");
  const inSeries = useMemo(() => trials.filter((t) => t.series === series && t.side === side).sort((a, b) => a.trialNumber - b.trialNumber), [trials, series, side]);
  const accepted = inSeries.filter((t) => t.accepted && t.measuredRom != null);
  const stats = describe(accepted.map((t) => t.measuredRom as number));
  const bias = goniometerBias(accepted.filter((t) => t.goniometer != null).map((t) => ({ cv: t.measuredRom as number, gonio: t.goniometer as number })));
  const allSeries = useMemo(() => [...new Set([...SERIES_PRESETS, ...trials.map((t) => t.series)])], [trials]);
  const verdict = repeatabilityVerdict(stats);

  return (
    <section className="card repeat">
      <h2>Repeatability test</h2>
      <p className="muted small protocol">
        Same person, same side, five trials. Use <b>Next trial</b> between attempts (keeps the hang). Use <b>Recalibrate</b> only if you stand up or move the camera.
        Protocol: A ideal · B camera higher · C lower · D left/right · E closer/farther. Recalibrate when you change the camera.
      </p>
      <div className="row wrap">
        <label className="inline">
          Series
          <select value={series} onChange={(event) => onSeries(event.target.value)}>
            {allSeries.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <input placeholder="New series name" value={custom} onChange={(event) => setCustom(event.target.value)} />
        <button
          type="button"
          disabled={!custom.trim()}
          onClick={() => {
            onSeries(custom.trim());
            setCustom("");
          }}
        >
          Add
        </button>
      </div>
      <p className="muted small">
        {side} leg · {accepted.length} accepted / {inSeries.length} attempts. Target: 5 consecutive accepted trials, same setup.
      </p>

      <div className={`verdict v-${verdict.tone}`}>{verdict.text}</div>
      <dl className="stats">
        <Stat label="Mean" value={deg(stats.mean)} />
        <Stat label="Median" value={deg(stats.median)} />
        <Stat label="SD" value={deg(stats.sd, 2)} strong />
        <Stat label="Range" value={deg(stats.range)} strong />
        <Stat label="Max difference" value={deg(stats.maxPairDiff)} strong />
        <Stat label="CV" value={stats.cvPercent == null ? "—" : `${stats.cvPercent.toFixed(1)}%`} />
        <Stat label="Max consecutive diff" value={deg(stats.maxConsecutiveDiff)} />
      </dl>

      {inSeries.length > 0 ? (
        <div className="table-scroll">
        <table className="trials">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>QF ROM</th>
              <th>Status</th>
              <th>Gonio</th>
              <th>Diff</th>
              <th>Conf.</th>
              <th>Video</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inSeries.map((t) => {
              const video = videoAction(t.id, videoIds, savingId);
              return (
              <tr key={t.id} className={t.accepted ? "" : "rejected"}>
                <td>{t.trialNumber}</td>
                <td>{t.timestamp.slice(11, 19)}</td>
                <td>{t.accepted && t.measuredRom != null ? `${t.measuredRom.toFixed(1)}°` : "—"}</td>
                <td>{t.accepted ? "Valid" : `Invalid${t.failedConstraints[0] ? ` · ${t.failedConstraints[0]}` : ""}`}</td>
                <td>
                  {t.accepted ? (
                    <input
                      className="gonio-input"
                      type="number"
                      step="0.5"
                      value={t.goniometer ?? ""}
                      onChange={(event) => onGoniometer(t.id, event.target.value === "" ? null : Number(event.target.value))}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>{t.signedError == null ? "—" : `${t.signedError > 0 ? "+" : ""}${t.signedError.toFixed(1)}`}</td>
                <td>{t.accepted ? t.confidence : "—"}</td>
                <td>
                  <button type="button" className="text-button video-button" disabled={!video.enabled} onClick={() => onReview(t.id)}>
                    {video.label}
                  </button>
                </td>
                <td>
                  <button type="button" className="text-button" onClick={() => onDelete(t.id)} title="Delete trial">
                    ✕
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : null}

      {accepted.length >= 2 ? (
        <>
          <h3>Same trials, every angle method</h3>
          <table className="trials">
            <thead>
              <tr>
                <th>Method</th>
                <th>Mean</th>
                <th>SD</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {ANGLE_METHODS.map((method) => {
                const s = describe(accepted.map((t) => t.angles[method]).filter((v): v is number => v != null));
                return (
                  <tr key={method} className={method === accepted[0].primaryMethod ? "primary-row" : ""}>
                    <td>{ANGLE_METHOD_INFO[method].label}</td>
                    <td>{deg(s.mean)}</td>
                    <td>{deg(s.sd, 2)}</td>
                    <td>{deg(s.range)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">The lowest SD is the most repeatable method for this setup. Absolute values differ by definition.</p>
        </>
      ) : null}

      <h3>Goniometer agreement</h3>
      <p className={`small bias-${bias.verdict}`}>{bias.explanation}</p>
      {bias.n >= 1 ? (
        <dl className="stats">
          <Stat label="Pairs" value={String(bias.n)} />
          <Stat label="Bias (CV − gonio)" value={signed(bias.bias)} strong />
          <Stat label="Error SD" value={deg(bias.errorSd, 2)} strong />
          <Stat label="Mean abs error" value={deg(bias.meanAbsoluteError)} />
          <Stat label="95% limits" value={bias.loaLow == null ? "—" : `${signed(bias.loaLow)} to ${signed(bias.loaHigh)}`} />
          <Stat label="Fit (not applied)" value={bias.fit ? `gonio ≈ ${bias.fit.slope.toFixed(2)}·CV ${bias.fit.intercept >= 0 ? "+" : "−"} ${Math.abs(bias.fit.intercept).toFixed(1)}` : "—"} />
        </dl>
      ) : null}

      <SeriesComparison trials={trials} side={side} />

      <div className="row wrap">
        <button type="button" onClick={() => download(`qf-trials-${stamp()}.csv`, toCsv(trials), "text/csv")} disabled={trials.length === 0}>
          Export CSV
        </button>
        <button type="button" onClick={() => download(`qf-trials-${stamp()}.json`, JSON.stringify(trials, null, 2))} disabled={trials.length === 0}>
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete all ${side} trials in "${series}", including their videos?`)) onClearSeries();
          }}
          disabled={inSeries.length === 0}
        >
          Clear series
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete all trial videos stored in this browser? The angle results stay.")) onClearRecordings();
          }}
          disabled={videoIds.size === 0}
        >
          Clear all videos
        </button>
      </div>
    </section>
  );
}

function SeriesComparison({ trials, side }: { trials: Trial[]; side: Side }) {
  const rows = useMemo(() => {
    const names = [...new Set(trials.filter((t) => t.side === side).map((t) => t.series))];
    return names.map((name) => {
      const acc = trials.filter((t) => t.series === name && t.side === side && t.accepted && t.measuredRom != null);
      const stats = describe(acc.map((t) => t.measuredRom as number));
      const bias = goniometerBias(acc.filter((t) => t.goniometer != null).map((t) => ({ cv: t.measuredRom as number, gonio: t.goniometer as number })));
      const cams = acc.map((t) => t.camera).filter((c): c is NonNullable<Trial["camera"]> => c != null);
      const avg = (pick: (c: NonNullable<Trial["camera"]>) => number | null) => {
        const v = cams.map(pick).filter((x): x is number => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      return { name, stats, bias, pitch: avg((c) => c.pitchProxy), dist: avg((c) => c.distanceProxy), elev: avg((c) => c.femurElevationDeg), roll: avg((c) => c.rollProxyDeg) };
    });
  }, [trials, side]);
  if (rows.length < 2) return null;
  return (
    <>
      <h3>Camera position comparison</h3>
      <table className="trials">
        <thead>
          <tr>
            <th>Series</th>
            <th>n</th>
            <th>Mean</th>
            <th>SD</th>
            <th>Bias</th>
            <th>Thigh/shank</th>
            <th>Size</th>
            <th>Elev.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.stats.n}</td>
              <td>{deg(r.stats.mean)}</td>
              <td>{deg(r.stats.sd, 2)}</td>
              <td>{signed(r.bias.bias)}</td>
              <td>{r.pitch == null ? "—" : r.pitch.toFixed(2)}</td>
              <td>{r.dist == null ? "—" : r.dist.toFixed(3)}</td>
              <td>{deg(r.elev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">If the mean or bias shifts with thigh/shank ratio or elevation, the error is camera-geometry driven (systematic), not random.</p>
    </>
  );
}

function repeatabilityVerdict(stats: Stats): { tone: "ok" | "warn" | "bad" | "none"; text: string } {
  if (stats.n < 2 || stats.sd == null || stats.range == null) return { tone: "none", text: "Capture at least 2 accepted trials to see repeatability." };
  const label = stats.n < 5 ? ` (${stats.n}/5 trials)` : "";
  if (stats.sd <= 1.5 && stats.range <= 4) return { tone: "ok", text: `Tight: SD ${stats.sd.toFixed(2)}°, range ${stats.range.toFixed(1)}°${label}` };
  if (stats.sd <= 3 && stats.range <= 8) return { tone: "warn", text: `Moderate: SD ${stats.sd.toFixed(2)}°, range ${stats.range.toFixed(1)}°${label}` };
  return { tone: "bad", text: `Loose: SD ${stats.sd.toFixed(2)}°, range ${stats.range.toFixed(1)}°${label}. Check soft warnings and setup.` };
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "strong" : ""}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function deg(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}°`;
}

function signed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function toCsv(trials: Trial[]): string {
  const header = [
    "series",
    "side",
    "trial",
    "timestamp",
    "accepted",
    "primary_method",
    "camera_deg",
    ...ANGLE_METHODS.map((m) => `${m}_deg`),
    "goniometer_deg",
    "signed_error_deg",
    "confidence",
    "hold_ms",
    "hold_frames",
    "hold_sd_deg",
    "hold_slope_deg_s",
    "outlier_frames",
    "raw_max_deg",
    "failed",
    "soft_warnings",
    "roll_proxy_deg",
    "facing_yaw_deg",
    "thigh_shank_ratio",
    "shank_frame_frac",
    "body_x",
    "body_y",
    "hang_deg",
    "femur_elevation_deg",
    "femur_azimuth_deg",
    "has_video",
  ];
  const n = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(d));
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = trials.map((t) =>
    [
      q(t.series),
      t.side,
      t.trialNumber,
      t.timestamp,
      t.accepted ? 1 : 0,
      t.primaryMethod,
      n(t.measuredRom),
      ...ANGLE_METHODS.map((m) => n(t.angles?.[m])),
      n(t.goniometer, 1),
      n(t.signedError),
      t.confidence,
      n(t.hold?.durationMs, 0),
      t.hold?.frames ?? "",
      n(t.hold?.sdDeg, 3),
      n(t.hold?.slopeDegPerSec, 3),
      t.hold?.outlierFrames ?? "",
      n(t.rawMaximum),
      q(t.failedConstraints.join("|")),
      q(Object.keys(t.hold?.softWarnings ?? {}).join("|")),
      n(t.camera?.rollProxyDeg),
      n(t.camera?.facingYawDeg),
      n(t.camera?.pitchProxy, 3),
      n(t.camera?.distanceProxy, 4),
      n(t.camera?.bodyX, 3),
      n(t.camera?.bodyY, 3),
      n(t.camera?.hangAbsoluteDeg),
      n(t.camera?.femurElevationDeg),
      n(t.camera?.femurAzimuthDeg),
      t.recording ? "yes" : "no",
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

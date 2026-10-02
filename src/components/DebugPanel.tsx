import { useRef, useState } from "react";
import {
  PROVISIONAL_QF_CONFIG,
  QF_CONFIG_FIELDS,
  QF_CONFIG_GROUPS,
  configExport,
  configImport,
  configProblems,
  normalizeConfig,
  type QFConfig,
} from "../qf/qfConfig";
import { ANGLE_METHODS, ANGLE_METHOD_INFO } from "../qf/qfMeasurementEngine";
import type { ConstraintCheck, QFSnapshot } from "../qf/qfTypes";
import type { RecorderStatus } from "../recording/trialRecorder";
import { download } from "../storage/trials";

type Props = {
  open: boolean;
  config: QFConfig;
  snapshot: QFSnapshot | null;
  recorder: RecorderStatus | null;
  preRollMs: number;
  postRollMs: number;
  onPreRoll: (ms: number) => void;
  onPostRoll: (ms: number) => void;
  onToggle: () => void;
  onChange: (config: QFConfig) => void;
};

const TABS = ["Diagnostics", "Constraints", "Filters", "Config"] as const;
type Tab = (typeof TABS)[number];
const FILTER_GROUPS = new Set(["Stable hold", "Smoothing & outliers", "Tracking confidence"]);

export function DebugPanel({ open, config, snapshot, recorder, preRollMs, postRollMs, onPreRoll, onPostRoll, onToggle, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>("Diagnostics");
  return (
    <section className="debug">
      <button type="button" className="debug-toggle" onClick={onToggle}>
        Developer / debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
          <p className="provisional">
            Development thresholds, not clinically validated. Hard checks reject a trial; soft checks only lower confidence and are saved with the trial.
          </p>
          <div className="tabs">
            {TABS.map((name) => (
              <button key={name} type="button" className={tab === name ? "on" : ""} onClick={() => setTab(name)}>
                {name}
              </button>
            ))}
          </div>
          <div hidden={tab !== "Diagnostics"}>
            <RecordingPanel recorder={recorder} preRollMs={preRollMs} postRollMs={postRollMs} onPreRoll={onPreRoll} onPostRoll={onPostRoll} />
            <StatePanel snapshot={snapshot} config={config} />
            <AnglesPanel snapshot={snapshot} />
            <HoldPanel snapshot={snapshot} />
            <TrackingPanel snapshot={snapshot} />
            <CameraPanel snapshot={snapshot} />
            <PelvisTranslationPanel snapshot={snapshot} />
          </div>
          <div hidden={tab !== "Constraints"}>
            <ChecksTable title="A · Setup (start gate)" checks={snapshot?.setupChecks ?? []} mode="setup" config={config} onChange={onChange} />
            <ChecksTable title="B–D · Measurement (vs baseline)" checks={snapshot?.checks ?? []} mode="measure" config={config} onChange={onChange} />
          </div>
          <div className="row" hidden={tab !== "Filters" && tab !== "Config"}>
            <button type="button" onClick={() => onChange(normalizeConfig(PROVISIONAL_QF_CONFIG))}>
              Reset to defaults
            </button>
            <button type="button" onClick={() => download(`qf-config-${stamp()}.json`, configExport(config))}>
              Export config
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              Import config
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  onChange(configImport(await file.text()));
                } catch {
                  alert("That file is not a QF lab config.");
                }
                event.target.value = "";
              }}
            />
          </div>
          <ul className="config-problems" hidden={tab !== "Config" || configProblems(config).length === 0}>
            {configProblems(config).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <div className="control-grid" hidden={tab !== "Filters" && tab !== "Config"}>
            {QF_CONFIG_GROUPS.filter((group) => (tab === "Filters" ? FILTER_GROUPS.has(group) : !FILTER_GROUPS.has(group))).map((group) => (
              <fieldset key={group}>
                <legend>{group}</legend>
                {QF_CONFIG_FIELDS.filter((field) => field.group === group).map((field) =>
                  field.kind === "select" ? (
                    <label key={field.key} className="slider">
                      <span>{field.label}</span>
                      <select value={config[field.key]} onChange={(event) => onChange({ ...config, [field.key]: event.target.value })}>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={field.key} className="slider">
                      <span>
                        {field.label}
                        <b>{formatField(field, config[field.key])}</b>
                      </span>
                      <input
                        type="range"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={config[field.key]}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next)) return;
                          onChange({ ...config, [field.key]: next });
                        }}
                      />
                    </label>
                  )
                )}
              </fieldset>
            ))}
          </div>
      </div>
    </section>
  );
}

function RecordingPanel({
  recorder,
  preRollMs,
  postRollMs,
  onPreRoll,
  onPostRoll,
}: {
  recorder: RecorderStatus | null;
  preRollMs: number;
  postRollMs: number;
  onPreRoll: (ms: number) => void;
  onPostRoll: (ms: number) => void;
}) {
  const phase = recorder?.phase ?? "off";
  const label = phase === "keep" || phase === "post" ? "Recording trial" : phase === "preroll" ? "Watching the start" : phase === "unavailable" ? "Unavailable" : "Idle";
  return (
    <div className="debug-block">
      <h3>Recording</h3>
      <dl className="readout">
        <Row label="Status" value={recorder?.message || label} />
        <Row label="Pose frames / second" value={recorder ? String(recorder.poseFps) : "—"} />
        <Row label="Recorded frames / second" value={recorder && phase !== "off" && phase !== "unavailable" ? String(recorder.recordFps) : "—"} />
        <Row label="Slow pose gaps (over 50 ms)" value={recorder ? String(recorder.slowFrames) : "—"} />
      </dl>
      <label className="slider">
        <span>
          Seconds of video before the movement
          <b>{(preRollMs / 1000).toFixed(1)} s</b>
        </span>
        <input type="range" min={0} max={3000} step={100} value={preRollMs} onChange={(event) => onPreRoll(Number(event.target.value))} />
      </label>
      <label className="slider">
        <span>
          Seconds of video after the result
          <b>{(postRollMs / 1000).toFixed(1)} s</b>
        </span>
        <input type="range" min={0} max={3000} step={100} value={postRollMs} onChange={(event) => onPostRoll(Number(event.target.value))} />
      </label>
    </div>
  );
}

function StatePanel({ snapshot, config }: { snapshot: QFSnapshot | null; config: QFConfig }) {
  const hard = snapshot?.checks.filter((c) => c.category === "hard" && c.status === "fail") ?? [];
  const soft = snapshot?.checks.filter((c) => c.category === "soft" && (c.status === "warn" || c.status === "fail")) ?? [];
  const blocking = snapshot?.setupChecks.filter((c) => c.blocking && c.status === "fail") ?? [];
  return (
    <div className="debug-block">
      <h3>State</h3>
      <dl className="readout">
        <Row label="Current state" value={snapshot?.state ?? "—"} />
        <Row label="Instruction" value={snapshot?.instruction ?? "—"} />
        <Row label="Baseline QF angle" value={deg(snapshot?.movement.baselineDeg)} />
        <Row label="Current QF angle" value={deg(snapshot?.primary.filtered)} />
        <Row label="Excursion from baseline" value={deg(snapshot?.movement.excursionDeg)} />
        <Row label="Angular velocity" value={snapshot?.movement.velocityDegPerSec == null ? "—" : `${snapshot.movement.velocityDegPerSec.toFixed(1)} °/s`} />
        <Row label="Movement start threshold" value={`${config.startMovementDeg.toFixed(1)}°`} />
        <Row label="Minimum excursion" value={`${config.minimumMovementExcursionDeg.toFixed(1)}°`} />
        <Row label="Movement started" value={snapshot ? (snapshot.movement.started ? "YES" : "NO") : "—"} />
        <Row label="Blocking setup fails" value={blocking.map((c) => c.label).join(", ") || "none"} />
        <Row label="Hard fails" value={hard.map((c) => c.label).join(", ") || "none"} />
        <Row label="Soft warnings" value={soft.map((c) => `${c.label} (${c.status})`).join(", ") || "none"} />
        <Row label="Confidence score" value={snapshot?.baseline ? String(snapshot.quality) : "—"} />
        <Row label="Result" value={snapshot?.result ? (snapshot.result.accepted ? "accepted" : `rejected: ${snapshot.result.failedConstraints.join(", ")}`) : "—"} />
      </dl>
    </div>
  );
}

function AnglesPanel({ snapshot }: { snapshot: QFSnapshot | null }) {
  const primary = snapshot?.primaryMethod;
  return (
    <div className="debug-block">
      <h3>Angles</h3>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Raw</th>
            <th>Clean</th>
            <th>Filtered</th>
            <th>Stable</th>
            <th>Final</th>
          </tr>
        </thead>
        <tbody>
          {ANGLE_METHODS.map((method) => (
            <tr key={method} className={method === primary ? "primary-row" : ""} title={ANGLE_METHOD_INFO[method].note}>
              <td>
                {ANGLE_METHOD_INFO[method].label}
                {method === primary ? " ★" : ""}
              </td>
              <td>{deg(snapshot?.angles.raw[method])}</td>
              <td>{deg(snapshot?.angles.clean[method])}</td>
              <td>{deg(snapshot?.angles.filtered[method])}</td>
              <td>{method === primary ? deg(snapshot?.primary.stable) : "—"}</td>
              <td>{deg(snapshot?.result?.angles[method])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Raw: unfiltered MediaPipe. Clean: spike-gated landmarks, outlier-tested angle. Filtered: smoothed (drives state). Stable: median of the current hold run. Final: median of clean
        frames in the accepted hold. ★ is the primary method.
      </p>
    </div>
  );
}

function HoldPanel({ snapshot }: { snapshot: QFSnapshot | null }) {
  const h = snapshot?.hold;
  const s = snapshot?.calibrationStillness;
  return (
    <div className="debug-block">
      <h3>Hold & calibration</h3>
      <dl className="readout">
        <Row label="Hold run" value={h ? `${Math.round(h.runMs)} ms · ${h.runFrames} frames` : "—"} />
        <Row label="Run range" value={h ? `${h.rangeDeg.toFixed(2)}°` : "—"} />
        <Row label="Run drift" value={h?.slopeDegPerSec != null ? `${h.slopeDegPerSec.toFixed(2)} °/s ${h.slopeOk ? "ok" : "too fast"}` : "—"} />
        <Row label="Attempt peak (filtered)" value={deg(h?.peakDeg)} />
        <Row label="Near end range" value={h ? (h.nearPeak ? "yes" : "no") : "—"} />
        <Row label="Hold progress" value={h ? `${Math.round(h.progress * 100)}%` : "—"} />
        <Row label="Raw maximum (never used)" value={deg(snapshot?.result?.rawMaximum)} />
        <Row label="Calibration" value={snapshot ? `${Math.round(snapshot.calibrationProgress * 100)}%` : "—"} />
        <Row label="Calibration shank SD" value={s ? `${s.shankSdDeg.toFixed(2)}°` : "—"} />
        <Row label="Calibration jitter (pelvis/knee/ankle)" value={s ? `${s.pelvisJitter.toFixed(3)} / ${s.kneeJitter.toFixed(3)} / ${s.ankleJitter.toFixed(3)}` : "—"} />
      </dl>
    </div>
  );
}

function TrackingPanel({ snapshot }: { snapshot: QFSnapshot | null }) {
  const t = snapshot?.tracking;
  return (
    <div className="debug-block">
      <h3>Tracking confidence</h3>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Conf.</th>
            <th>Min</th>
            <th>In frame</th>
            <th>Weak for</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(t?.groups ?? []).map((g) => (
            <tr key={g.id}>
              <td>
                {g.label}
                {g.critical ? " (critical)" : ""}
              </td>
              <td>{g.confidence.toFixed(2)}</td>
              <td>{g.threshold.toFixed(2)}</td>
              <td>{g.inFrame ? "yes" : "no"}</td>
              <td>{g.badMs > 0 ? `${Math.round(g.badMs)} ms` : "—"}</td>
              <td className={`st-${g.ok ? "pass" : "fail"}`}>{g.ok ? "PASS" : "FAIL"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="readout">
        <Row label="Tracking score" value={t ? t.score.toFixed(2) : "—"} />
        <Row label="Landmark spikes rejected (total)" value={String(snapshot?.filterStats.rejectedLandmarks ?? 0)} />
        <Row label="Landmark re-acquires" value={String(snapshot?.filterStats.reacquired ?? 0)} />
        <Row label="Angle outliers rejected" value={String(snapshot?.filterStats.angleOutliers ?? 0)} />
      </dl>
    </div>
  );
}

function CameraPanel({ snapshot }: { snapshot: QFSnapshot | null }) {
  const m = snapshot?.metrics;
  const cam = snapshot?.baseline?.camera;
  return (
    <div className="debug-block">
      <h3>Camera / body</h3>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Live</th>
            <th>Baseline</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Hip line tilt (roll proxy)</td>
            <td>{deg(m?.hipLineTiltDeg)}</td>
            <td>{deg(cam?.rollProxyDeg)}</td>
          </tr>
          <tr>
            <td>Torso from vertical</td>
            <td>{deg(m?.torsoFromVerticalDeg)}</td>
            <td>{deg(cam?.torsoFromVerticalDeg)}</td>
          </tr>
          <tr>
            <td>Facing yaw (world hips)</td>
            <td>{deg(m?.facingYawDeg)}</td>
            <td>{deg(cam?.facingYawDeg)}</td>
          </tr>
          <tr>
            <td>Thigh/shank image ratio (height proxy)</td>
            <td>{num(m?.pitchProxy)}</td>
            <td>{num(cam?.pitchProxy)}</td>
          </tr>
          <tr>
            <td>Shank / frame height (distance proxy)</td>
            <td>{num(m?.shankFrac)}</td>
            <td>{num(cam?.distanceProxy)}</td>
          </tr>
          <tr>
            <td>Body position x / y</td>
            <td>{m?.bodyX != null ? `${m.bodyX.toFixed(2)} / ${m.bodyY?.toFixed(2)}` : "—"}</td>
            <td>{cam ? `${cam.bodyX.toFixed(2)} / ${cam.bodyY.toFixed(2)}` : "—"}</td>
          </tr>
          <tr>
            <td>Shank hang from image vertical</td>
            <td>{deg(m?.absoluteShankDeg)}</td>
            <td>{deg(cam?.hangAbsoluteDeg)}</td>
          </tr>
          <tr>
            <td>Camera elevation vs femur (world)</td>
            <td>—</td>
            <td>{deg(cam?.femurElevationDeg)}</td>
          </tr>
          <tr>
            <td>Camera azimuth vs femur (world)</td>
            <td>—</td>
            <td>{deg(cam?.femurAzimuthDeg)}</td>
          </tr>
          <tr>
            <td>World knee flexion</td>
            <td>{deg(m?.worldKneeFlexionDeg)}</td>
            <td>
              {deg(snapshot?.baseline?.worldKneeFlexionDeg)}
              {snapshot?.baseline ? (snapshot.baseline.worldFlexionTrusted ? " (trusted)" : " (untrusted)") : ""}
            </td>
          </tr>
          <tr>
            <td>Swing plane available</td>
            <td>—</td>
            <td>{snapshot?.baseline ? (snapshot.baseline.angleRef.plane ? "yes" : "no (femur side-on)") : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ChecksTable({
  title,
  checks,
  mode,
  config,
  onChange,
}: {
  title: string;
  checks: ConstraintCheck[];
  mode: "setup" | "measure";
  config: QFConfig;
  onChange: (config: QFConfig) => void;
}) {
  const toggleHard = (id: string, hard: boolean) => {
    const set = new Set(config.hardConstraints);
    if (hard) set.add(id);
    else set.delete(id);
    onChange({ ...config, hardConstraints: [...set] });
  };
  return (
    <div className="debug-block">
      <h3>{title}</h3>
      {checks.length === 0 ? (
        <p className="muted small">{mode === "measure" ? "Available after calibration." : "Waiting for a person."}</p>
      ) : (
        <table className="debug-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Current</th>
              <th>Warn</th>
              <th>Fail</th>
              <th>Status</th>
              <th>{mode === "setup" ? "Blocks" : "Hard"}</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.id} title={check.message}>
                <td>{check.label}</td>
                <td>{fmtCheck(check.value, check.unit)}</td>
                <td>{fmtLimit(check.warn, check.direction, check.unit)}</td>
                <td>{fmtLimit(check.fail, check.direction, check.unit)}</td>
                <td className={`st-${check.status}`}>{check.status.toUpperCase()}</td>
                <td>
                  {mode === "setup" ? (
                    check.blocking ? "yes" : "advisory"
                  ) : check.category === "info" ? (
                    "info"
                  ) : (
                    <input type="checkbox" checked={check.category === "hard"} onChange={(event) => toggleHard(check.id, event.target.checked)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PelvisTranslationPanel({ snapshot }: { snapshot: QFSnapshot | null }) {
  const metrics = snapshot?.metrics;
  const check = snapshot?.checks.find((item) => item.id === "pelvis-translation");
  const baseline = snapshot?.baseline;
  const center = metrics?.pelvisCenter;
  return (
    <div className="debug-block">
      <h3>Pelvis translation</h3>
      <dl className="readout">
        <Row label="Raw displacement" value={metrics?.pelvisShiftPx == null ? "—" : `${metrics.pelvisShiftPx.toFixed(1)} px`} />
        <Row label="Raw ratio" value={pct(metrics?.pelvisTranslationRaw)} />
        <Row label="Normalized" value={pct(metrics?.pelvisTranslation)} />
        <Row label="Baseline pelvis X/Y" value={baseline ? `${baseline.midHip.x.toFixed(0)}, ${baseline.midHip.y.toFixed(0)}` : "—"} />
        <Row label="Current pelvis X/Y" value={center ? `${center.x.toFixed(0)}, ${center.y.toFixed(0)}` : "—"} />
        <Row label="Reference body scale" value={baseline ? `${baseline.hipWidthPx.toFixed(0)} px hip width` : "—"} />
        <Row label="Warning threshold" value={pct(check?.warn)} />
        <Row label="Fail threshold" value={pct(check?.fail)} />
        <Row label="Current status" value={check ? check.status.toUpperCase() : "—"} />
      </dl>
    </div>
  );
}

function formatField(field: { unit: string }, value: number): string {
  if (field.unit === "% of hip width") return `${(value * 100).toFixed(0)}% of hip width`;
  return `${value} ${field.unit}`.trim();
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtCheck(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (unit === "% hip") return `${(value * 100).toFixed(1)}%`;
  const digits = unit === "deg" ? 1 : 3;
  return `${value.toFixed(digits)}${unit === "deg" ? "°" : unit ? ` ${unit}` : ""}`;
}

function fmtLimit(value: number | null, direction: "max" | "min", unit: string): string {
  if (value == null) return "—";
  const shown = unit === "% hip" ? `${(value * 100).toFixed(0)}%` : Number(value.toFixed(3)).toString();
  return `${direction === "max" ? ">" : "<"} ${shown}`;
}

function deg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}°`;
}

function num(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(3);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

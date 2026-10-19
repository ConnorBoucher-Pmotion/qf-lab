import { useRef, useState } from "react";
import {
  SR_CONFIG,
  SR_CONFIG_FIELDS,
  SR_CONFIG_GROUPS,
  configExport,
  configImport,
  configProblems,
  normalizeConfig,
  type ConfigField,
  type SRConfig,
} from "../sr/srConfig";
import type { SRSnapshot } from "../sr/srTypes";
import type { RecorderStatus } from "../recording/trialRecorder";
import { download } from "../storage/trials";

type Props = {
  open: boolean;
  config: SRConfig;
  snapshot: SRSnapshot | null;
  recorder: RecorderStatus | null;
  preRollMs: number;
  postRollMs: number;
  onPreRoll: (ms: number) => void;
  onPostRoll: (ms: number) => void;
  onToggle: () => void;
  onChange: (config: SRConfig) => void;
};

export function DebugPanel({ open, config, snapshot, recorder, preRollMs, postRollMs, onToggle, onChange, onPreRoll, onPostRoll }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<"Diagnostics" | "Config">("Diagnostics");
  const problems = configProblems(config);
  const metrics = snapshot?.metrics;
  return (
    <section className="debug">
      <button type="button" className="debug-toggle" onClick={onToggle}>
        Developer / debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
        <p className="provisional">Development thresholds, not clinically validated. Changing a value updates the next frame of the live assessment.</p>
        <p className="muted small">{snapshot?.cameraNote}</p>
        <div className="tabs">
          {(["Diagnostics", "Config"] as const).map((name) => (
            <button key={name} type="button" className={tab === name ? "on" : ""} onClick={() => setTab(name)}>
              {name}
            </button>
          ))}
        </div>
        {tab === "Diagnostics" ? (
          <>
            <h3>Live</h3>
            <dl className="readout">
              <Item label="State" value={snapshot?.state ?? "—"} />
              <Item label="Why it is not advancing" value={snapshot?.blockedBy ?? "—"} />
              <Item label="Calibration complete" value={yesNo(snapshot?.calibrationComplete)} />
              <Item label="Assessment armed" value={yesNo(snapshot?.assessmentArmed)} />
              <Item label="Movement started" value={yesNo(snapshot?.movementStarted)} />
              <Item label="Countdown" value={snapshot?.countdownLabel ?? "—"} />
              <Item label="Capture window" value={snapshot ? `${config.captureWindowMs} ms` : "—"} />
              <Item label="Thumbs-up hold" value={snapshot ? `${config.thumbStableMs} ms` : "—"} />
              <Item label="Camera stream" value={snapshot?.cameraActive ? "ACTIVE" : "INACTIVE"} />
              <Item label="MediaPipe frame loop" value={snapshot?.poseLoop === "active" ? "ACTIVE" : "STOPPED"} />
              <Item label="Frame rate" value={snapshot ? String(snapshot.fps) : "—"} />
              <Item label="Record" value={recorder ? `${recorder.phase} · pose ${recorder.poseFps} · video ${recorder.recordFps}` : "—"} />
              <Item label="Left Shoulder Abduction" value={deg(metrics?.left.abductionDeg)} />
              <Item label="Right Shoulder Abduction" value={deg(metrics?.right.abductionDeg)} />
              <Item label="Left Elbow Flexion" value={deg(metrics?.left.elbowFlexionDeg)} />
              <Item label="Right Elbow Flexion" value={deg(metrics?.right.elbowFlexionDeg)} />
              <Item label="Left Forearm Rotation" value={deg(metrics?.left.signedRotationDeg)} />
              <Item label="Right Forearm Rotation" value={deg(metrics?.right.signedRotationDeg)} />
              <Item label="Torso Lean (lateral)" value={deg(metrics?.lateralLeanDeg)} />
              <Item label="Torso Lean (forward)" value={deg(metrics?.forwardLeanDeg)} />
              <Item label="Shoulder Height Difference" value={pct(metrics?.shoulderHeightDiff)} />
              <Item label="Left Elbow Height Diff" value={deg(metrics?.left.elbowHeightDiff)} />
              <Item label="Right Elbow Height Diff" value={deg(metrics?.right.elbowHeightDiff)} />
              <Item label="Left Elbow Drift" value={pct(metrics?.left.elbowDriftPct)} />
              <Item label="Right Elbow Drift" value={pct(metrics?.right.elbowDriftPct)} />
              <Item label="Left Shoulder Shrug" value={pct(metrics?.left.shoulderShrugPct)} />
              <Item label="Right Shoulder Shrug" value={pct(metrics?.right.shoulderShrugPct)} />
              <Item label="Tracking Confidence" value={snapshot ? `${snapshot.trackingBand.toUpperCase()} (${snapshot.trackingScore}%)` : "—"} />
              <Item label="Left Raw ER / IR" value={`${deg(snapshot?.left.rawEr)} / ${deg(snapshot?.left.rawIr)}`} />
              <Item label="Left Validated ER / IR" value={`${deg(snapshot?.left.validEr)} / ${deg(snapshot?.left.validIr)}`} />
              <Item label="Right Raw ER / IR" value={`${deg(snapshot?.right.rawEr)} / ${deg(snapshot?.right.rawIr)}`} />
              <Item label="Right Validated ER / IR" value={`${deg(snapshot?.right.validEr)} / ${deg(snapshot?.right.validIr)}`} />
              <Item label="Left Raw / Valid Arc" value={`${deg(snapshot?.left.rawArc)} / ${deg(snapshot?.left.validArc)}`} />
              <Item label="Right Raw / Valid Arc" value={`${deg(snapshot?.right.rawArc)} / ${deg(snapshot?.right.validArc)}`} />
              <Item label="Asymmetry" value={deg(snapshot?.asymmetryDeg)} />
              <Item label="MOVEMENT VALIDITY" value={snapshot?.movementStarted ? (snapshot.movementValid ? "PASS" : "FAIL") : "—"} />
              <Item label="Rejected" value={snapshot?.rejectReason || "—"} />
              <Item label="Rejected frame count" value={snapshot ? String(snapshot.rejectedFrameCount) : "—"} />
              <Item label="Valid frame count" value={snapshot ? String(snapshot.validFrameCount) : "—"} />
              <Item label="Left shoulder visibility" value={num(snapshot?.leftShoulderVisibility)} />
              <Item label="Right shoulder visibility" value={num(snapshot?.rightShoulderVisibility)} />
              <Item label="Left elbow visibility" value={num(snapshot?.leftElbowVisibility)} />
              <Item label="Right elbow visibility" value={num(snapshot?.rightElbowVisibility)} />
              <Item label="Left wrist visibility" value={num(snapshot?.leftWristVisibility)} />
              <Item label="Right wrist visibility" value={num(snapshot?.rightWristVisibility)} />
              <Item label="Left hip visibility" value={num(snapshot?.leftHipVisibility)} />
              <Item label="Right hip visibility" value={num(snapshot?.rightHipVisibility)} />
              <Item label="Time left" value={snapshot?.captureRemainingMs == null ? "—" : `${Math.round(snapshot.captureRemainingMs)} ms`} />
              <Item label="Thumbs-up progress" value={snapshot ? `${Math.round(snapshot.thumbProgress * 100)}%` : "—"} />
              <Item label="Face camera score" value={deg(snapshot?.cameraFacing.scoreDeg)} />
              <Item label="Face camera status" value={snapshot?.cameraFacing.status ?? "—"} />
              <Item label="Pre-roll" value={`${preRollMs} ms`} />
              <Item label="Post-roll" value={`${postRollMs} ms`} />
            </dl>
            <h3>Landmarks</h3>
            <dl className="readout">
              <VecItem label="Left shoulder" point={metrics?.leftShoulder} />
              <VecItem label="Right shoulder" point={metrics?.rightShoulder} />
              <VecItem label="Left elbow" point={metrics?.leftElbow} />
              <VecItem label="Right elbow" point={metrics?.rightElbow} />
              <VecItem label="Left wrist" point={metrics?.leftWrist} />
              <VecItem label="Right wrist" point={metrics?.rightWrist} />
              <VecItem label="Left hip" point={metrics?.leftHip} />
              <VecItem label="Right hip" point={metrics?.rightHip} />
              <VecItem label="Shoulder midpoint" point={metrics?.shoulderMid} />
              <VecItem label="Hip midpoint" point={metrics?.hipMid} />
            </dl>
            <label className="slider">
              <span>
                Video pre-roll <b>{preRollMs} ms</b>
              </span>
              <input type="range" min={0} max={4000} step={100} value={preRollMs} onChange={(event) => onPreRoll(Number(event.target.value))} />
            </label>
            <label className="slider">
              <span>
                Video post-roll <b>{postRollMs} ms</b>
              </span>
              <input type="range" min={0} max={3000} step={100} value={postRollMs} onChange={(event) => onPostRoll(Number(event.target.value))} />
            </label>
          </>
        ) : (
          <>
            {problems.length > 0 ? (
              <ul className="config-problems">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {SR_CONFIG_GROUPS.map((group) => (
              <fieldset key={group}>
                <legend>{group}</legend>
                {SR_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                  <Field key={field.key} field={field} config={config} onChange={onChange} />
                ))}
              </fieldset>
            ))}
            <div className="row wrap">
              <button type="button" onClick={() => onChange(normalizeConfig(SR_CONFIG))}>
                Reset defaults
              </button>
              <button type="button" onClick={() => download("shoulder-rotation-config.json", configExport(config))}>
                Export
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}>
                Import
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => onChange(configImport(text)));
                }}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Field({ field, config, onChange }: { field: ConfigField; config: SRConfig; onChange: (config: SRConfig) => void }) {
  if (field.kind === "toggle") {
    return (
      <label className="slider">
        <span>{field.label}</span>
        <input type="checkbox" checked={config[field.key]} onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: event.target.checked }))} />
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="slider">
        <span>{field.label}</span>
        <select value={String(config[field.key])} onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: event.target.value }))}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const value = config[field.key];
  return (
    <label className="slider">
      <span>
        {field.label}{" "}
        <b>
          {typeof value === "number" ? trim(value) : value} {field.unit}
        </b>
      </span>
      <input type="range" min={field.min} max={field.max} step={field.step} value={value} onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: Number(event.target.value) }))} />
    </label>
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

function VecItem({ label, point }: { label: string; point: { x: number; y: number; z: number; visibility?: number } | null | undefined }) {
  const value = point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}` : "—";
  return <Item label={label} value={value} />;
}

function yesNo(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "YES" : "NO";
}

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}°`;
}
function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}
function num(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(2);
}
function trim(value: number): string {
  return Number(value.toFixed(3)).toString();
}

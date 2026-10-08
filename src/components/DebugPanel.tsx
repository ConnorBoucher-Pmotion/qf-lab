import { useRef, useState } from "react";
import { ALGORITHM_INFO } from "../tl/tlRotation";
import {
  TL_CONFIG,
  TL_CONFIG_FIELDS,
  TL_CONFIG_GROUPS,
  configExport,
  configImport,
  configProblems,
  normalizeConfig,
  type ConfigField,
  type TLConfig,
} from "../tl/tlConfig";
import type { TLSnapshot } from "../tl/tlTypes";
import type { RecorderStatus } from "../recording/trialRecorder";
import { download } from "../storage/trials";

type Props = {
  open: boolean;
  config: TLConfig;
  snapshot: TLSnapshot | null;
  recorder: RecorderStatus | null;
  preRollMs: number;
  postRollMs: number;
  onPreRoll: (ms: number) => void;
  onPostRoll: (ms: number) => void;
  onToggle: () => void;
  onChange: (config: TLConfig) => void;
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
              <Item label="Active trial tracking" value={yesNo(snapshot?.movementStarted && !snapshot.result && snapshot.state !== "READY")} />
              <Item label="Rotation from neutral" value={deg(snapshot?.rom.filtered)} />
              <Item label="Countdown" value={snapshot?.countdownLabel ?? "—"} />
              <Item label="Minimum ROM to complete" value={snapshot ? `${config.minPeakRomDeg}°` : "—"} />
              <Item label="Minimum active time" value={snapshot ? `${config.minActiveMs} ms` : "—"} />
              <Item label="Camera stream" value={snapshot?.cameraActive ? "ACTIVE" : "INACTIVE"} />
              <Item label="MediaPipe frame loop" value={snapshot?.poseLoop === "active" ? "ACTIVE" : "STOPPED"} />
              <Item label="Last pose frame" value={snapshot?.lastPoseAt == null ? "—" : `${Math.round(snapshot.lastPoseAt)} ms`} />
              <Item label="Algorithm" value={snapshot ? ALGORITHM_INFO[snapshot.algorithm].label : "—"} />
              <Item label="Frame rate" value={snapshot ? String(snapshot.fps) : "—"} />
              <Item label="Record" value={recorder ? `${recorder.phase} · pose ${recorder.poseFps} · video ${recorder.recordFps}` : "—"} />
              <Item label="Raw rotation" value={deg(snapshot?.rom.raw)} />
              <Item label="Landmark-smoothed rotation" value={deg(snapshot?.rom.landmarkSmoothed)} />
              <Item label="Filtered rotation" value={deg(snapshot?.rom.filtered)} />
              <Item label="Raw peak" value={deg(snapshot?.movementStarted ? snapshot.rom.rawPeak : null)} />
              <Item label="Filtered peak" value={deg(snapshot?.movementStarted ? snapshot.rom.filteredPeak : null)} />
              <Item label="Valid peak" value={deg(snapshot?.movementStarted ? snapshot.rom.validPeak : null)} />
              <Item label="Neutral shoulder yaw" value={deg(snapshot?.neutralShoulderYawDeg)} />
              <Item label="Neutral pelvis yaw" value={deg(snapshot?.neutralPelvisYawDeg)} />
              <Item label="Shoulder width ratio" value={snapshot?.shoulderSpanRatio == null ? "—" : snapshot.shoulderSpanRatio.toFixed(3)} />
              <Item label="Image shoulder yaw" value={deg(snapshot?.imageShoulderYawDeg)} />
              <Item label="Image width yaw" value={deg(snapshot?.imageWidthDeg)} />
              <Item label="Velocity" value={metrics?.velocityDegPerSec == null ? "—" : `${metrics.velocityDegPerSec.toFixed(1)} °/s`} />
              <Item label="Shoulder yaw" value={deg(metrics?.shoulderYawDeg)} />
              <Item label="Pelvis yaw" value={deg(metrics?.pelvisYawDeg)} />
              <Item label="Face camera score" value={deg(snapshot?.cameraFacing.scoreDeg)} />
              <Item label="Face camera status" value={snapshot?.cameraFacing.status ?? "—"} />
              <Item label="Shoulder axis off camera" value={deg(snapshot?.cameraFacing.shoulderYawDeg)} />
              <Item label="Hip axis off camera" value={deg(snapshot?.cameraFacing.hipYawDeg)} />
              <Item label="Shoulder Z difference" value={num(snapshot?.cameraFacing.shoulderZDiff)} />
              <Item label="Hip Z difference" value={num(snapshot?.cameraFacing.hipZDiff)} />
              <Item label="Head yaw" value={deg(metrics?.headYawDeg)} />
              <Item label="A current / legacy" value={deg(metrics?.algorithms.legacy)} />
              <Item label="B 3D shoulder yaw" value={deg(metrics?.algorithms.shoulderYaw)} />
              <Item label="C shoulder vs pelvis" value={deg(metrics?.algorithms.torsoPelvis)} />
              <Item label="D depth / width" value={deg(metrics?.algorithms.depthWidth)} />
              <Item label="2D line delta (not ROM)" value={deg(metrics?.imageLineDeltaDeg)} />
              <Item label="Pelvis rotation" value={deg(metrics?.pelvisRotationDeg)} />
              <Item label="Pelvis translation" value={pct(metrics?.pelvisTranslationPct)} />
              <Item label="Lateral lean" value={deg(metrics?.lateralLeanDeg)} />
              <Item label="Forward lean" value={deg(metrics?.forwardLeanDeg)} />
              <Item label="Knee shift" value={pct(metrics?.kneeShiftPct)} />
              <Item label="Hip shift" value={pct(metrics?.hipShiftPct)} />
              <Item label="Shoulder tilt" value={deg(metrics?.shoulderTiltDeg)} />
              <Item label="Head vs torso" value={deg(metrics?.headLeadDeg)} />
              <Item label="Shoulder confidence" value={num(snapshot?.tracking.shoulders)} />
              <Item label="Hip confidence" value={num(snapshot?.tracking.hips)} />
              <Item label="Knee confidence" value={num(snapshot?.tracking.knees)} />
              <Item label="Pre-roll" value={`${preRollMs} ms`} />
              <Item label="Post-roll" value={`${postRollMs} ms`} />
            </dl>
            <h3>Landmarks</h3>
            <dl className="readout">
              <VecItem label="Left shoulder" point={metrics?.leftShoulder} />
              <VecItem label="Right shoulder" point={metrics?.rightShoulder} />
              <VecItem label="Left hip" point={metrics?.leftHip} />
              <VecItem label="Right hip" point={metrics?.rightHip} />
              <VecItem label="Shoulder midpoint" point={metrics?.shoulderMid} />
              <VecItem label="Hip midpoint" point={metrics?.hipMid} />
              <VecItem label="Shoulder vector" point={metrics?.shoulderVector} />
              <VecItem label="Pelvis vector" point={metrics?.pelvisVector} />
              <VecItem label="Image left shoulder" point={metrics?.imageLeftShoulder} />
              <VecItem label="Image right shoulder" point={metrics?.imageRightShoulder} />
              <VecItem label="Image left hip" point={metrics?.imageLeftHip} />
              <VecItem label="Image right hip" point={metrics?.imageRightHip} />
            </dl>
            <p className="muted small">{snapshot ? ALGORITHM_INFO[snapshot.algorithm].note : ""}</p>
            <label className="slider">
              <span>Video pre-roll <b>{preRollMs} ms</b></span>
              <input type="range" min={0} max={4000} step={100} value={preRollMs} onChange={(event) => onPreRoll(Number(event.target.value))} />
            </label>
            <label className="slider">
              <span>Video post-roll <b>{postRollMs} ms</b></span>
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
            {TL_CONFIG_GROUPS.map((group) => (
              <fieldset key={group}>
                <legend>{group}</legend>
                {TL_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                  <Field key={field.key} field={field} config={config} onChange={onChange} />
                ))}
              </fieldset>
            ))}
            <div className="row wrap">
              <button type="button" onClick={() => onChange(normalizeConfig(TL_CONFIG))}>
                Reset defaults
              </button>
              <button type="button" onClick={() => download("tl-junction-config.json", configExport(config))}>
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

function Field({ field, config, onChange }: { field: ConfigField; config: TLConfig; onChange: (config: TLConfig) => void }) {
  if (field.kind === "toggle") {
    return (
      <label className="slider">
        <span>{field.label}</span>
        <input
          type="checkbox"
          checked={config[field.key]}
          onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: event.target.checked }))}
        />
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="slider">
        <span>{field.label}</span>
        <select
          value={String(config[field.key])}
          onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: event.target.value }))}
        >
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
        {field.label} <b>{typeof value === "number" ? trim(value) : value} {field.unit}</b>
      </span>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(event) => onChange(normalizeConfig({ ...config, [field.key]: Number(event.target.value) }))}
      />
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

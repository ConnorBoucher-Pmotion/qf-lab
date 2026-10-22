import { cameraModeLabel } from "./config";
import type { ObliqueSnapshot } from "./types";

type Props = {
  open: boolean;
  onToggle: () => void;
  snapshot: ObliqueSnapshot | null;
};

export function ObliqueDebugPanel({ open, onToggle, snapshot }: Props) {
  const f = snapshot?.frame;
  return (
    <section className="debug">
      <button type="button" className="debug-toggle" onClick={onToggle}>
        Developer / debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
        <p className="provisional">Experimental 45° oblique pipeline. Primary result = RAW MAX shoulder XZ yaw vs sealed neutral. Thoracic kept for comparison. Not clinically validated.</p>
        <h3>ROM pipeline</h3>
        <dl className="readout">
          <Item label="Camera Mode" value={snapshot ? cameraModeLabel(snapshot.cameraMode) : "—"} />
          <Item label="State" value={snapshot?.state ?? "—"} />
          <Item label="Direction" value={snapshot ? snapshot.direction.toUpperCase() : "—"} />
          <Item label="CURRENT RAW ROM" value={deg(snapshot?.rawRom)} />
          <Item label="RAW MAX ROM (result)" value={deg(snapshot?.maxRawRom)} />
          <Item label="FILTERED ROM" value={deg(snapshot?.filteredRom)} />
          <Item label="MAX VALIDATED (debug)" value={deg(snapshot?.maxValidRom)} />
          <Item label="Baseline sealed" value={yesNo(f?.baselineSealed)} />
          <Item label="Frame valid" value={f?.frameValid.toUpperCase() ?? "—"} />
          <Item label="Reject reason" value={f?.rejectReason || "—"} />
          <Item label="Measurement confidence" value={snapshot ? `${snapshot.measurementConfidence}%` : "—"} />
          <Item label="Occlusion mode" value={f?.occlusionMode ?? "—"} />
          <Item label="Occlusion active" value={yesNo(f?.occlusionActive)} />
          <Item label="Reliable shoulder" value={f?.reliableShoulder?.toUpperCase() ?? "—"} />
          <Item label="Left reconstructed" value={yesNo(f?.leftReconstructed)} />
          <Item label="Right reconstructed" value={yesNo(f?.rightReconstructed)} />
        </dl>
        <h3>Landmarks (world)</h3>
        <dl className="readout">
          <Item label="Left shoulder xyz" value={xyz(f?.leftShoulder)} />
          <Item label="Left shoulder confidence" value={num(f?.leftShoulderConfidence)} />
          <Item label="Right shoulder xyz" value={xyz(f?.rightShoulder)} />
          <Item label="Right shoulder confidence" value={num(f?.rightShoulderConfidence)} />
          <Item label="Left hip xyz" value={xyz(f?.leftHip)} />
          <Item label="Left hip confidence" value={num(f?.leftHipConfidence)} />
          <Item label="Right hip xyz" value={xyz(f?.rightHip)} />
          <Item label="Right hip confidence" value={num(f?.rightHipConfidence)} />
          <Item label="Neutral shoulder vector" value={v3(f?.neutralShoulderVector)} />
          <Item label="Current shoulder vector" value={v3(f?.currentShoulderVector)} />
          <Item label="Neutral hip vector" value={v3(f?.neutralHipVector)} />
          <Item label="Current hip vector" value={v3(f?.currentHipVector)} />
          <Item label="Live shoulder yaw" value={deg(f?.liveShoulderYawDeg)} />
          <Item label="Neutral shoulder yaw (sealed)" value={deg(f?.neutralShoulderYawDeg)} />
          <Item label="RAW SHOULDER ROTATION" value={deg(f?.shoulderRotationDeg)} />
          <Item label="PELVIS ROTATION" value={deg(f?.pelvisRotationDeg)} />
          <Item label="THORACIC ROTATION" value={deg(f?.thoracicRotationDeg)} />
        </dl>
        <h3>Comparison log</h3>
        <dl className="readout">
          <Item label="Left ROM" value={deg(snapshot?.comparison?.leftRom)} />
          <Item label="Right ROM" value={deg(snapshot?.comparison?.rightRom)} />
          <Item label="Invalid frame %" value={snapshot?.comparison ? `${snapshot.comparison.invalidFramePct}%` : "—"} />
          <Item label="Occlusion events" value={snapshot?.comparison ? String(snapshot.comparison.shoulderOcclusionEvents) : "—"} />
          <Item label="Max pelvis rotation" value={deg(snapshot?.comparison?.maxPelvisRotationDeg)} />
          <Item label="Pose confidence" value={snapshot?.comparison ? `${snapshot.comparison.poseConfidence}%` : "—"} />
        </dl>
      </div>
    </section>
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

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}°`;
}
function num(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(3);
}
function yesNo(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "YES" : "NO";
}
function xyz(point: { x: number; y: number; z: number } | null | undefined): string {
  return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}` : "—";
}
function v3(point: { x: number; y: number; z: number } | null | undefined): string {
  return xyz(point);
}

import { cameraModeLabel } from "./config";
import type { ObliqueSnapshot } from "./types";

type Props = {
  open: boolean;
  onToggle: () => void;
  snapshot: ObliqueSnapshot | null;
};

export function ObliqueDebugPanel({ open, onToggle, snapshot }: Props) {
  const f = snapshot?.frame;
  const trial = snapshot?.direction === "left" ? "LEFT ROTATION" : "RIGHT ROTATION";
  const primary = (f?.primaryLandmark ?? "—").toUpperCase();
  const comparison = (f?.comparisonLandmark ?? "—").toUpperCase();
  return (
    <section className="debug">
      <button type="button" className="debug-toggle" onClick={onToggle}>
        Developer / debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
        <p className="provisional">
          45° experiment · side-specific primary shoulder arc around hip pivot (world XZ) · READY = hard 0° · comparison
          shoulder never averaged into Raw Max · no physiological clamp.
        </p>
        <h3>Trial</h3>
        <dl className="readout">
          <Item label="CAMERA MODE" value={snapshot ? cameraModeLabel(snapshot.cameraMode).toUpperCase() : "—"} />
          <Item label="STATE" value={snapshot?.state ?? "—"} />
          <Item label="TRIAL" value={trial} />
          <Item label="PRIMARY LANDMARK" value={`${primary} SHOULDER`} />
          <Item label="PRIMARY CONFIDENCE" value={pct(f?.primaryConfidence)} />
          <Item label="STARTING PRIMARY ANGLE" value={deg(f?.startingPrimaryAngleDeg)} />
          <Item label="CURRENT PRIMARY ANGLE" value={deg(f?.currentPrimaryAngleDeg)} />
          <Item label="PRIMARY CHANGE FROM BASELINE" value={deg(f?.primaryChangeFromBaselineDeg)} />
          <Item label={`${comparison} SHOULDER COMPARISON`} value={deg(f?.comparisonChangeDeg)} />
          <Item label="PELVIS ROTATION" value={deg(f?.pelvisRotationDeg)} />
          <Item label="PELVIS SUBTRACT (deadband)" value={deg(f?.pelvisSubtractDeg)} />
          <Item label="CURRENT RAW TL ROM" value={deg(snapshot?.rawRom)} />
          <Item label="FILTERED CURRENT ROM" value={deg(snapshot?.filteredRom)} />
          <Item label="RAW MAX" value={deg(snapshot?.maxRawRom)} />
          <Item label="OLD SHOULDER-LINE (debug)" value={deg(f?.oldShoulderLineDeg)} />
          <Item label="READY BASELINE CAPTURED" value={yesNo(f?.readyBaselineCaptured)} />
          <Item label="WORLD LANDMARKS" value="YES (primary source)" />
        </dl>
        <h3>Landmarks (world)</h3>
        <dl className="readout">
          <Item label="Left shoulder xyz" value={xyz(f?.leftShoulder)} />
          <Item label="Left shoulder confidence" value={num(f?.leftShoulderConfidence)} />
          <Item label="Right shoulder xyz" value={xyz(f?.rightShoulder)} />
          <Item label="Right shoulder confidence" value={num(f?.rightShoulderConfidence)} />
          <Item label="Left hip xyz" value={xyz(f?.leftHip)} />
          <Item label="Right hip xyz" value={xyz(f?.rightHip)} />
          <Item label="Baseline primary vector XZ" value={v3(f?.neutralShoulderVector)} />
          <Item label="Current primary vector XZ" value={v3(f?.currentShoulderVector)} />
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
function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
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

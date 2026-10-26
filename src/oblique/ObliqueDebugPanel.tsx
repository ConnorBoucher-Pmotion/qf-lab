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
        Developer / axial trunk debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
        <p className="provisional">
          Measuring calibrated axial trunk rotation relative to a locked pelvis (functional TL Junction ROM). 2D
          shoulder-line slope is diagnostic only and never drives Raw Max. World landmarks (XZ yaw) are primary; depth
          difference, foreshortening, and visible-shoulder orbit support occlusion.
        </p>
        <h3>Comparison (why old method failed)</h3>
        <dl className="readout">
          <Item label="2D SHOULDER SLOPE (DIAG)" value={deg(f?.estimator2dLineDeg)} />
          <Item label="3D TORSO YAW FROM BASELINE" value={deg(f?.torsoRotationFromBaselineDeg)} />
          <Item label="PELVIS YAW FROM BASELINE" value={deg(f?.pelvisRotationFromBaselineDeg)} />
          <Item label="TORSO RELATIVE PELVIS" value={deg(f?.torsoRelativePelvisDeg)} />
          <Item label="SELECTED AXIAL ROM" value={deg(f?.rawRom)} />
          <Item label="RAW MAX" value={deg(snapshot?.maxRawRom)} />
          <Item label="SELECTED SOURCE" value={f?.axialSelectedSource ?? f?.estimatorSelectedSource ?? "—"} />
        </dl>
        <h3>Locked calibration</h3>
        <dl className="readout">
          <Item label="BASELINE" value={f?.baselineLocked ? "LOCKED" : "open"} />
          <Item label="BASELINE TORSO YAW" value={deg(f?.baselineTorsoYawDeg)} />
          <Item label="CURRENT TORSO YAW" value={deg(f?.currentTorsoYawDeg)} />
          <Item label="BASELINE PELVIS YAW" value={deg(f?.baselinePelvisYawDeg)} />
          <Item label="CURRENT PELVIS YAW" value={deg(f?.currentPelvisYawDeg)} />
          <Item label="CAMERA MODE" value={snapshot ? cameraModeLabel(snapshot.cameraMode).toUpperCase() : "—"} />
          <Item label="STATE" value={snapshot?.state ?? "—"} />
          <Item label="TRIAL" value={snapshot ? `${snapshot.direction.toUpperCase()} ROTATION` : "—"} />
        </dl>
        <h3>Supporting signals</h3>
        <dl className="readout">
          <Item label="DEPTH DIFF YAW" value={deg(f?.depthDiffYawDeg)} />
          <Item label="FORESHORTENING" value={deg(f?.foreshorteningDeg)} />
          <Item label="VISIBLE SHOULDER ORBIT" value={deg(f?.visibleShoulderOrbitDeg)} />
          <Item label="IMAGE PRIMARY ORBIT" value={deg(f?.estimatorImageOrbitDeg)} />
          <Item label="OCCLUSION" value={f?.axialOcclusion ?? "—"} />
          <Item label="TRUSTED SHOULDER" value={String(f?.reliableShoulder ?? "—").toUpperCase()} />
          <Item label="LEFT SHOULDER CONF" value={pct(f?.leftShoulderConfidence)} />
          <Item label="RIGHT SHOULDER CONF" value={pct(f?.rightShoulderConfidence)} />
          <Item label="WORLD LANDMARKS" value="YES (MediaPipe Pose world, XZ yaw)" />
        </dl>
        <h3>World landmarks (meters)</h3>
        <dl className="readout">
          <Item label="LEFT SHOULDER x/y/z" value={xyz(f?.worldLeftShoulder ?? f?.leftShoulder)} />
          <Item label="RIGHT SHOULDER x/y/z" value={xyz(f?.worldRightShoulder ?? f?.rightShoulder)} />
          <Item label="LEFT HIP x/y/z" value={xyz(f?.worldLeftHip ?? f?.leftHip)} />
          <Item label="RIGHT HIP x/y/z" value={xyz(f?.worldRightHip ?? f?.rightHip)} />
        </dl>
        <h3>Image landmarks (pixels, unmirrored)</h3>
        <dl className="readout">
          <Item label="LEFT SHOULDER x/y" value={xy(f?.imageLeftShoulder)} />
          <Item label="RIGHT SHOULDER x/y" value={xy(f?.imageRightShoulder)} />
          <Item label="LEFT HIP x/y" value={xy(f?.imageLeftHip)} />
          <Item label="RIGHT HIP x/y" value={xy(f?.imageRightHip)} />
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
function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}
function xyz(point: { x: number; y: number; z: number } | null | undefined): string {
  return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}` : "—";
}
function xy(point: { x: number; y: number } | null | undefined): string {
  return point ? `${point.x.toFixed(1)}, ${point.y.toFixed(1)}` : "—";
}

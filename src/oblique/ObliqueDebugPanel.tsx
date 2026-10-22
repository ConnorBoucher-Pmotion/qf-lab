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
        <p className="provisional">
          Primary ROM = unwrapped shoulder-axis yaw change − hip-axis yaw change vs READY (world landmarks). Camera
          angle is irrelevant. No physiological clamp. Old shoulder→hipMid arc kept as experimental comparison only.
        </p>
        <h3>Thorax vs pelvis</h3>
        <dl className="readout">
          <Item label="CAMERA MODE" value={snapshot ? cameraModeLabel(snapshot.cameraMode).toUpperCase() : "—"} />
          <Item label="STATE" value={snapshot?.state ?? "—"} />
          <Item label="TRIAL" value={snapshot ? `${snapshot.direction.toUpperCase()} ROTATION` : "—"} />
          <Item label="ABSOLUTE SHOULDER YAW" value={deg(f?.absoluteShoulderYawDeg)} />
          <Item label="BASELINE SHOULDER YAW" value={deg(f?.baselineShoulderYawDeg)} />
          <Item label="SHOULDER YAW CHANGE" value={deg(f?.shoulderYawChangeDeg)} />
          <Item label="ABSOLUTE HIP YAW" value={deg(f?.absoluteHipYawDeg)} />
          <Item label="BASELINE HIP YAW" value={deg(f?.baselineHipYawDeg)} />
          <Item label="HIP YAW CHANGE" value={deg(f?.hipYawChangeDeg)} />
          <Item label="SIGNED TL ROTATION" value={deg(f?.signedTlRotationDeg)} />
          <Item label="CURRENT RAW ROM" value={deg(snapshot?.rawRom)} />
          <Item label="RAW MAX ROM" value={deg(snapshot?.maxRawRom)} />
          <Item label="READY BASELINE CAPTURED" value={yesNo(f?.readyBaselineCaptured)} />
          <Item label="WORLD LANDMARKS" value="YES" />
          <Item label="EXPERIMENTAL OLD METHOD (shoulder→hipMid)" value={deg(f?.experimentalOldPrimaryDeg)} />
        </dl>
        <h3>Landmarks (world)</h3>
        <dl className="readout">
          <Item label="LEFT SHOULDER x/y/z" value={xyz(f?.leftShoulder)} />
          <Item label="RIGHT SHOULDER x/y/z" value={xyz(f?.rightShoulder)} />
          <Item label="LEFT HIP x/y/z" value={xyz(f?.leftHip)} />
          <Item label="RIGHT HIP x/y/z" value={xyz(f?.rightHip)} />
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
function yesNo(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "YES" : "NO";
}
function xyz(point: { x: number; y: number; z: number } | null | undefined): string {
  return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}` : "—";
}

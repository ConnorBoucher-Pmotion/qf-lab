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
        Developer / CV debug {open ? "▴" : "▾"}
      </button>
      <div className="debug-body" hidden={!open}>
        <p className="provisional">
          Multi-estimator TL ROM. World landmarks drive hybrid when they report motion; image primary-orbit is selected
          when world under-reports axial yaw. 2D shoulder-line slope is diagnostic only (often ~0 for pure yaw). CSS
          mirror is display-only and never enters geometry.
        </p>
        <h3>RAW CV DEBUG</h3>
        <dl className="readout">
          <Item label="CURRENT ROM" value={deg(f?.rawRom)} />
          <Item label="PEAK ROM" value={deg(snapshot?.maxRawRom)} />
          <Item label="BASELINE" value={f?.baselineLocked ? "LOCKED" : f?.readyBaselineCaptured ? "captured" : "open"} />
          <Item label="A EXISTING HYBRID" value={deg(f?.estimatorExistingDeg)} />
          <Item label="B 2D SHOULDER-LINE" value={deg(f?.estimator2dLineDeg)} />
          <Item label="C WORLD YAW" value={deg(f?.estimatorWorldYawDeg)} />
          <Item label="D IMAGE PRIMARY ORBIT" value={deg(f?.estimatorImageOrbitDeg)} />
          <Item label="SIGNED WORLD (UNCLAMPED)" value={deg(f?.worldSignedUnclampedDeg)} />
          <Item label="SELECTED SOURCE" value={f?.estimatorSelectedSource ?? "—"} />
          <Item label="TRUSTED SHOULDER" value={String(f?.reliableShoulder ?? "—").toUpperCase()} />
          <Item label="HYBRID MODE" value={f?.hybridMode ?? "—"} />
          <Item label="OCCLUSION" value={yesNo(f?.occlusionActive)} />
          <Item label="LEFT SHOULDER CONF" value={pct(f?.leftShoulderConfidence)} />
          <Item label="RIGHT SHOULDER CONF" value={pct(f?.rightShoulderConfidence)} />
        </dl>
        <h3>Frozen hip / baseline</h3>
        <dl className="readout">
          <Item label="CAMERA MODE" value={snapshot ? cameraModeLabel(snapshot.cameraMode).toUpperCase() : "—"} />
          <Item label="STATE" value={snapshot?.state ?? "—"} />
          <Item label="TRIAL" value={snapshot ? `${snapshot.direction.toUpperCase()} ROTATION` : "—"} />
          <Item label="FROZEN HIP REFERENCE" value={deg(f?.frozenHipReferenceDeg)} />
          <Item label="STARTING SHOULDER ANGLE" value={deg(f?.startingShoulderAngleDeg)} />
          <Item label="STARTING OFFSET" value={deg(f?.startingShoulderToHipOffsetDeg)} />
          <Item label="CURRENT SHOULDER VS FROZEN HIP" value={deg(f?.currentShoulderVsFrozenHipDeg)} />
          <Item label="LIVE HIP DEVIATION (QUALITY)" value={deg(f?.liveHipDeviationDeg)} />
          <Item label="WORLD LANDMARKS AVAILABLE" value="YES (MediaPipe Pose world)" />
        </dl>
        <h3>Image landmarks (pixels, unmirrored)</h3>
        <dl className="readout">
          <Item label="LEFT SHOULDER x/y" value={xy(f?.imageLeftShoulder)} />
          <Item label="RIGHT SHOULDER x/y" value={xy(f?.imageRightShoulder)} />
          <Item label="LEFT HIP x/y" value={xy(f?.imageLeftHip)} />
          <Item label="RIGHT HIP x/y" value={xy(f?.imageRightHip)} />
        </dl>
        <h3>World landmarks (meters)</h3>
        <dl className="readout">
          <Item label="LEFT SHOULDER x/y/z" value={xyz(f?.worldLeftShoulder ?? f?.leftShoulder)} />
          <Item label="RIGHT SHOULDER x/y/z" value={xyz(f?.worldRightShoulder ?? f?.rightShoulder)} />
          <Item label="LEFT HIP x/y/z" value={xyz(f?.worldLeftHip ?? f?.leftHip)} />
          <Item label="RIGHT HIP x/y/z" value={xyz(f?.worldRightHip ?? f?.rightHip)} />
          <Item label="FROZEN LEFT HIP" value={xyz(f?.frozenLeftHip)} />
          <Item label="FROZEN RIGHT HIP" value={xyz(f?.frozenRightHip)} />
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
function yesNo(value: boolean | undefined): string {
  if (value == null) return "—";
  return value ? "YES" : "NO";
}
function xyz(point: { x: number; y: number; z: number } | null | undefined): string {
  return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}` : "—";
}
function xy(point: { x: number; y: number } | null | undefined): string {
  return point ? `${point.x.toFixed(1)}, ${point.y.toFixed(1)}` : "—";
}

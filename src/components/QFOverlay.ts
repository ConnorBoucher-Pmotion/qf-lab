import { LM, jointIndex } from "../pose/types";
import type { QFConfig } from "../qf/qfConfig";
import { hipLineTiltDeg, lateralSignX } from "../qf/qfMeasurementEngine";
import type { CheckStatus, ConstraintCheck, QFSnapshot } from "../qf/qfTypes";

const STATUS_COLOR: Record<Exclude<CheckStatus, "na">, string> = {
  pass: "#3ddc84",
  warn: "#e6b325",
  fail: "#ff5d5d",
};
const RAW_COLOR = "rgba(255, 159, 67, 0.85)";
const REF_COLOR = "rgba(255, 255, 255, 0.7)";
const CURRENT_COLOR = "#7eb6ff";

/**
 * Canvas sits over a CSS-mirrored video; points are drawn at width − x.
 *   dim dots      landmarks not used by QF
 *   white rings   QF-critical landmarks (tested hip/knee/ankle, both hips); red when weak
 *   orange thin   RAW shank (unfiltered MediaPipe)
 *   white dashed  REFERENCE shank direction from calibration, drawn from the current knee
 *   blue thick    CURRENT shank (filtered); coloured by the hard checks
 */
export function drawQfOverlay(ctx: CanvasRenderingContext2D, width: number, _height: number, snapshot: QFSnapshot, config: QFConfig): void {
  const pose = snapshot.imagePose;
  if (pose.length < 33) return;
  const mx = (x: number) => width - x;
  const paint = (ids: string[], fallback: string) => colorOf(worst(ids, snapshot.checks), fallback);
  const side = snapshot.side;
  const hip = pose[jointIndex(side, "hip")];
  const knee = pose[jointIndex(side, "knee")];
  const ankle = pose[jointIndex(side, "ankle")];
  const hipL = pose[LM.leftHip];
  const hipR = pose[LM.rightHip];
  const shL = pose[LM.leftShoulder];
  const shR = pose[LM.rightShoulder];
  const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const baseline = snapshot.baseline;
  const shankLen = baseline?.shankLenPx ?? Math.hypot(ankle.x - knee.x, ankle.y - knee.y);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < pose.length; i += 1) {
    if (pose[i].visibility < 0.15) continue;
    dot(ctx, mx(pose[i].x), pose[i].y, 2.5, "rgba(255,255,255,0.3)");
  }

  if (baseline) {
    const offX = baseline.testedKnee.x - baseline.midHip.x;
    const offY = baseline.testedKnee.y - baseline.midHip.y;
    ring(ctx, mx(midHip.x + offX), midHip.y + offY, Math.max(10, config.kneeLateralFail * baseline.shankLenPx), paint(["knee-lateral", "femur-position"], STATUS_COLOR.pass), 1.5);
  }

  if (shL.visibility >= 0.2 && shR.visibility >= 0.2) {
    line(ctx, mx(shL.x), shL.y, mx(shR.x), shR.y, "rgba(232,236,241,0.4)", 2);
    line(ctx, mx(midSh.x), midSh.y, mx(midHip.x), midHip.y, paint(["torso-lean", "torso-rotation"], "rgba(232,236,241,0.55)"), 2);
  }
  line(ctx, mx(hipL.x), hipL.y, mx(hipR.x), hipR.y, paint(["pelvis-tilt", "pelvis-translation", "pelvis-rotation"], "rgba(232,236,241,0.8)"), 3);
  if (baseline && snapshot.metrics.pelvisCenter) {
    const bx = mx(baseline.midHip.x);
    const by = baseline.midHip.y;
    const scale = baseline.hipWidthPx;
    ring(ctx, bx, by, Math.max(6, config.pelvisTranslationFail * scale), "rgba(255,93,93,0.4)", 1);
    ring(ctx, bx, by, Math.max(4, config.pelvisTranslationWarn * scale), "rgba(230,179,37,0.55)", 1);
    dot(ctx, bx, by, 2.5, "rgba(255,255,255,0.75)");
    const current = snapshot.metrics.pelvisCenter;
    dot(ctx, mx(current.x), current.y, 3.5, paint(["pelvis-translation"], STATUS_COLOR.pass));
  }
  line(ctx, mx(hip.x), hip.y, mx(knee.x), knee.y, paint(["knee-lateral", "femur-position"], "rgba(126,182,255,0.7)"), 3);

  const lateral = lateralSignX(side);
  const hangAbs = baseline?.angleRef.hangAbsoluteDeg ?? 0;
  const hangPelvis = baseline?.angleRef.hangPelvisDeg;
  const tilt = hipLineTiltDeg(hipL, hipR);
  const refRawDeg =
    config.primaryMethod === "pelvis2d" && hangPelvis != null ? hangPelvis * lateral - tilt : hangAbs * lateral;
  const refDir = { x: Math.sin(rad(refRawDeg)), y: Math.cos(rad(refRawDeg)) };
  ctx.save();
  ctx.setLineDash([6, 6]);
  line(ctx, mx(knee.x), knee.y, mx(knee.x + refDir.x * shankLen), knee.y + refDir.y * shankLen, REF_COLOR, 2);
  ctx.restore();

  const raw = snapshot.rawPose;
  if (raw.length >= 33) {
    const rk = raw[jointIndex(side, "knee")];
    const ra = raw[jointIndex(side, "ankle")];
    line(ctx, mx(rk.x), rk.y, mx(ra.x), ra.y, RAW_COLOR, 1.5);
  }

  line(ctx, mx(knee.x), knee.y, mx(ankle.x), ankle.y, paint(["shank-short", "pelvis-tilt", "knee-lateral"], CURRENT_COLOR), 5);

  const angle = snapshot.primary.filtered;
  if (baseline && angle != null) {
    const curDir = { x: ankle.x - knee.x, y: ankle.y - knee.y };
    const a0 = Math.atan2(refDir.y, -refDir.x);
    const a1 = Math.atan2(curDir.y, -curDir.x);
    const r = shankLen * 0.45;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.arc(mx(knee.x), knee.y, r, a0, a1, normalizeAngle(a1 - a0) < 0);
    ctx.stroke();
    const mid = a0 + normalizeAngle(a1 - a0) / 2;
    const lx = mx(knee.x) + Math.cos(mid) * (r + 26);
    const ly = knee.y + Math.sin(mid) * (r + 26);
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    const label = `${angle.toFixed(1)}°`;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, lx, ly);
  }

  const groupOk = (id: string) => snapshot.tracking.groups.find((g) => g.id === id)?.ok ?? false;
  const critical: Array<[typeof hip, string]> = [
    [hipL, "hips"],
    [hipR, "hips"],
    [hip, "hips"],
    [knee, "knee"],
    [ankle, "ankle"],
  ];
  for (const [p, group] of critical) {
    dot(ctx, mx(p.x), p.y, 5, "#ffffff");
    ring(ctx, mx(p.x), p.y, 9, groupOk(group) ? "#ffffff" : STATUS_COLOR.fail, 2);
  }
}

function worst(ids: string[], checks: ConstraintCheck[]): Exclude<CheckStatus, "na"> | null {
  const found = checks.filter((c) => ids.includes(c.id) && c.status !== "na");
  if (found.some((c) => c.status === "fail")) return "fail";
  if (found.some((c) => c.status === "warn")) return "warn";
  return found.length ? "pass" : null;
}

function colorOf(status: Exclude<CheckStatus, "na"> | null, fallback: string): string {
  return status ? STATUS_COLOR[status] : fallback;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function normalizeAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

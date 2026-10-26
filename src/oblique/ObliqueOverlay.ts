import { LM } from "../pose/types";
import type { ObliqueSnapshot } from "./types";

/**
 * Live overlay: torso plane (shoulders + hips), locked baseline orientation,
 * and current axial twist — so a real twist is visually obvious.
 */
export function drawObliqueOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: ObliqueSnapshot): void {
  const pose = snapshot.imagePose;
  if (pose.length < 33) return;
  const mx = (x: number) => width - x; // CSS mirror is display-only; overlay matches preview
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";

  const shL = pose[LM.leftShoulder];
  const shR = pose[LM.rightShoulder];
  const hipL = pose[LM.leftHip];
  const hipR = pose[LM.rightHip];
  if (!shL || !shR || !hipL || !hipR) return;

  const leftConf = snapshot.frame.leftShoulderConfidence;
  const rightConf = snapshot.frame.rightShoulderConfidence;
  const leftColor = snapshot.frame.leftReconstructed ? "#4da3ff" : leftConf >= 0.4 ? "#3ddc84" : "#e6b325";
  const rightColor = snapshot.frame.rightReconstructed ? "#4da3ff" : rightConf >= 0.4 ? "#3ddc84" : "#e6b325";

  // Live hip (may jitter)
  line(ctx, mx(hipL.x), hipL.y, mx(hipR.x), hipR.y, "rgba(215,230,245,0.45)", 3);
  // Frozen pelvis reference from READY
  const frozen = snapshot.frame.frozenHipImage;
  if (frozen) {
    dashedLine(ctx, mx(frozen.left.x), frozen.left.y, mx(frozen.right.x), frozen.right.y, "rgba(255,168,76,0.95)", 5);
    ring(ctx, mx(frozen.left.x), frozen.left.y, 7, "#ffa84c");
    ring(ctx, mx(frozen.right.x), frozen.right.y, 7, "#ffa84c");
  }

  // Torso plane quad
  ctx.beginPath();
  ctx.moveTo(mx(shL.x), shL.y);
  ctx.lineTo(mx(shR.x), shR.y);
  ctx.lineTo(mx(hipR.x), hipR.y);
  ctx.lineTo(mx(hipL.x), hipL.y);
  ctx.closePath();
  ctx.fillStyle = "rgba(96,165,250,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(96,165,250,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  line(ctx, mx(shL.x), shL.y, mx(shR.x), shR.y, "rgba(126,182,255,0.95)", 5);

  const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  line(ctx, mx(midSh.x), midSh.y, mx(midHip.x), midHip.y, "rgba(255,255,255,0.5)", 2);
  ring(ctx, mx(midSh.x), midSh.y, 5, "#fff");
  ring(ctx, mx(midHip.x), midHip.y, 5, "#fff");

  // Current torso facing arrow (from hip mid through shoulder mid), length encodes ROM.
  const rom = snapshot.rawRom ?? 0;
  const dx = midSh.x - midHip.x;
  const dy = midSh.y - midHip.y;
  const len = Math.hypot(dx, dy) || 1;
  const scale = 0.55 + Math.min(0.7, Math.abs(rom) / 50);
  const tipX = midHip.x + (dx / len) * len * scale;
  const tipY = midHip.y + (dy / len) * len * scale;
  arrow(ctx, mx(midHip.x), midHip.y, mx(tipX), tipY, "#fbbf24", 4);

  // Baseline facing (vertical-ish from frozen hip mid) when locked
  if (frozen && snapshot.frame.baselineLocked) {
    const fMid = {
      x: (frozen.left.x + frozen.right.x) / 2,
      y: (frozen.left.y + frozen.right.y) / 2,
    };
    // Baseline torso facing ≈ upward from pelvis in image (neutral stand-in)
    const baseTipY = fMid.y - 80;
    dashedLine(ctx, mx(fMid.x), fMid.y, mx(fMid.x), baseTipY, "rgba(255,168,76,0.75)", 3);
  }

  ring(ctx, mx(shL.x), shL.y, 9, leftColor);
  ring(ctx, mx(shR.x), shR.y, 9, rightColor);
  if (snapshot.frame.leftReconstructed) dot(ctx, mx(shL.x), shL.y, 5, "#4da3ff");
  if (snapshot.frame.rightReconstructed) dot(ctx, mx(shR.x), shR.y, 5, "#4da3ff");
  ring(ctx, mx(hipL.x), hipL.y, 8, "#d7e6f5");
  ring(ctx, mx(hipR.x), hipR.y, 8, "#d7e6f5");

  if (snapshot.frame.readyBaselineCaptured || snapshot.frame.baselineLocked) {
    const torso = snapshot.frame.torsoRotationFromBaselineDeg;
    const pelvis = snapshot.frame.pelvisRotationFromBaselineDeg;
    const rel = snapshot.frame.torsoRelativePelvisDeg;
    const label = `AXIAL ${rom != null ? rom.toFixed(1) : "—"}°`;
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(label, mx(midSh.x), midSh.y - 36);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, mx(midSh.x), midSh.y - 36);
    ctx.font = "500 14px system-ui, sans-serif";
    const sub = `T ${fmt(torso)} · P ${fmt(pelvis)} · T−P ${fmt(rel)}`;
    ctx.strokeText(sub, mx(midSh.x), midSh.y - 14);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(sub, mx(midSh.x), midSh.y - 14);
  }
}

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)}°`;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([10, 6]);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  line(ctx, x1, y1, x2, y2, color, width);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 12;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

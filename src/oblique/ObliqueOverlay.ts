import { LM } from "../pose/types";
import type { ObliqueSnapshot } from "./types";

export function drawObliqueOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: ObliqueSnapshot): void {
  const pose = snapshot.imagePose;
  if (pose.length < 33) return;
  const mx = (x: number) => width - x;
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

  // Live hip (may jitter) — light
  line(ctx, mx(hipL.x), hipL.y, mx(hipR.x), hipR.y, "rgba(215,230,245,0.55)", 3);
  // Frozen hip reference from READY — must not move with live MediaPipe hips
  const frozen = snapshot.frame.frozenHipImage;
  if (frozen) {
    dashedLine(ctx, mx(frozen.left.x), frozen.left.y, mx(frozen.right.x), frozen.right.y, "rgba(255,168,76,0.95)", 5);
    ring(ctx, mx(frozen.left.x), frozen.left.y, 7, "#ffa84c");
    ring(ctx, mx(frozen.right.x), frozen.right.y, 7, "#ffa84c");
  }
  line(ctx, mx(shL.x), shL.y, mx(shR.x), shR.y, "rgba(126,182,255,0.95)", 5);

  const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  line(ctx, mx(midSh.x), midSh.y, mx(midHip.x), midHip.y, "rgba(255,255,255,0.45)", 2);

  ring(ctx, mx(shL.x), shL.y, 9, leftColor);
  ring(ctx, mx(shR.x), shR.y, 9, rightColor);
  if (snapshot.frame.leftReconstructed) dot(ctx, mx(shL.x), shL.y, 5, "#4da3ff");
  if (snapshot.frame.rightReconstructed) dot(ctx, mx(shR.x), shR.y, 5, "#4da3ff");
  ring(ctx, mx(hipL.x), hipL.y, 8, "#d7e6f5");
  ring(ctx, mx(hipR.x), hipR.y, 8, "#d7e6f5");
  dot(ctx, mx(midSh.x), midSh.y, 4, "#fff");
  dot(ctx, mx(midHip.x), midHip.y, 4, "#fff");

  const angle = snapshot.rawRom ?? snapshot.frame.signedTlRotationDeg;
  if (angle != null && snapshot.frame.readyBaselineCaptured) {
    const label = `${angle.toFixed(1)}°`;
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(label, mx(midSh.x), midSh.y - 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, mx(midSh.x), midSh.y - 28);
  }
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

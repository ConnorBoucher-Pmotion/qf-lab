import { LM } from "../pose/types";
import type { TLConfig } from "../tl/tlConfig";
import type { CheckStatus, TLSnapshot } from "../tl/tlTypes";

const COLOR: Record<CheckStatus, string> = {
  pass: "#3ddc84",
  warn: "#e6b325",
  fail: "#ff5d5d",
  na: "rgba(232,236,241,0.7)",
};

const BONES: Array<[number, number]> = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftHip, LM.rightHip],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.rightHip, LM.rightKnee],
  [LM.leftShoulder, LM.leftEar],
  [LM.rightShoulder, LM.rightEar],
];

export function drawTlOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: TLSnapshot, _config: TLConfig): void {
  const pose = snapshot.imagePose;
  if (pose.length < 33) return;
  const mx = (x: number) => width - x;
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const point of pose) {
    if (point.visibility < 0.15) continue;
    dot(ctx, mx(point.x), point.y, 2.4, "rgba(255,255,255,0.28)");
  }
  for (const [a, b] of BONES) {
    if (pose[a].visibility < 0.2 || pose[b].visibility < 0.2) continue;
    line(ctx, mx(pose[a].x), pose[a].y, mx(pose[b].x), pose[b].y, "rgba(232,236,241,0.35)", 2);
  }

  const shL = pose[LM.leftShoulder];
  const shR = pose[LM.rightShoulder];
  const hipL = pose[LM.leftHip];
  const hipR = pose[LM.rightHip];
  const kneeL = pose[LM.leftKnee];
  const kneeR = pose[LM.rightKnee];
  const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const trunk = paint(snapshot, ["trunk-lateral", "trunk-forward"], "#7eb6ff");
  const pelvis = paint(snapshot, ["pelvis-rotation", "pelvis-translation", "hip-shift"], "#d7e6f5");
  const knees = paint(snapshot, ["knee-shift"], "#3ddc84");

  line(ctx, mx(shL.x), shL.y, mx(shR.x), shR.y, trunk, 5);
  line(ctx, mx(hipL.x), hipL.y, mx(hipR.x), hipR.y, pelvis, 5);
  line(ctx, mx(midSh.x), midSh.y, mx(midHip.x), midHip.y, trunk, 3);
  dot(ctx, mx(kneeL.x), kneeL.y, 6, knees);
  dot(ctx, mx(kneeR.x), kneeR.y, 6, knees);
  ring(ctx, mx(shL.x), shL.y, 8, trunk);
  ring(ctx, mx(shR.x), shR.y, 8, trunk);
  ring(ctx, mx(hipL.x), hipL.y, 8, pelvis);
  ring(ctx, mx(hipR.x), hipR.y, 8, pelvis);

  const ref = snapshot.reference;
  if (ref) {
    ctx.save();
    ctx.setLineDash([7, 6]);
    line(ctx, mx(ref.x1), ref.y1, mx(ref.x2), ref.y2, "rgba(255,255,255,0.8)", 2);
    ctx.restore();
  }

  const angle = snapshot.rom.filtered;
  if (angle != null && (snapshot.movementStarted || snapshot.state === "COMPLETE")) {
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

function paint(snapshot: TLSnapshot, ids: string[], fallback: string): string {
  const relevant = snapshot.checks.filter((check) => ids.includes(check.id));
  const status = relevant.some((check) => check.status === "fail") ? "fail" : relevant.some((check) => check.status === "warn") ? "warn" : relevant.length ? "pass" : "na";
  return COLOR[status] ?? fallback;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

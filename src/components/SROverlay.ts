import { LM } from "../pose/types";
import type { SRConfig } from "../sr/srConfig";
import type { CheckStatus, SRSnapshot } from "../sr/srTypes";

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
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
];

export function drawSrOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: SRSnapshot, _config: SRConfig): void {
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
  const elL = pose[LM.leftElbow];
  const elR = pose[LM.rightElbow];
  const wrL = pose[LM.leftWrist];
  const wrR = pose[LM.rightWrist];
  const hipL = pose[LM.leftHip];
  const hipR = pose[LM.rightHip];
  const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const trunk = paint(snapshot, ["trunk-lateral", "trunk-forward", "upright"], "#7eb6ff");
  const leftArm = paint(snapshot, ["left-abduction", "left-elbow", "left-elbow-height", "left-elbow-drift", "left-shrug"], "#3ddc84");
  const rightArm = paint(snapshot, ["right-abduction", "right-elbow", "right-elbow-height", "right-elbow-drift", "right-shrug"], "#f0a35e");

  line(ctx, mx(midSh.x), midSh.y, mx(midHip.x), midHip.y, trunk, 3);
  line(ctx, mx(shL.x), shL.y, mx(elL.x), elL.y, leftArm, 5);
  line(ctx, mx(elL.x), elL.y, mx(wrL.x), wrL.y, leftArm, 4);
  line(ctx, mx(shR.x), shR.y, mx(elR.x), elR.y, rightArm, 5);
  line(ctx, mx(elR.x), elR.y, mx(wrR.x), wrR.y, rightArm, 4);
  ring(ctx, mx(shL.x), shL.y, 8, leftArm);
  ring(ctx, mx(shR.x), shR.y, 8, rightArm);
  ring(ctx, mx(elL.x), elL.y, 7, leftArm);
  ring(ctx, mx(elR.x), elR.y, 7, rightArm);
  dot(ctx, mx(wrL.x), wrL.y, 6, leftArm);
  dot(ctx, mx(wrR.x), wrR.y, 6, rightArm);

  const ref = snapshot.reference;
  if (ref) {
    ctx.save();
    ctx.setLineDash([7, 6]);
    line(ctx, mx(ref.x1), ref.y1, mx(ref.x2), ref.y2, "rgba(255,255,255,0.8)", 2);
    ctx.restore();
  }

  ctx.font = "600 16px system-ui, sans-serif";
  ctx.textAlign = "left";
  const leftRot = snapshot.left.currentSigned;
  const rightRot = snapshot.right.currentSigned;
  const leftAbd = snapshot.metrics.left.abductionDeg;
  const rightAbd = snapshot.metrics.right.abductionDeg;
  const leftElb = snapshot.metrics.left.elbowFlexionDeg;
  const rightElb = snapshot.metrics.right.elbowFlexionDeg;
  drawHud(ctx, 12, 22, [
    `L abd ${fmt(leftAbd)}  elb ${fmt(leftElb)}  rot ${fmt(leftRot)}`,
    `R abd ${fmt(rightAbd)}  elb ${fmt(rightElb)}  rot ${fmt(rightRot)}`,
    snapshot.movementStarted
      ? `Raw L ${fmt(snapshot.left.rawArc)} / R ${fmt(snapshot.right.rawArc)}   Valid L ${fmt(snapshot.left.validArc)} / R ${fmt(snapshot.right.validArc)}`
      : snapshot.rejectReason || snapshot.movementMessage || constraintBubble(snapshot),
  ]);

  if (snapshot.movementStarted || snapshot.state === "COMPLETE") {
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = `L ${fmt(snapshot.left.validArc ?? snapshot.left.currentSigned)} · R ${fmt(snapshot.right.validArc ?? snapshot.right.currentSigned)}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(label, mx(midSh.x), midSh.y - 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, mx(midSh.x), midSh.y - 28);
  }
}

function constraintBubble(snapshot: SRSnapshot): string {
  const hard = [...snapshot.setupChecks, ...snapshot.checks].find((check) => check.blocking && check.status === "fail");
  if (hard) return hard.message;
  const warn = [...snapshot.setupChecks, ...snapshot.checks].find((check) => check.status === "warn");
  if (warn) return warn.message;
  return "Position Valid";
}

function drawHud(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[]): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 6, y - 16, 520, lines.length * 20 + 12);
  ctx.fillStyle = "#fff";
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * 20));
  ctx.restore();
}

function paint(snapshot: SRSnapshot, ids: string[], fallback: string): string {
  const relevant = [...snapshot.setupChecks, ...snapshot.checks].filter((check) => ids.includes(check.id));
  const status = relevant.some((check) => check.status === "fail") ? "fail" : relevant.some((check) => check.status === "warn") ? "warn" : relevant.length ? "pass" : "na";
  return COLOR[status] ?? fallback;
}

function fmt(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}°`;
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

import { LM, type Vec } from "../pose/types";
import type { SRConfig } from "./srConfig";
import { detectSigns, type CameraFacing, type ShoulderReading } from "./srGeometry";
import type { CheckStatus, ConstraintCheck } from "./srTypes";

export function grade(value: number | null, warn: number, fail: number): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "na";
  const magnitude = Math.abs(value);
  if (magnitude >= fail) return "fail";
  if (magnitude >= warn) return "warn";
  return "pass";
}

export function gradeTarget(value: number | null, target: number, warnTol: number, failTol: number): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "na";
  const err = Math.abs(value - target);
  if (err >= failTol) return "fail";
  if (err >= warnTol) return "warn";
  return "pass";
}

function check(
  id: string,
  label: string,
  category: ConstraintCheck["category"],
  value: number | null,
  warn: number | null,
  fail: number | null,
  unit: string,
  blocking: boolean,
  message?: string
): ConstraintCheck {
  const status =
    value == null || warn == null || fail == null ? "na" : grade(value, warn, fail);
  return {
    id,
    label,
    category,
    value,
    warn,
    fail,
    unit,
    status,
    blocking: blocking && (status === "fail" || status === "na"),
    message: message ?? (status === "pass" ? "OK" : status === "warn" ? `${label} warning` : status === "fail" ? `${label} out of range` : `${label} unavailable`),
  };
}

function targetCheck(
  id: string,
  label: string,
  category: ConstraintCheck["category"],
  value: number | null,
  target: number,
  warnTol: number,
  failTol: number,
  unit: string,
  blocking: boolean,
  failMessage: string,
  warnMessage: string
): ConstraintCheck {
  const status = gradeTarget(value, target, warnTol, failTol);
  return {
    id,
    label,
    category,
    value,
    warn: warnTol,
    fail: failTol,
    unit,
    status,
    blocking: blocking && (status === "fail" || status === "na"),
    message:
      status === "pass"
        ? `${label} ${value?.toFixed(1)}${unit} (target ${target}${unit})`
        : status === "warn"
          ? warnMessage
          : status === "fail"
            ? failMessage
            : `${label} not visible`,
  };
}

export function setupChecks(reading: ShoulderReading, facing: CameraFacing, config: SRConfig, armBlocking = true): ConstraintCheck[] {
  const upright = maxAbs(reading.lateralLeanDeg, reading.forwardLeanDeg);
  return [
    check("upright", "Sit upright", "setup", upright, config.setupLeanWarnDeg, config.setupLeanFailDeg, "°", true, uprightMessage(upright, config)),
    facingConstraint(facing, config),
    targetCheck(
      "left-abduction",
      "Left shoulder abduction",
      "setup",
      reading.left.abductionDeg,
      config.shoulderAbductionTargetDeg,
      config.shoulderAbductionWarnDeg,
      config.shoulderAbductionFailDeg,
      "°",
      armBlocking,
      abductionFailMessage("Left", reading.left.abductionDeg, config),
      "Keep Left Arm at Shoulder Height"
    ),
    targetCheck(
      "right-abduction",
      "Right shoulder abduction",
      "setup",
      reading.right.abductionDeg,
      config.shoulderAbductionTargetDeg,
      config.shoulderAbductionWarnDeg,
      config.shoulderAbductionFailDeg,
      "°",
      armBlocking,
      abductionFailMessage("Right", reading.right.abductionDeg, config),
      "Keep Right Arm at Shoulder Height"
    ),
    targetCheck(
      "left-elbow",
      "Left elbow flexion",
      "setup",
      reading.left.elbowFlexionDeg,
      config.elbowFlexionTargetDeg,
      config.elbowFlexionWarnDeg,
      config.elbowFlexionFailDeg,
      "°",
      armBlocking,
      "Keep Left Elbow Bent",
      "Keep Left Elbow Bent"
    ),
    targetCheck(
      "right-elbow",
      "Right elbow flexion",
      "setup",
      reading.right.elbowFlexionDeg,
      config.elbowFlexionTargetDeg,
      config.elbowFlexionWarnDeg,
      config.elbowFlexionFailDeg,
      "°",
      armBlocking,
      "Keep Right Elbow Bent",
      "Keep Right Elbow Bent"
    ),
    elbowHeightCheck("left", reading.left.elbowHeightDiff, config, armBlocking),
    elbowHeightCheck("right", reading.right.elbowHeightDiff, config, armBlocking),
    visibilityCheck(reading, config),
  ];
}

export function trialChecks(reading: ShoulderReading, config: SRConfig): ConstraintCheck[] {
  return [
    check("trunk-lateral", "Lateral trunk lean", "hard", reading.lateralLeanDeg, config.lateralLeanWarnDeg, config.lateralLeanFailDeg, "°", true, leanFail("Stop Leaning", reading.lateralLeanDeg)),
    check("trunk-forward", "Forward / back lean", "hard", reading.forwardLeanDeg, config.forwardLeanWarnDeg, config.forwardLeanFailDeg, "°", true, leanFail("Sit Upright", reading.forwardLeanDeg)),
    targetCheck(
      "left-abduction",
      "Left shoulder abduction",
      "hard",
      reading.left.abductionDeg,
      config.shoulderAbductionTargetDeg,
      config.shoulderAbductionWarnDeg,
      config.shoulderAbductionFailDeg,
      "°",
      true,
      "Keep Left Arm at Shoulder Height",
      "Keep Left Arm at Shoulder Height"
    ),
    targetCheck(
      "right-abduction",
      "Right shoulder abduction",
      "hard",
      reading.right.abductionDeg,
      config.shoulderAbductionTargetDeg,
      config.shoulderAbductionWarnDeg,
      config.shoulderAbductionFailDeg,
      "°",
      true,
      "Keep Right Arm at Shoulder Height",
      "Keep Right Arm at Shoulder Height"
    ),
    targetCheck(
      "left-elbow",
      "Left elbow flexion",
      "hard",
      reading.left.elbowFlexionDeg,
      config.elbowFlexionTargetDeg,
      config.elbowFlexionWarnDeg,
      config.elbowFlexionFailDeg,
      "°",
      true,
      "Keep Left Elbow Bent",
      "Keep Left Elbow Bent"
    ),
    targetCheck(
      "right-elbow",
      "Right elbow flexion",
      "hard",
      reading.right.elbowFlexionDeg,
      config.elbowFlexionTargetDeg,
      config.elbowFlexionWarnDeg,
      config.elbowFlexionFailDeg,
      "°",
      true,
      "Keep Right Elbow Bent",
      "Keep Right Elbow Bent"
    ),
    elbowHeightCheck("left", reading.left.elbowHeightDiff, config, true, "hard"),
    elbowHeightCheck("right", reading.right.elbowHeightDiff, config, true, "hard"),
    check("left-elbow-drift", "Left elbow drift", "hard", reading.left.elbowDriftPct, config.elbowDriftWarnPct, config.elbowDriftFailPct, "%", true, "Keep Upper Arm Still"),
    check("right-elbow-drift", "Right elbow drift", "hard", reading.right.elbowDriftPct, config.elbowDriftWarnPct, config.elbowDriftFailPct, "%", true, "Keep Upper Arm Still"),
    check("left-shrug", "Left shoulder shrug", "hard", reading.left.shoulderShrugPct, config.shoulderShrugWarnPct, config.shoulderShrugFailPct, "%", true, "Shoulder Shrug Detected"),
    check("right-shrug", "Right shoulder shrug", "hard", reading.right.shoulderShrugPct, config.shoulderShrugWarnPct, config.shoulderShrugFailPct, "%", true, "Shoulder Shrug Detected"),
    check("shoulder-tilt", "Shoulder height difference", "info", reading.shoulderHeightDiff, null, null, "%", false),
  ];
}

function elbowHeightCheck(side: "left" | "right", value: number | null, config: SRConfig, blocking: boolean, category: ConstraintCheck["category"] = "setup"): ConstraintCheck {
  const label = side === "left" ? "Left elbow height" : "Right elbow height";
  const status = grade(value, config.elbowHeightWarnDeg, config.elbowHeightFailDeg);
  const raise = value != null && value > 0;
  return {
    id: `${side}-elbow-height`,
    label,
    category,
    value,
    warn: config.elbowHeightWarnDeg,
    fail: config.elbowHeightFailDeg,
    unit: "°",
    status,
    blocking: blocking && status === "fail",
    message:
      status === "pass"
        ? "Elbow level with shoulder"
        : status === "fail"
          ? raise
            ? `Lower ${side === "left" ? "Left" : "Right"} Elbow`
            : `Raise ${side === "left" ? "Left" : "Right"} Elbow`
          : status === "warn"
            ? "Keep Elbows Level with Shoulders"
            : "Elbow Not Visible",
  };
}

function visibilityCheck(reading: ShoulderReading, config: SRConfig): ConstraintCheck {
  const min = config.landmarkConfidence;
  const parts = [
    { name: "Left Shoulder", v: reading.left.confidence },
    { name: "Right Shoulder", v: reading.right.confidence },
    { name: "Left Wrist", v: reading.left.wrist?.visibility ?? 0 },
    { name: "Right Wrist", v: reading.right.wrist?.visibility ?? 0 },
  ];
  const bad = parts.find((part) => part.v < min);
  return {
    id: "visibility",
    label: "Landmark visibility",
    category: "setup",
    value: Math.min(...parts.map((part) => part.v)),
    warn: min,
    fail: min,
    unit: "",
    status: bad ? "fail" : "pass",
    blocking: !!bad,
    message: bad ? (bad.name.includes("Wrist") ? "Wrist Not Visible" : "Move Fully Into Frame") : "Tracking OK",
  };
}

function facingConstraint(facing: CameraFacing, config: SRConfig): ConstraintCheck {
  const warn = config.setupFacingWarnDeg;
  const fail = config.setupFacingFailDeg;
  const value = facing.scoreDeg;
  const status = grade(value, warn, fail);
  const shown = value == null ? "unavailable" : `${value.toFixed(1)}°`;
  const bypass = config.bypassFaceCamera ? " Bypass is on, so this does not stop calibration." : "";
  return {
    id: "facing",
    label: "Face the camera",
    category: "setup",
    value,
    warn,
    fail,
    unit: "°",
    status,
    blocking: !config.bypassFaceCamera,
    message: `${shown}. ${facing.reason}${bypass}`,
  };
}

/** One hand held in front of the chest for thumbs-up fallback. */
export function presentedHand(world: Vec[]): boolean {
  if (world.length < 33) return false;
  const signs = detectSigns(world);
  if (!signs) return false;
  const shoulder = { x: (world[LM.leftShoulder].x + world[LM.rightShoulder].x) / 2, y: (world[LM.leftShoulder].y + world[LM.rightShoulder].y) / 2, z: (world[LM.leftShoulder].z + world[LM.rightShoulder].z) / 2 };
  const hip = { x: (world[LM.leftHip].x + world[LM.rightHip].x) / 2, y: (world[LM.leftHip].y + world[LM.rightHip].y) / 2, z: (world[LM.leftHip].z + world[LM.rightHip].z) / 2 };
  const torso = Math.max(Math.abs((shoulder.y - hip.y) * signs.yUp), 0.15);
  return [LM.leftWrist, LM.rightWrist].some((index, side) => {
    const wrist = world[index];
    const elbow = world[side === 0 ? LM.leftElbow : LM.rightElbow];
    if ((wrist?.visibility ?? 0) < 0.35 || !elbow) return false;
    const inFront = (wrist.z - shoulder.z) * signs.zFront > torso * 0.12;
    const aboveElbow = (wrist.y - elbow.y) * signs.yUp > torso * 0.08;
    return inFront && aboveElbow;
  });
}

/** True when both arms are back near the goalpost start after a thumbs-up. */
export function armsSettled(reading: ShoulderReading, config: SRConfig): boolean {
  const leftOk =
    reading.left.abductionDeg != null &&
    Math.abs(reading.left.abductionDeg - config.shoulderAbductionTargetDeg) <= config.shoulderAbductionFailDeg &&
    reading.left.elbowFlexionDeg != null &&
    Math.abs(reading.left.elbowFlexionDeg - config.elbowFlexionTargetDeg) <= config.elbowFlexionFailDeg;
  const rightOk =
    reading.right.abductionDeg != null &&
    Math.abs(reading.right.abductionDeg - config.shoulderAbductionTargetDeg) <= config.shoulderAbductionFailDeg &&
    reading.right.elbowFlexionDeg != null &&
    Math.abs(reading.right.elbowFlexionDeg - config.elbowFlexionTargetDeg) <= config.elbowFlexionFailDeg;
  return leftOk && rightOk;
}

export function framingChecks(image: Vec[], width: number, height: number): ConstraintCheck[] {
  if (image.length < 33 || width < 2 || height < 2) return [];
  const hip = { x: (image[LM.leftHip].x + image[LM.rightHip].x) / 2, y: (image[LM.leftHip].y + image[LM.rightHip].y) / 2 };
  const shoulder = { x: (image[LM.leftShoulder].x + image[LM.rightShoulder].x) / 2, y: (image[LM.leftShoulder].y + image[LM.rightShoulder].y) / 2 };
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) / height;
  const offCenter = Math.abs(hip.x / width - 0.5);
  const edge = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip].some((index) => {
    const point = image[index];
    return point.x < width * 0.02 || point.x > width * 0.98 || point.y < height * 0.02 || point.y > height * 0.98;
  });
  return [
    flag("frame-size-small", "Move closer", torso < 0.14),
    flag("frame-size-large", "Move backward", torso > 0.75),
    flag("center", "Center yourself", offCenter > 0.28),
    flag("edges", "Move Fully Into Frame", edge),
  ];
}

function flag(id: string, label: string, failing: boolean): ConstraintCheck {
  return {
    id,
    label,
    category: "setup",
    value: failing ? 1 : 0,
    warn: null,
    fail: 1,
    unit: "",
    status: failing ? "fail" : "pass",
    blocking: true,
    message: failing ? label : "OK",
  };
}

function maxAbs(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
}

function uprightMessage(value: number | null, config: SRConfig): string {
  if (value == null) return "Sit Upright";
  if (value >= config.setupLeanFailDeg) return "Stop Leaning";
  if (value >= config.setupLeanWarnDeg) return "Sit Upright";
  return "OK";
}

function abductionFailMessage(side: string, value: number | null, config: SRConfig): string {
  if (value == null) return `Keep ${side} Arm at Shoulder Height`;
  if (value < config.shoulderAbductionTargetDeg) return `Raise ${side} Elbow`;
  return `Lower ${side} Elbow`;
}

function leanFail(message: string, value: number | null): string {
  return value == null ? message : message;
}

import { dist3, midpoint } from "../pose/coordinateNormalization";
import { LM, type Vec } from "../pose/types";
import type { TLConfig } from "./tlConfig";
import { detectSigns, type CameraFacing } from "./tlRotation";
import type { CheckStatus, ConstraintCheck } from "./tlTypes";

export function grade(value: number | null, warn: number, fail: number): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "na";
  const magnitude = Math.abs(value);
  if (magnitude >= fail) return "fail";
  if (magnitude >= warn) return "warn";
  return "pass";
}

export type CompInput = {
  pelvisRotationDeg: number | null;
  pelvisTranslationPct: number | null;
  lateralLeanDeg: number | null;
  forwardLeanDeg: number | null;
  kneeShiftPct: number | null;
  hipShiftPct: number | null;
  shoulderTiltDeg: number | null;
  headLeadDeg: number | null;
  facingYawDeg: number | null;
  uprightDeg: number | null;
  squareDeg: number | null;
};

export function setupChecks(input: CompInput, config: TLConfig, facing: CameraFacing): ConstraintCheck[] {
  return [
    check("upright", "Sit tall", "setup", input.uprightDeg, config.setupLeanWarnDeg, config.setupLeanFailDeg, "°", true),
    facingConstraint(facing, config),
    check("square", "Shoulders square to pelvis", "setup", input.squareDeg, config.neutralYawToleranceDeg, config.neutralYawToleranceDeg + 6, "°", true),
  ];
}

function facingConstraint(facing: CameraFacing, config: TLConfig): ConstraintCheck {
  const warn = config.setupFacingWarnDeg;
  const fail = config.setupFacingFailDeg;
  const value = facing.scoreDeg;
  const status = grade(value, warn, fail);
  const shown = value == null ? "unavailable" : `${value.toFixed(1)}°`;
  const bypass = config.bypassFaceCamera ? " Bypass is on, so this does not stop calibration." : "";
  const line = status === "fail" ? `past the ${fail}° fail line` : status === "warn" ? `past the ${warn}° warning` : status === "na" ? "not measurable" : `inside the ${warn}° pass line`;
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
    message: `${shown} is ${line}. Pass below ${warn}°. Fail at ${fail}°. ${facing.reason}${bypass}`,
  };
}

export function trialChecks(input: CompInput, config: TLConfig, posture?: HandPosture): ConstraintCheck[] {
  return [
    check("pelvis-rotation", "Pelvic rotation", "hard", input.pelvisRotationDeg, config.pelvisRotationWarnDeg, config.pelvisRotationFailDeg, "°", true),
    check("pelvis-translation", "Pelvic translation", "hard", input.pelvisTranslationPct, config.pelvisTranslationWarnPct, config.pelvisTranslationFailPct, "%", true),
    check("trunk-lateral", "Lateral trunk lean", "hard", input.lateralLeanDeg, config.lateralLeanWarnDeg, config.lateralLeanFailDeg, "°", true),
    check("trunk-forward", "Forward / back lean", "hard", input.forwardLeanDeg, config.forwardLeanWarnDeg, config.forwardLeanFailDeg, "°", true),
    check("knee-shift", "Knee movement", "hard", input.kneeShiftPct, config.kneeShiftWarnPct, config.kneeShiftFailPct, "%", true),
    check("hip-shift", "Hip movement", "hard", input.hipShiftPct, config.hipShiftWarnPct, config.hipShiftFailPct, "%", true),
    handsCheck(posture, "hard"),
    check("shoulder-tilt", "Shoulder height difference", "info", input.shoulderTiltDeg, null, null, "°", false),
    check("head-lead", "Head vs torso", "info", input.headLeadDeg, null, null, "°", false),
  ];
}

export type HandPosture = {
  /** How many wrists are up beside the head. Null when the hands cannot be seen. */
  handsBehind: number | null;
  handsVisible: number;
  /** How many elbows are out to the side. Null when the elbows cannot be seen. */
  elbowsOut: number | null;
};

const EMPTY_POSTURE: HandPosture = { handsBehind: null, handsVisible: 0, elbowsOut: null };

/** Start-position posture. Invisible hands do not block the synthetic checks. */
export function handPosture(world: Vec[]): HandPosture {
  if (world.length < 33) return EMPTY_POSTURE;
  const signs = detectSigns(world);
  if (!signs) return EMPTY_POSTURE;
  const shoulderMid = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  const hipMid = midpoint(world[LM.leftHip], world[LM.rightHip]);
  const torso = Math.max(Math.abs((shoulderMid.y - hipMid.y) * signs.yUp), 0.15);
  const span = Math.max(Math.abs((world[LM.rightShoulder].x - world[LM.leftShoulder].x) * signs.xSign), 0.08);
  let behind = 0;
  let visible = 0;
  let elbows = 0;
  let elbowsSeen = 0;
  const sides = [
    { wrist: LM.leftWrist, elbow: LM.leftElbow, shoulder: LM.leftShoulder, ear: LM.leftEar, out: -1 },
    { wrist: LM.rightWrist, elbow: LM.rightElbow, shoulder: LM.rightShoulder, ear: LM.rightEar, out: 1 },
  ] as const;
  for (const side of sides) {
    const wrist = world[side.wrist];
    const ear = world[side.ear];
    const elbow = world[side.elbow];
    const shoulder = world[side.shoulder];
    if ((wrist?.visibility ?? 0) >= 0.25 && (ear?.visibility ?? 0) >= 0.2 && shoulder) {
      visible += 1;
      const high = (wrist.y - shoulder.y) * signs.yUp > torso * 0.05;
      const close = dist3(wrist, ear) < torso * 1.05;
      if (high && close) behind += 1;
    }
    if ((elbow?.visibility ?? 0) >= 0.25 && (shoulder?.visibility ?? 0) >= 0.25 && elbow && shoulder) {
      elbowsSeen += 1;
      const outward = (elbow.x - shoulder.x) * signs.xSign * side.out;
      if (outward > span * 0.2) elbows += 1;
    }
  }
  return { handsBehind: visible === 0 ? null : behind, handsVisible: visible, elbowsOut: elbowsSeen === 0 ? null : elbows };
}

/** One hand held in front of the chest. Used only when the gesture model is unavailable. */
export function presentedHand(world: Vec[]): boolean {
  if (world.length < 33) return false;
  const signs = detectSigns(world);
  if (!signs) return false;
  const shoulder = midpoint(world[LM.leftShoulder], world[LM.rightShoulder]);
  const hip = midpoint(world[LM.leftHip], world[LM.rightHip]);
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

/** True when both visible hands are behind the head. Unseen hands do not block the synthetic checks. */
export function handsSettled(posture: HandPosture): boolean {
  if (posture.handsVisible < 2 || posture.handsBehind == null) return true;
  return posture.handsBehind >= 2;
}

export function postureChecks(posture: HandPosture, handsBlocking: boolean): ConstraintCheck[] {
  return [handsCheck(posture, "setup", handsBlocking), elbowsCheck(posture, handsBlocking)];
}

function handsCheck(posture: HandPosture | undefined, category: CheckCategoryName, blocking = true): ConstraintCheck {
  const seen = posture ?? EMPTY_POSTURE;
  if (seen.handsBehind == null || seen.handsVisible < 2) {
    return {
      id: "hands-behind",
      label: "Hands behind head",
      category,
      value: null,
      warn: 1,
      fail: 2,
      unit: "",
      status: "na",
      blocking: false,
      message: "Clasp both hands behind the head, elbows out. Bring one hand forward only for the thumbs up.",
    };
  }
  const missing = 2 - seen.handsBehind;
  const status: CheckStatus = missing <= 0 ? "pass" : missing === 1 ? "warn" : "fail";
  const activeBlock = category === "setup" && blocking && (status === "fail" || status === "warn");
  return {
    id: "hands-behind",
    label: "Hands behind head",
    category,
    value: seen.handsBehind,
    warn: 1,
    fail: 0,
    unit: " hands",
    status,
    blocking: activeBlock,
    message: status === "pass" ? "Both hands are up beside the head." : status === "warn" ? "One hand is away from the head." : "Bring both hands behind the head.",
  };
}

function elbowsCheck(posture: HandPosture, blocking: boolean): ConstraintCheck {
  if (posture.elbowsOut == null) {
    return { id: "elbows-out", label: "Elbows out", category: "setup", value: null, warn: 1, fail: 2, unit: "", status: "na", blocking: false, message: "Elbows are not visible yet." };
  }
  const missing = 2 - posture.elbowsOut;
  const status: CheckStatus = missing <= 0 ? "pass" : missing === 1 ? "warn" : "fail";
  return {
    id: "elbows-out",
    label: "Elbows out",
    category: "setup",
    value: posture.elbowsOut,
    warn: 1,
    fail: 0,
    unit: "",
    status,
    blocking: blocking && status === "fail",
    message: status === "pass" ? "Elbows are out." : "Point the elbows out to the sides.",
  };
}

type CheckCategoryName = ConstraintCheck["category"];

function check(
  id: string,
  label: string,
  category: ConstraintCheck["category"],
  value: number | null,
  warn: number | null,
  fail: number | null,
  unit: string,
  blocking: boolean
): ConstraintCheck {
  const status = category === "info" || warn == null || fail == null ? (value == null ? "na" : "pass") : grade(value, warn, fail);
  return {
    id,
    label,
    category,
    value,
    warn,
    fail,
    unit,
    status,
    blocking,
    message: message(label, value, warn, fail, unit, status),
  };
}

function message(label: string, value: number | null, warn: number | null, fail: number | null, unit: string, status: CheckStatus): string {
  if (value == null) return `${label} unavailable`;
  const shown = `${Math.abs(value).toFixed(1)}${unit}`;
  if (status === "fail" && fail != null) return `${label} ${shown} is past the ${fail}${unit} fail line`;
  if (status === "warn" && warn != null) return `${label} ${shown} is past the ${warn}${unit} warning`;
  if (warn == null || fail == null) return `${label} ${shown}`;
  return `${shown} · warn ${warn}${unit} · fail ${fail}${unit}`;
}

export function worstStatus(checks: ConstraintCheck[]): CheckStatus {
  if (checks.some((item) => item.category === "hard" && item.status === "fail")) return "fail";
  if (checks.some((item) => item.status === "warn" || (item.blocking && item.status === "fail"))) return "warn";
  if (checks.length === 0) return "na";
  return "pass";
}

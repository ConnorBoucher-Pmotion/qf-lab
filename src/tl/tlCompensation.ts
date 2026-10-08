import type { TLConfig } from "./tlConfig";
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

export function setupChecks(input: CompInput, config: TLConfig): ConstraintCheck[] {
  return [
    check("upright", "Sit tall", "setup", input.uprightDeg, config.setupLeanWarnDeg, config.setupLeanFailDeg, "°", true),
    check("facing", "Face the camera", "setup", input.facingYawDeg, config.setupFacingWarnDeg, config.setupFacingFailDeg, "°", true),
    check("square", "Shoulders square to pelvis", "setup", input.squareDeg, config.neutralYawToleranceDeg, config.neutralYawToleranceDeg + 6, "°", true),
  ];
}

export function trialChecks(input: CompInput, config: TLConfig): ConstraintCheck[] {
  return [
    check("pelvis-rotation", "Pelvic rotation", "hard", input.pelvisRotationDeg, config.pelvisRotationWarnDeg, config.pelvisRotationFailDeg, "°", true),
    check("pelvis-translation", "Pelvic translation", "hard", input.pelvisTranslationPct, config.pelvisTranslationWarnPct, config.pelvisTranslationFailPct, "%", true),
    check("trunk-lateral", "Lateral trunk lean", "hard", input.lateralLeanDeg, config.lateralLeanWarnDeg, config.lateralLeanFailDeg, "°", true),
    check("trunk-forward", "Forward / back lean", "hard", input.forwardLeanDeg, config.forwardLeanWarnDeg, config.forwardLeanFailDeg, "°", true),
    check("knee-shift", "Knee movement", "hard", input.kneeShiftPct, config.kneeShiftWarnPct, config.kneeShiftFailPct, "%", true),
    check("hip-shift", "Hip movement", "hard", input.hipShiftPct, config.hipShiftWarnPct, config.hipShiftFailPct, "%", true),
    check("shoulder-tilt", "Shoulder height difference", "info", input.shoulderTiltDeg, null, null, "°", false),
    check("head-lead", "Head vs torso", "info", input.headLeadDeg, null, null, "°", false),
  ];
}

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

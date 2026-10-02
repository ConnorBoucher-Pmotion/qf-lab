import type { QFConfig } from "./qfConfig";
import type { CheckCategory, CheckStatus, ConstraintCheck, QFMetrics, TrackingStatus } from "./qfTypes";

/**
 * A. SETUP: can the athlete start? Tolerant. Only blocking checks gate
 *    POSITIONING → CALIBRATING; advisory ones warn.
 * B. MEASUREMENT: compensation relative to the calibrated baseline, in body units.
 * C. HARD: measurement checks listed in `config.hardConstraints`. A sustained
 *    fail rejects the trial. Defaults are only the compensations that change the
 *    frontal shank angle itself:
 *      pelvis-tilt   hip hike rotates the whole leg in the image
 *      knee-lateral  knee moving sideways swings the shank without hip rotation
 *      shank-short   foot moving toward the camera (knee extension) inflates atan(dx/dy)
 * D. SOFT: all other measurement checks. A fail lowers confidence and is
 *    recorded with the trial; it never rejects.
 */

export function statusOf(value: number | null, warn: number | null, fail: number | null, direction: "max" | "min"): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "na";
  if (direction === "max") {
    if (fail != null && value > fail) return "fail";
    if (warn != null && value > warn) return "warn";
    return "pass";
  }
  if (fail != null && value < fail) return "fail";
  if (warn != null && value < warn) return "warn";
  return "pass";
}

type Spec = {
  id: string;
  label: string;
  value: number | null;
  warn: number | null;
  fail: number | null;
  unit: string;
  direction?: "max" | "min";
  messages: { warn: string; fail: string; na?: string };
};

function make(spec: Spec, category: CheckCategory, blocking: boolean): ConstraintCheck {
  const direction = spec.direction ?? "max";
  const status = statusOf(spec.value, spec.warn, spec.fail, direction);
  const message =
    status === "fail" ? spec.messages.fail : status === "warn" ? spec.messages.warn : status === "na" ? spec.messages.na ?? "Not measurable" : "OK";
  return {
    id: spec.id,
    label: spec.label,
    category,
    value: spec.value,
    warn: spec.warn,
    fail: spec.fail,
    unit: spec.unit,
    direction,
    status,
    blocking,
    message,
  };
}

const abs = (v: number | null) => (v == null ? null : Math.abs(v));

export function buildSetupChecks(m: QFMetrics, tracking: TrackingStatus, c: QFConfig): ConstraintCheck[] {
  const checks: ConstraintCheck[] = [];
  for (const group of tracking.groups) {
    checks.push(
      make(
        {
          id: `visible-${group.id}`,
          label: `${group.label} tracked`,
          value: group.inFrame ? group.confidence : 0,
          warn: null,
          fail: group.threshold,
          unit: "",
          direction: "min",
          messages: {
            warn: "",
            fail: group.inFrame ? `${group.label} not tracked confidently. Improve lighting or remove whatever blocks it.` : `${group.label} is outside the frame.`,
          },
        },
        "setup",
        group.critical
      )
    );
  }
  if (!m.present) return checks;

  checks.push(
    make(
      {
        id: "in-frame",
        label: "Hips, knee, ankle inside frame",
        value: m.inFrameMargin,
        warn: c.setupEdgeWarn,
        fail: 0,
        unit: "frame",
        direction: "min",
        messages: { warn: "Close to the frame edge; move toward the centre.", fail: "Part of the leg or hips is outside the frame." },
      },
      "setup",
      true
    ),
    make(
      {
        id: "body-size",
        label: "Body size in frame (shank / height)",
        value: m.shankFrac,
        warn: c.setupShankFracWarn,
        fail: c.setupShankFracFail,
        unit: "",
        direction: "min",
        messages: { warn: "Leg is small in the frame; move the camera closer.", fail: "Too far from the camera." },
      },
      "setup",
      true
    ),
    make(
      {
        id: "shank-hang",
        label: "Shank hanging (advisory)",
        value: abs(m.absoluteShankDeg),
        warn: c.setupShankWarnDeg,
        fail: c.setupShankFailDeg,
        unit: "deg",
        messages: {
          warn: "Let the lower leg hang; a small offset is absorbed by calibration.",
          fail: "Lower leg is far from hanging. Relax it down if you can.",
        },
      },
      "setup",
      false
    ),
    make(
      {
        id: "facing",
        label: "Facing the camera (pelvis yaw, advisory)",
        value: m.facingYawDeg,
        warn: c.setupFacingWarnDeg,
        fail: c.setupFacingFailDeg,
        unit: "deg",
        messages: {
          warn: "Face the camera a bit more squarely if you can.",
          fail: "Body is turned a lot; the swing will look smaller. Turn toward the camera if you can.",
        },
      },
      "setup",
      false
    ),
    make(
      {
        id: "knee-side",
        label: "Tested knee on the selected side",
        value: m.kneeOnTestedSide ? 1 : 0,
        warn: null,
        fail: 0.5,
        unit: "",
        direction: "min",
        messages: { warn: "", fail: "The tested knee is not where expected; check the side selector." },
      },
      "setup",
      true
    ),
    make(
      {
        id: "torso-upright",
        label: "Torso upright",
        value: abs(m.torsoFromVerticalDeg),
        warn: c.setupTorsoWarnDeg,
        fail: c.setupTorsoFailDeg,
        unit: "deg",
        messages: { warn: "Sit tall.", fail: "Sit upright; the torso is leaning.", na: "Shoulders not visible" },
      },
      "setup",
      false
    ),
    make(
      {
        id: "camera-roll",
        label: "Hip line level (camera roll)",
        value: abs(m.hipLineTiltDeg),
        warn: c.setupRollWarnDeg,
        fail: c.setupRollFailDeg,
        unit: "deg",
        messages: {
          warn: "Hips look tilted; level the camera or the seat. The baseline removes a constant tilt.",
          fail: "Large hip tilt; level the camera. The baseline removes it, but check the setup.",
        },
      },
      "setup",
      false
    )
  );
  return checks;
}

export const MEASUREMENT_CHECK_IDS = [
  "pelvis-tilt",
  "knee-lateral",
  "shank-short",
  "pelvis-translation",
  "pelvis-rotation",
  "torso-lean",
  "torso-rotation",
  "femur-position",
  "shank-long",
  "movement-plane",
  "knee-flexion",
  "camera-distance",
  "other-leg",
] as const;

export function buildMeasurementChecks(m: QFMetrics, c: QFConfig, worldFlexionTrusted: boolean): ConstraintCheck[] {
  const specs: Spec[] = [
    {
      id: "pelvis-tilt",
      label: "Pelvis tilt (hip hike)",
      value: abs(m.pelvisTiltDeltaDeg),
      warn: c.pelvisTiltWarnDeg,
      fail: c.pelvisTiltFailDeg,
      unit: "deg",
      messages: { warn: "Keep both sit bones down.", fail: "Hip hiked; keep the pelvis level on the table." },
    },
    {
      id: "knee-lateral",
      label: "Knee lateral drift",
      value: abs(m.kneeLateralDeviation),
      warn: c.kneeLateralWarn,
      fail: c.kneeLateralFail,
      unit: "shank",
      messages: { warn: "Keep the knee still.", fail: "Knee moved sideways; keep the thigh still and rotate at the hip." },
    },
    {
      id: "shank-short",
      label: "Shank foreshortening (knee extension)",
      value: m.shankLengthRatio,
      warn: c.shankShortWarn,
      fail: c.shankShortFail,
      unit: "× hang",
      direction: "min",
      messages: { warn: "Keep the knee bent at 90°.", fail: "Knee straightening or foot toward the camera; keep the knee at 90°." },
    },
    {
      id: "pelvis-translation",
      label: "Pelvis translation",
      value: m.pelvisTranslation,
      warn: c.pelvisTranslationWarn,
      fail: c.pelvisTranslationFail,
      unit: "% hip",
      messages: { warn: "Stay seated in place.", fail: "Pelvis shifted on the table." },
    },
    {
      id: "pelvis-rotation",
      label: "Pelvis rotation (world yaw)",
      value: abs(m.pelvisRotationDeg),
      warn: c.pelvisRotationWarnDeg,
      fail: c.pelvisRotationFailDeg,
      unit: "deg",
      messages: { warn: "Keep the hips square.", fail: "Pelvis rotating; keep the hips square to the camera." },
    },
    {
      id: "torso-lean",
      label: "Torso lean",
      value: abs(m.torsoLeanDeltaDeg),
      warn: c.torsoLeanWarnDeg,
      fail: c.torsoLeanFailDeg,
      unit: "deg",
      messages: { warn: "Stay upright.", fail: "Leaning; sit tall.", na: "Shoulders not visible" },
    },
    {
      id: "torso-rotation",
      label: "Torso rotation (world yaw)",
      value: abs(m.torsoRotationDeg),
      warn: c.torsoRotationWarnDeg,
      fail: c.torsoRotationFailDeg,
      unit: "deg",
      messages: { warn: "Keep the shoulders square.", fail: "Torso rotating.", na: "Shoulders not visible" },
    },
    {
      id: "femur-position",
      label: "Femur (knee) position",
      value: m.femurDeviation,
      warn: c.femurPositionWarn,
      fail: c.femurPositionFail,
      unit: "shank",
      messages: { warn: "Keep the thigh still.", fail: "Thigh moved." },
    },
    {
      id: "shank-long",
      label: "Shank lengthening (foot away / flexion)",
      value: m.shankLengthRatio,
      warn: c.shankLongWarn,
      fail: c.shankLongFail,
      unit: "× hang",
      messages: { warn: "Keep the knee at 90°.", fail: "Shank length changed; keep the knee at 90°." },
    },
    {
      id: "movement-plane",
      label: "Movement plane (world depth)",
      value: abs(m.movementPlaneDeviation),
      warn: c.movementPlaneWarn,
      fail: c.movementPlaneFail,
      unit: "shank",
      messages: { warn: "Swing the foot sideways, not forward or back.", fail: "Foot moving forward/back, out of the rotation plane." },
    },
    {
      id: "knee-flexion",
      label: "Knee bend change (world)",
      value: worldFlexionTrusted ? abs(m.kneeFlexionDeltaDeg) : null,
      warn: c.kneeFlexionWarnDeg,
      fail: c.kneeFlexionFailDeg,
      unit: "deg",
      messages: { warn: "Keep the knee at 90°.", fail: "Knee angle changed.", na: "World knee angle unreliable in this setup" },
    },
    {
      id: "camera-distance",
      label: "Camera distance change (hip width)",
      value: abs(m.cameraScaleChange),
      warn: c.cameraDistanceWarn,
      fail: c.cameraDistanceFail,
      unit: "",
      messages: { warn: "Body scale changing; leaning toward/away from the camera?", fail: "Large scale change; camera or athlete moved." },
    },
    {
      id: "other-leg",
      label: "Other leg still",
      value: m.otherLegDeviation,
      warn: c.otherLegWarn,
      fail: c.otherLegFail,
      unit: "shank",
      messages: { warn: "Keep the other leg still.", fail: "Other leg moving." },
    },
  ];

  const hard = new Set(c.hardConstraints);
  const checks = specs.map((spec) => make(spec, hard.has(spec.id) ? "hard" : "soft", false));
  checks.push(
    make(
      {
        id: "femur-orientation",
        label: "Femur image orientation change",
        value: m.femurOrientationDeg,
        warn: null,
        fail: null,
        unit: "deg",
        messages: { warn: "", fail: "" },
      },
      "info",
      false
    )
  );
  return checks;
}

export function blockingSetupFailures(checks: ConstraintCheck[]): ConstraintCheck[] {
  return checks.filter((check) => check.category === "setup" && check.blocking && check.status === "fail");
}

export function hardFailures(checks: ConstraintCheck[]): ConstraintCheck[] {
  return checks.filter((check) => check.category === "hard" && check.status === "fail");
}

export function softIssues(checks: ConstraintCheck[]): ConstraintCheck[] {
  return checks.filter((check) => check.category === "soft" && (check.status === "warn" || check.status === "fail"));
}

export function constraintValueMap(checks: ConstraintCheck[]): Record<string, number | null> {
  return Object.fromEntries(checks.map((check) => [check.id, check.value]));
}

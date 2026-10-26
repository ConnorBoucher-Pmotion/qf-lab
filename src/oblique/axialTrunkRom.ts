/**
 * Axial trunk rotation relative to a locked pelvis baseline.
 *
 * Clinical quantity (functional TL Junction ROM):
 *   how far the upper torso TWISTS around the vertical axis,
 *   relative to the calibrated start, with pelvis tracked separately.
 *
 * NOT measured:
 *   2D shoulder-line image slope atan2(dy, dx) — that is tilt, not yaw.
 *
 * Coordinate systems (do not mix):
 *   WORLD — MediaPipe Pose world landmarks (meters). X = subject right, Y = down, Z = toward camera.
 *           Axial yaw lives in the XZ plane.
 *   IMAGE — pixel landmarks (unmirrored). CSS scaleX(-1) is display-only.
 */

import { mid, vis } from "./landmarks";
import type { LandmarkSample, RotationDirection, V3 } from "./types";
import { LM, type Vec } from "../pose/types";

export type XZ = { x: number; z: number };

export type AxialTrunkBaseline = {
  direction: RotationDirection;
  /** Locked pelvis endpoints + axis at READY. Never mutated. */
  leftHip: V3;
  rightHip: V3;
  pelvisMid: V3;
  pelvisAxis: XZ;
  pelvisYawDeg: number;
  /** Locked torso (shoulder) endpoints + axis at READY. */
  leftShoulder: V3;
  rightShoulder: V3;
  shoulderMid: V3;
  torsoAxis: XZ;
  torsoYawDeg: number;
  /** signedAngle(pelvisAxis, torsoAxis) at READY — zeroed out of relative ROM. */
  torsoVsPelvisOffsetDeg: number;
  /** Baseline projected 2D shoulder width (image pixels) if available. */
  imageShoulderWidthPx: number | null;
  /** Baseline primary-shoulder bearing in image (for visible-orbit signal). */
  imagePrimaryBearingDeg: number | null;
  /** Sealed image hip mid for orbit (pixels). */
  imageHipMid: V3 | null;
  /** Diagnostic: sealed 2D shoulder-line slope (NOT used for ROM). */
  imageShoulderSlopeDeg: number | null;
  /** Baseline world shoulder depth difference (right.z - left.z). */
  shoulderDepthDiff: number;
  sealedAtMs: number;
};

export type AxialSignalSet = {
  /** Diagnostic only — 2D image shoulder-line slope delta. NEVER drives ROM. */
  shoulderSlope2dDeg: number | null;
  /** World shoulder-axis yaw change from locked baseline torso yaw. */
  worldTorsoYawFromBaselineDeg: number | null;
  /** Absolute current / baseline torso yaw (world XZ). */
  currentTorsoYawDeg: number | null;
  baselineTorsoYawDeg: number | null;
  /** World pelvis-axis yaw change from locked baseline. */
  worldPelvisYawFromBaselineDeg: number | null;
  currentPelvisYawDeg: number | null;
  baselinePelvisYawDeg: number | null;
  /** (torso−baseline) − (pelvis−baseline), or equiv. relative plane change. */
  torsoRelativePelvisDeg: number | null;
  /** Shoulder depth difference change (right.z − left.z) mapped to degrees via atan. */
  depthDiffYawDeg: number | null;
  /** Projected image shoulder-width foreshortening → acos(width/baseline). */
  foreshorteningDeg: number | null;
  /** Visible (near) shoulder orbit around locked pelvis mid in world XZ. */
  visibleShoulderOrbitDeg: number | null;
  /** Image-plane primary shoulder orbit around locked hip mid. */
  imagePrimaryOrbitDeg: number | null;
};

export type AxialTrunkReading = AxialSignalSet & {
  /** Selected axial ROM magnitude in the trial direction (raw). */
  selectedRomDeg: number | null;
  /** Signed subject-right-positive axial ROM used for selection. */
  signedAxialDeg: number | null;
  selectedSource:
    | "world_torso_yaw"
    | "torso_relative_pelvis"
    | "visible_shoulder_orbit"
    | "depth_diff"
    | "foreshortening"
    | "image_orbit"
    | "fused"
    | "none";
  trustedShoulder: "both" | "left" | "right" | "none";
  occlusion: "none" | "left" | "right";
  leftShoulderConfidence: number;
  rightShoulderConfidence: number;
  leftHipConfidence: number;
  rightHipConfidence: number;
  baselineLocked: true;
  /** Live landmark dumps for HUD. */
  world: {
    leftShoulder: V3;
    rightShoulder: V3;
    leftHip: V3;
    rightHip: V3;
  };
  image: {
    leftShoulder: V3;
    rightShoulder: V3;
    leftHip: V3;
    rightHip: V3;
  } | null;
};

export function sealAxialTrunkBaseline(
  world: LandmarkSample,
  image: LandmarkSample | null,
  direction: RotationDirection,
  now: number
): AxialTrunkBaseline | null {
  const pelvisAxis = xzAxis(world.rightHip, world.leftHip);
  const torsoAxis = xzAxis(world.rightShoulder, world.leftShoulder);
  if (!pelvisAxis || !torsoAxis) return null;
  const pelvisYaw = axisYaw(pelvisAxis);
  const torsoYaw = axisYaw(torsoAxis);
  const offset = signedAngleXZ(pelvisAxis, torsoAxis);
  if (pelvisYaw == null || torsoYaw == null || offset == null) return null;

  const pelvisMid = mid(world.leftHip, world.rightHip);
  const shoulderMid = mid(world.leftShoulder, world.rightShoulder);

  let imageShoulderWidthPx: number | null = null;
  let imagePrimaryBearingDeg: number | null = null;
  let imageHipMid: V3 | null = null;
  let imageShoulderSlopeDeg: number | null = null;
  if (image) {
    imageShoulderWidthPx = Math.hypot(
      image.rightShoulder.x - image.leftShoulder.x,
      image.rightShoulder.y - image.leftShoulder.y
    );
    const imgHipMid = mid(image.leftHip, image.rightHip);
    imageHipMid = copyV3(imgHipMid);
    const imgPrimary = direction === "right" ? image.leftShoulder : image.rightShoulder;
    imagePrimaryBearingDeg = imageBearingDeg(imgPrimary, imgHipMid);
    imageShoulderSlopeDeg = imageShoulderSlopeDegFn(image);
  }

  return {
    direction,
    leftHip: copyV3(world.leftHip),
    rightHip: copyV3(world.rightHip),
    pelvisMid: copyV3(pelvisMid),
    pelvisAxis: { ...pelvisAxis },
    pelvisYawDeg: pelvisYaw,
    leftShoulder: copyV3(world.leftShoulder),
    rightShoulder: copyV3(world.rightShoulder),
    shoulderMid: copyV3(shoulderMid),
    torsoAxis: { ...torsoAxis },
    torsoYawDeg: torsoYaw,
    torsoVsPelvisOffsetDeg: offset,
    imageShoulderWidthPx,
    imagePrimaryBearingDeg,
    imageHipMid,
    imageShoulderSlopeDeg,
    shoulderDepthDiff: world.rightShoulder.z - world.leftShoulder.z,
    sealedAtMs: now,
  };
}

export function computeAxialTrunkRom(
  world: LandmarkSample,
  image: LandmarkSample | null,
  baseline: AxialTrunkBaseline,
  opts: {
    minConfidence: number;
    softConfidence: number;
  }
): AxialTrunkReading {
  const leftConf = vis(world.leftShoulder);
  const rightConf = vis(world.rightShoulder);
  const leftOk = leftConf >= opts.minConfidence;
  const rightOk = rightConf >= opts.minConfidence;
  const leftSoft = leftConf >= opts.softConfidence;
  const rightSoft = rightConf >= opts.softConfidence;

  const far: "left" | "right" = baseline.direction === "right" ? "right" : "left";
  const near: "left" | "right" = far === "right" ? "left" : "right";
  const farOk = far === "right" ? rightOk : leftOk;
  const nearSoft = near === "left" ? leftSoft : rightSoft;

  let occlusion: AxialTrunkReading["occlusion"] = "none";
  if (!farOk) occlusion = far;
  else if (!leftOk && leftSoft === false) occlusion = "left";
  else if (!rightOk && rightSoft === false) occlusion = "right";

  let trusted: AxialTrunkReading["trustedShoulder"] = "none";
  if (leftOk && rightOk) trusted = "both";
  else if (nearSoft) trusted = near;
  else if (leftSoft) trusted = "left";
  else if (rightSoft) trusted = "right";

  const curTorsoAxis = xzAxis(world.rightShoulder, world.leftShoulder);
  const curPelvisAxis = xzAxis(world.rightHip, world.leftHip);
  const currentTorsoYaw = curTorsoAxis ? axisYaw(curTorsoAxis) : null;
  const currentPelvisYaw = curPelvisAxis ? axisYaw(curPelvisAxis) : null;

  const worldTorsoFromBase =
    currentTorsoYaw == null ? null : shortest(currentTorsoYaw - baseline.torsoYawDeg);
  const worldPelvisFromBase =
    currentPelvisYaw == null ? null : shortest(currentPelvisYaw - baseline.pelvisYawDeg);

  // Relative plane: current torso vs LOCKED pelvis axis, minus READY offset.
  // (Does not redefine zero from live hips.)
  let torsoRelativePelvis: number | null = null;
  if (curTorsoAxis) {
    const rel = signedAngleXZ(baseline.pelvisAxis, curTorsoAxis);
    if (rel != null) torsoRelativePelvis = shortest(rel - baseline.torsoVsPelvisOffsetDeg);
  }

  // Depth difference signal: Δ(right.z − left.z) → atan2-like angle proxy.
  const depthNow = world.rightShoulder.z - world.leftShoulder.z;
  const depthDelta = depthNow - baseline.shoulderDepthDiff;
  const shoulderSpan = Math.hypot(
    world.rightShoulder.x - world.leftShoulder.x,
    world.rightShoulder.z - world.leftShoulder.z
  );
  const depthDiffYaw =
    shoulderSpan > 1e-4 ? (Math.atan2(depthDelta, shoulderSpan) * 180) / Math.PI : null;

  // Foreshortening from image width (supporting signal).
  let foreshortening: number | null = null;
  if (image && baseline.imageShoulderWidthPx != null && baseline.imageShoulderWidthPx > 1) {
    const w = Math.hypot(
      image.rightShoulder.x - image.leftShoulder.x,
      image.rightShoulder.y - image.leftShoulder.y
    );
    const ratio = Math.max(0, Math.min(1, w / baseline.imageShoulderWidthPx));
    const mag = (Math.acos(ratio) * 180) / Math.PI;
    // Sign from world depth of near vs far shoulder relative to baseline mid.
    const nearLm = near === "left" ? world.leftShoulder : world.rightShoulder;
    const farLm = far === "left" ? world.leftShoulder : world.rightShoulder;
    const nearCloser = nearLm.z > farLm.z; // larger z = closer to camera in MediaPipe
    const trialSign = baseline.direction === "right" ? 1 : -1;
    // When rotating right, far (right) should go away (smaller z) → nearCloser true typically.
    foreshortening = (nearCloser ? 1 : -1) * trialSign * mag;
  }

  // Visible near-shoulder orbit in world XZ around LOCKED pelvis mid.
  let visibleOrbit: number | null = null;
  if (nearSoft) {
    const sh = near === "left" ? world.leftShoulder : world.rightShoulder;
    const baseSh = near === "left" ? baseline.leftShoulder : baseline.rightShoulder;
    const baseVec = {
      x: baseSh.x - baseline.pelvisMid.x,
      z: baseSh.z - baseline.pelvisMid.z,
    };
    const curVec = {
      x: sh.x - baseline.pelvisMid.x,
      z: sh.z - baseline.pelvisMid.z,
    };
    visibleOrbit = signedAngleXZ(baseVec, curVec);
  }

  // Image primary orbit (unmirrored pixels) — useful when world Z is weak.
  let imageOrbit: number | null = null;
  if (image && baseline.imagePrimaryBearingDeg != null && baseline.imageHipMid) {
    const imgPrimary = baseline.direction === "right" ? image.leftShoulder : image.rightShoulder;
    const bearing = imageBearingDeg(imgPrimary, baseline.imageHipMid);
    if (bearing != null) {
      imageOrbit = Math.abs(shortest(bearing - baseline.imagePrimaryBearingDeg));
    }
  }

  // Diagnostic 2D shoulder-line slope delta — NEVER selected as ROM.
  let slope2d: number | null = null;
  if (image && baseline.imageShoulderSlopeDeg != null) {
    const cur = imageShoulderSlopeDegFn(image);
    if (cur != null) slope2d = shortest(cur - baseline.imageShoulderSlopeDeg);
  } else if (image) {
    slope2d = imageShoulderSlopeDegFn(image);
  }

  const signals: AxialSignalSet = {
    shoulderSlope2dDeg: slope2d,
    worldTorsoYawFromBaselineDeg: worldTorsoFromBase,
    currentTorsoYawDeg: currentTorsoYaw,
    baselineTorsoYawDeg: baseline.torsoYawDeg,
    worldPelvisYawFromBaselineDeg: worldPelvisFromBase,
    currentPelvisYawDeg: currentPelvisYaw,
    baselinePelvisYawDeg: baseline.pelvisYawDeg,
    torsoRelativePelvisDeg: torsoRelativePelvis,
    depthDiffYawDeg: depthDiffYaw,
    foreshorteningDeg: foreshortening,
    visibleShoulderOrbitDeg: visibleOrbit,
    imagePrimaryOrbitDeg: imageOrbit,
  };

  const selected = selectAxialRom(signals, baseline.direction, trusted, occlusion);

  return {
    ...signals,
    selectedRomDeg: selected.rom,
    signedAxialDeg: selected.signed,
    selectedSource: selected.source,
    trustedShoulder: trusted,
    occlusion,
    leftShoulderConfidence: leftConf,
    rightShoulderConfidence: rightConf,
    leftHipConfidence: vis(world.leftHip),
    rightHipConfidence: vis(world.rightHip),
    baselineLocked: true,
    world: {
      leftShoulder: copyV3(world.leftShoulder),
      rightShoulder: copyV3(world.rightShoulder),
      leftHip: copyV3(world.leftHip),
      rightHip: copyV3(world.rightHip),
    },
    image: image
      ? {
          leftShoulder: copyV3(image.leftShoulder),
          rightShoulder: copyV3(image.rightShoulder),
          leftHip: copyV3(image.leftHip),
          rightHip: copyV3(image.rightHip),
        }
      : null,
  };
}

/**
 * Select axial ROM from geometrically meaningful signals.
 * Never uses 2D shoulder slope.
 */
function selectAxialRom(
  s: AxialSignalSet,
  direction: RotationDirection,
  trusted: AxialTrunkReading["trustedShoulder"],
  occlusion: AxialTrunkReading["occlusion"]
): {
  rom: number | null;
  signed: number | null;
  source: AxialTrunkReading["selectedSource"];
} {
  const dirSign = direction === "right" ? 1 : -1;
  const trialMag = (signed: number | null): number | null => {
    if (signed == null || !Number.isFinite(signed)) return null;
    return Math.max(0, signed * dirSign);
  };

  // Primary candidates (signed, subject-right +).
  const torso = s.worldTorsoYawFromBaselineDeg;
  const relPelvis = s.torsoRelativePelvisDeg;
  const visible = s.visibleShoulderOrbitDeg;
  const depth = s.depthDiffYawDeg;
  const foreshort = s.foreshorteningDeg;

  // When both shoulders trusted: prefer torso-relative-pelvis (locked pelvis), else torso yaw.
  if (trusted === "both") {
    if (relPelvis != null && Math.abs(relPelvis) >= 0.5) {
      return { rom: trialMag(relPelvis), signed: relPelvis, source: "torso_relative_pelvis" };
    }
    if (torso != null) {
      return { rom: trialMag(torso), signed: torso, source: "world_torso_yaw" };
    }
  }

  // Occlusion expected: use visible near-shoulder orbit in world XZ.
  if (occlusion !== "none" && visible != null) {
    // visible orbit uses signedAngleXZ of near shoulder — align to subject-right +.
    // Near = left for right-rotation → orbit sign already subject-frame; flip for left trial.
    const signed = direction === "right" ? -(visible) : visible;
    const mag = trialMag(signed);
    // If world torso also reports and they disagree wildly, prefer the larger consistent signal.
    if (torso != null && mag != null && Math.abs(torso) > mag * 1.4 && Math.sign(torso) === Math.sign(signed || 1)) {
      return { rom: trialMag(torso), signed: torso, source: "world_torso_yaw" };
    }
    return { rom: mag, signed, source: "visible_shoulder_orbit" };
  }

  // World Z weak: fuse supporting signals when torso under-reports.
  const torsoMag = Math.abs(torso ?? 0);
  const supportCandidates: Array<{ signed: number; source: AxialTrunkReading["selectedSource"] }> = [];
  if (visible != null) {
    const signed = direction === "right" ? -visible : visible;
    supportCandidates.push({ signed, source: "visible_shoulder_orbit" });
  }
  if (depth != null) supportCandidates.push({ signed: depth, source: "depth_diff" });
  if (foreshort != null) supportCandidates.push({ signed: foreshort, source: "foreshortening" });
  if (s.imagePrimaryOrbitDeg != null) {
    supportCandidates.push({
      signed: dirSign * s.imagePrimaryOrbitDeg,
      source: "image_orbit",
    });
  }

  // If primary torso is strong enough, use it.
  if (torso != null && torsoMag >= 8) {
    return { rom: trialMag(torso), signed: torso, source: "world_torso_yaw" };
  }
  if (relPelvis != null && Math.abs(relPelvis) >= 8) {
    return { rom: trialMag(relPelvis), signed: relPelvis, source: "torso_relative_pelvis" };
  }

  // Fuse supports that agree in trial direction (same sign as dirSign).
  const agreeing = supportCandidates.filter((c) => c.signed * dirSign > 3);
  if (agreeing.length >= 2) {
    const mags = agreeing.map((c) => Math.abs(c.signed));
    // Median magnitude, signed in trial direction.
    mags.sort((a, b) => a - b);
    const med = mags[Math.floor(mags.length / 2)]!;
    const signed = dirSign * med;
    return { rom: med, signed, source: "fused" };
  }
  if (agreeing.length === 1) {
    const c = agreeing[0]!;
    return { rom: trialMag(c.signed), signed: c.signed, source: c.source };
  }

  // Fallbacks
  if (relPelvis != null) return { rom: trialMag(relPelvis), signed: relPelvis, source: "torso_relative_pelvis" };
  if (torso != null) return { rom: trialMag(torso), signed: torso, source: "world_torso_yaw" };
  if (s.imagePrimaryOrbitDeg != null) {
    return {
      rom: s.imagePrimaryOrbitDeg,
      signed: dirSign * s.imagePrimaryOrbitDeg,
      source: "image_orbit",
    };
  }
  return { rom: null, signed: null, source: "none" };
}

export function xzAxis(right: V3, left: V3): XZ | null {
  const x = right.x - left.x;
  const z = right.z - left.z;
  if (Math.hypot(x, z) < 1e-6) return null;
  return { x, z };
}

/** Horizontal yaw of an axis (right − left). Subject-right-positive. */
export function axisYaw(axis: XZ): number {
  return (-Math.atan2(axis.z, axis.x) * 180) / Math.PI;
}

export function signedAngleXZ(a: XZ, b: XZ): number | null {
  const aMag = Math.hypot(a.x, a.z);
  const bMag = Math.hypot(b.x, b.z);
  if (aMag < 1e-6 || bMag < 1e-6) return null;
  const dot = a.x * b.x + a.z * b.z;
  const cross = a.x * b.z - a.z * b.x;
  return (-Math.atan2(cross, dot) * 180) / Math.PI;
}

export function shortest(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

function imageShoulderSlopeDegFn(sample: LandmarkSample): number | null {
  const dx = sample.rightShoulder.x - sample.leftShoulder.x;
  const dy = sample.rightShoulder.y - sample.leftShoulder.y;
  if (Math.hypot(dx, dy) < 1e-3) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function imageBearingDeg(shoulder: Vec, hipMid: V3): number | null {
  const dx = shoulder.x - hipMid.x;
  const dy = shoulder.y - hipMid.y;
  if (Math.hypot(dx, dy) < 1e-3) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

function copyV3(p: { x: number; y: number; z: number }): V3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function extractImageSample(image: Vec[]): LandmarkSample | null {
  if (image.length < 33) return null;
  return {
    leftShoulder: image[LM.leftShoulder],
    rightShoulder: image[LM.rightShoulder],
    leftHip: image[LM.leftHip],
    rightHip: image[LM.rightHip],
    leftElbow: image[LM.leftElbow],
    rightElbow: image[LM.rightElbow],
    leftEar: image[LM.leftEar],
    rightEar: image[LM.rightEar],
    nose: image[LM.nose],
  };
}

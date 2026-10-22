import { LM } from "../src/pose/types";
import { OBLIQUE_CONFIG } from "../src/oblique/config";
import { ObliqueSession } from "../src/oblique/session";
import { computeRotation, directionalRom } from "../src/oblique/rotation";
import { angleDelta, thoracicRelativeYawDeg } from "../src/oblique/vectors";
import { syntheticSeated } from "../src/tl/tlRotation";

const near = (value: number | null, expected: number, tol: number, label: string) => {
  if (value == null || Math.abs(value - expected) > tol) throw new Error(`${label}: expected ${expected} ± ${tol}, got ${value}`);
};

const neutral = syntheticSeated();
const turned = syntheticSeated({ shoulderYawDeg: 35, pelvisYawDeg: 2 });
const s0 = {
  x: neutral.world[LM.rightShoulder].x - neutral.world[LM.leftShoulder].x,
  y: neutral.world[LM.rightShoulder].y - neutral.world[LM.leftShoulder].y,
  z: neutral.world[LM.rightShoulder].z - neutral.world[LM.leftShoulder].z,
};
const h0 = {
  x: neutral.world[LM.rightHip].x - neutral.world[LM.leftHip].x,
  y: neutral.world[LM.rightHip].y - neutral.world[LM.leftHip].y,
  z: neutral.world[LM.rightHip].z - neutral.world[LM.leftHip].z,
};
const s1 = {
  x: turned.world[LM.rightShoulder].x - turned.world[LM.leftShoulder].x,
  y: turned.world[LM.rightShoulder].y - turned.world[LM.leftShoulder].y,
  z: turned.world[LM.rightShoulder].z - turned.world[LM.leftShoulder].z,
};
const h1 = {
  x: turned.world[LM.rightHip].x - turned.world[LM.leftHip].x,
  y: turned.world[LM.rightHip].y - turned.world[LM.leftHip].y,
  z: turned.world[LM.rightHip].z - turned.world[LM.leftHip].z,
};
const rel0 = thoracicRelativeYawDeg(s0, h0);
const rel1 = thoracicRelativeYawDeg(s1, h1);
if (rel0 == null || rel1 == null) throw new Error("relative yaw missing");
const thoracic = angleDelta(rel1, rel0);
near(directionalRom(thoracic, "right"), 33, 4, "oblique thoracic right ROM");

const session = new ObliqueSession("right", { ...OBLIQUE_CONFIG, countdownMs: 0, thumbStableMs: 0, stableMs: 100, calibrationMs: 200, minCalibrationFrames: 4 });
let t = 0;
for (let i = 0; i < 40; i += 1) {
  session.push({ width: 1280, height: 720, ...syntheticSeated() }, t);
  t += 33;
}
session.arm(t);
t += 33;
for (let i = 0; i < 20; i += 1) {
  session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 10 + i * 1.2, pelvisYawDeg: 1 }) }, t);
  t += 33;
}
const live = session.push({ width: 1280, height: 720, ...syntheticSeated({ shoulderYawDeg: 36, pelvisYawDeg: 1 }) }, t);
if ((live.maxRawRom ?? 0) < 25) throw new Error(`oblique raw max too low: ${live.maxRawRom}`);
if (live.movementStarted !== true) throw new Error("oblique should be measuring");
// Chin snap should not invent absolute 3D explosion — raw may stall/assist but stay bounded.
const nose = live.frame.rightShoulder;
void nose;
const snap = syntheticSeated({ shoulderYawDeg: 38, pelvisYawDeg: 1 });
snap.world[LM.rightShoulder] = { ...snap.world[LM.nose], visibility: 0.85, x: snap.world[LM.nose].x + 0.02, y: snap.world[LM.nose].y - 0.02 };
const after = session.push({ width: 1280, height: 720, ...snap }, t + 33);
if ((after.rawRom ?? 0) > 70) throw new Error(`oblique raw exploded after chin snap: ${after.rawRom}`);
if ((after.rawRom ?? 0) + 8 < (live.maxRawRom ?? 0) && after.frame.occlusionActive !== true) {
  throw new Error(`chin snap should trigger occlusion assist or keep ROM near prior (${live.maxRawRom} → ${after.rawRom})`);
}

void computeRotation;
console.log("Oblique math checks passed", { thoracic: thoracic.toFixed(1), maxRaw: live.maxRawRom?.toFixed(1), afterRaw: after.rawRom?.toFixed(1) });

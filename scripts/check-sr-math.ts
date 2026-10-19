import { evaluateAcceptance, isAngleSpike, updateCandidate } from "../src/sr/srAcceptance";
import { grade, gradeTarget } from "../src/sr/srConstraints";
import { SR_CONFIG, normalizeConfig } from "../src/sr/srConfig";
import { SRSession } from "../src/sr/srStateMachine";
import { cameraFacing, detectSigns, elbowFlexionDeg, readShoulder, shoulderAbductionDeg, syntheticGoalpost } from "../src/sr/srGeometry";
import { LM } from "../src/pose/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const pose = syntheticGoalpost({ leftErDeg: 0, rightErDeg: 0 });
assert(detectSigns(pose.world), "signs");
const reading = readShoulder(pose.world, null);
assert(reading.left.abductionDeg != null && reading.left.abductionDeg > 60, `left abduction ${reading.left.abductionDeg}`);
assert(reading.right.elbowFlexionDeg != null && reading.right.elbowFlexionDeg > 60, `right elbow ${reading.right.elbowFlexionDeg}`);

const rotated = syntheticGoalpost({ leftErDeg: 40, rightErDeg: 35 });
const baseline = {
  left: {
    forearmDir: { x: pose.world[LM.leftWrist].x - pose.world[LM.leftElbow].x, y: pose.world[LM.leftWrist].y - pose.world[LM.leftElbow].y, z: pose.world[LM.leftWrist].z - pose.world[LM.leftElbow].z },
    elbow: { x: pose.world[LM.leftElbow].x, y: pose.world[LM.leftElbow].y, z: pose.world[LM.leftElbow].z },
    shoulder: { x: pose.world[LM.leftShoulder].x, y: pose.world[LM.leftShoulder].y, z: pose.world[LM.leftShoulder].z },
    abductionDeg: reading.left.abductionDeg!,
    elbowFlexionDeg: reading.left.elbowFlexionDeg!,
    shoulderY: pose.world[LM.leftShoulder].y,
  },
  right: {
    forearmDir: { x: pose.world[LM.rightWrist].x - pose.world[LM.rightElbow].x, y: pose.world[LM.rightWrist].y - pose.world[LM.rightElbow].y, z: pose.world[LM.rightWrist].z - pose.world[LM.rightElbow].z },
    elbow: { x: pose.world[LM.rightElbow].x, y: pose.world[LM.rightElbow].y, z: pose.world[LM.rightElbow].z },
    shoulder: { x: pose.world[LM.rightShoulder].x, y: pose.world[LM.rightShoulder].y, z: pose.world[LM.rightShoulder].z },
    abductionDeg: reading.right.abductionDeg!,
    elbowFlexionDeg: reading.right.elbowFlexionDeg!,
    shoulderY: pose.world[LM.rightShoulder].y,
  },
};
const moved = readShoulder(rotated.world, baseline);
assert(moved.left.signedRotationDeg != null && Math.abs(moved.left.signedRotationDeg) > 10, `left rotation ${moved.left.signedRotationDeg}`);

assert(grade(5, 10, 20) === "pass", "grade pass");
assert(gradeTarget(90, 90, 10, 20) === "pass", "target pass");
assert(gradeTarget(70, 90, 10, 20) === "fail", "target fail");
assert(!isAngleSpike(10, 12, 33, 18, 220), "no spike");
assert(isAngleSpike(10, 40, 33, 18, 220), "spike");

const candidate = updateCandidate(null, 40, 1000, 450, 2.5);
assert(candidate.candidate, "candidate created");
const promoted = updateCandidate(candidate.candidate, 40.5, 1100, 450, 2.5);
const again = updateCandidate(promoted.candidate, 40.2, 1200, 450, 2.5);
assert(again.promoted != null || again.candidate, "candidate progress");

const facing = cameraFacing(pose.world);
assert(facing.scoreDeg != null && facing.scoreDeg < 30, `facing ${facing.scoreDeg}`);

const abd = shoulderAbductionDeg(pose.world[LM.leftShoulder], pose.world[LM.leftElbow], { x: 0, y: 0, z: 0 }, { x: 0, y: 0.52, z: 0 });
const elb = elbowFlexionDeg(pose.world[LM.leftShoulder], pose.world[LM.leftElbow], pose.world[LM.leftWrist]);
assert(abd != null && elb != null, "angles");

const fast = normalizeConfig({
  ...SR_CONFIG,
  stableMs: 100,
  calibrationMs: 200,
  minCalibrationFrames: 6,
  countdownMs: 0,
  thumbStableMs: 200,
  captureWindowMs: 2000,
  minMovementDeg: 5,
  movementConfirmFrames: 2,
  bypassFaceCamera: true,
});

function feed(session: SRSession, _sample: ReturnType<typeof syntheticGoalpost>, frames: number, start: number, er = 0): number {
  let t = start;
  for (let i = 0; i < frames; i += 1) {
    t += 33;
    const frame = syntheticGoalpost({ leftErDeg: er, rightErDeg: er * 0.9, width: 1280, height: 720 });
    session.push({ width: 1280, height: 720, image: frame.image, world: frame.world }, t);
  }
  return t;
}

const session = new SRSession(fast);
let now = 0;
now = feed(session, pose, 40, now, 0);
let snap = session.push({ width: 1280, height: 720, image: pose.image, world: pose.world, thumbUp: true }, (now += 33));
for (let i = 0; i < 10; i += 1) {
  snap = session.push({ width: 1280, height: 720, image: pose.image, world: pose.world, thumbUp: true }, (now += 33));
}
if (snap.state === "READY" || snap.state === "READY_CONFIRMING" || snap.baselineReady) {
  session.arm(now += 33);
}
now = feed(session, pose, 10, now, 0);
now = feed(session, pose, 40, now, 35);
snap = session.push({ width: 1280, height: 720, image: rotated.image, world: rotated.world }, (now += 33));
assert(snap.movementStarted || snap.state === "ACTIVE" || snap.state === "MEASURING" || snap.state === "COMPLETE" || snap.baselineReady, `state ${snap.state}`);

const acceptance = evaluateAcceptance({
  checks: [],
  vis: {
    leftShoulder: 0.9,
    rightShoulder: 0.9,
    leftElbow: 0.9,
    rightElbow: 0.9,
    leftWrist: 0.9,
    rightWrist: 0.9,
    leftHip: 0.9,
    rightHip: 0.9,
  },
  config: SR_CONFIG,
  spike: false,
  hardPersistFailed: false,
});
assert(acceptance.acceptPeak, "accept peak");

console.log("SR math checks passed");

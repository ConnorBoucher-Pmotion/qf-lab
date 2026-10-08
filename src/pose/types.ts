/** MediaPipe Pose landmark indexes. Image x is right, y is down. */

export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type Side = "left" | "right";

export type Vec = {
  x: number;
  y: number;
  z: number;
  visibility: number;
  /** True when this sample was held from the previous frame instead of accepted. */
  held?: boolean;
};

export type JointName = "shoulder" | "hip" | "knee" | "ankle";

const JOINT_INDEX: Record<Side, Record<JointName, number>> = {
  left: { shoulder: LM.leftShoulder, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  right: { shoulder: LM.rightShoulder, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
};

export function jointIndex(side: Side, joint: JointName): number {
  return JOINT_INDEX[side][joint];
}

export function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

export type RawLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

export function confidenceOf(lm: RawLandmark | undefined): number {
  if (!lm) return 0;
  const vis = lm.visibility == null ? 1 : lm.visibility;
  const presence = lm.presence == null ? 1 : lm.presence;
  return Math.min(vis, presence);
}

import { useEffect, useRef, useState } from "react";
import type { SRConfig } from "../sr/srConfig";
import { SRSession } from "../sr/srStateMachine";
import type { SRSnapshot } from "../sr/srTypes";
import { syntheticGoalpost } from "../sr/srGeometry";
import { LM } from "../pose/types";
import { createTlPoseLandmarker, imageLandmarks, worldLandmarks, type PoseLandmarkerHandle } from "../pose/mediaPipePose";
import { createThumbRecognizer, isThumbUp, type GestureHandle } from "../pose/thumbsUp";
import { TrialRecorder, type RecorderStatus, type SavedRecording } from "../recording/trialRecorder";
import { drawSrOverlay } from "./SROverlay";

type Props = {
  config: SRConfig;
  resetSignal: number;
  nextSignal: number;
  startSignal: number;
  voiceSignal: number;
  acceptSignal: number;
  preRollMs: number;
  postRollMs: number;
  onSnapshot: (snapshot: SRSnapshot) => void;
  onRecording: (recording: SavedRecording) => void;
  onRecorderStatus: (status: RecorderStatus) => void;
};

export function CameraView({ config, resetSignal, nextSignal, startSignal, voiceSignal, acceptSignal, preRollMs, postRollMs, onSnapshot, onRecording, onRecorderStatus }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  const onRecordingRef = useRef(onRecording);
  const onStatusRef = useRef(onRecorderStatus);
  const preRollRef = useRef(preRollMs);
  const postRollRef = useRef(postRollMs);
  const configRef = useRef(config);
  const sessionRef = useRef<SRSession | null>(null);
  onSnapshotRef.current = onSnapshot;
  onRecordingRef.current = onRecording;
  onStatusRef.current = onRecorderStatus;
  preRollRef.current = preRollMs;
  postRollRef.current = postRollMs;
  configRef.current = config;
  const [status, setStatus] = useState("Starting camera…");
  const [recPhase, setRecPhase] = useState<RecorderStatus["phase"]>("off");

  useEffect(() => {
    sessionRef.current?.setConfig(config);
  }, [config]);
  useEffect(() => {
    if (resetSignal === 0) return;
    sessionRef.current?.reset();
  }, [resetSignal]);
  useEffect(() => {
    if (nextSignal === 0) return;
    sessionRef.current?.nextTrial();
  }, [nextSignal]);
  useEffect(() => {
    if (startSignal === 0) return;
    sessionRef.current?.arm(performance.now());
  }, [startSignal]);
  useEffect(() => {
    if (voiceSignal === 0) return;
    sessionRef.current?.hearReady(performance.now());
  }, [voiceSignal]);
  useEffect(() => {
    if (acceptSignal === 0) return;
    sessionRef.current?.acceptPeak();
  }, [acceptSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = new SRSession(configRef.current);
    sessionRef.current = session;
    const synthetic = new URLSearchParams(window.location.search).get("synthetic") === "1";
    let cancelled = false;
    let raf = 0;
    let lastDetectTs = -1;
    let lastUi = 0;
    let lastState = "";
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarkerHandle | null = null;
    let gestures: GestureHandle | null = null;
    let gestureReady: boolean | undefined;
    const started = performance.now();

    const video = document.createElement("video");
    video.className = "camera-feed";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    host.replaceChildren(video, canvas);
    const ctx = canvas.getContext("2d");
    const source = document.createElement("canvas");
    source.width = 1280;
    source.height = 720;
    const sourceCtx = source.getContext("2d");
    const recorder = new TrialRecorder(canvas, {
      onSaved: (recording) => onRecordingRef.current(recording),
      onStatus: (next) => {
        setRecPhase((phase) => (phase === next.phase ? phase : next.phase));
        onStatusRef.current(next);
      },
      preRollMs: () => preRollRef.current,
      postRollMs: () => postRollRef.current,
    });

    const publish = (snapshot: SRSnapshot, now: number) => {
      if (snapshot.state !== lastState || now - lastUi > 80) {
        lastState = snapshot.state;
        lastUi = now;
        onSnapshotRef.current(snapshot);
      }
    };

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (!ctx) return;
      const now = Math.round(performance.now());
      if (now <= lastDetectTs) return;
      lastDetectTs = now;
      if (synthetic) {
        const pose = syntheticGoalpost({ leftErDeg: scriptedEr(now - started), rightErDeg: scriptedEr(now - started) * 0.9, width: 1280, height: 720 });
        drawBody(sourceCtx, pose.image);
        if (canvas.width !== 1280 || canvas.height !== 720) {
          canvas.width = 1280;
          canvas.height = 720;
        }
        session.setConfig(configRef.current);
        const snapshot = session.push({ width: 1280, height: 720, image: pose.image, world: pose.world }, now);
        snapshot.cameraActive = true;
        drawSrOverlay(ctx, 1280, 720, snapshot, configRef.current);
        publish(snapshot, now);
        try {
          recorder.capture(video, snapshot, now);
        } catch {
          // Recording must never stop the measurement loop.
        }
        return;
      }
      if (video.readyState < 2 || !landmarker) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width < 2 || height < 2) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      try {
        const detection = landmarker.detectForVideo(video, now);
        const image = imageLandmarks(detection.landmarks?.[0], width, height);
        const world = worldLandmarks(detection.worldLandmarks?.[0], detection.landmarks?.[0]);
        let thumbUp = false;
        if (gestures && session.wantsThumb()) {
          try {
            thumbUp = isThumbUp(gestures.recognizeForVideo(video, now));
          } catch {
            thumbUp = false;
          }
        }
        session.setConfig(configRef.current);
        const snapshot = session.push({ width, height, image: image ?? [], world: world ?? [], thumbUp, gestureReady }, now);
        snapshot.cameraActive = video.readyState >= 2 && video.srcObject != null;
        drawSrOverlay(ctx, width, height, snapshot, configRef.current);
        publish(snapshot, now);
        try {
          recorder.capture(video, snapshot, now);
        } catch {
          // Recording must never stop the measurement loop.
        }
      } catch {
        // A single bad frame should not kill the camera loop.
      }
    };

    void (async () => {
      try {
        if (synthetic) {
          drawBody(sourceCtx, syntheticGoalpost({ width: 1280, height: 720 }).image);
          stream = source.captureStream(30);
          video.srcObject = stream;
          const playing = video.play();
          if (!cancelled) {
            setStatus("Synthetic shoulder rotation check");
            raf = requestAnimationFrame(loop);
          }
          await playing;
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera");
        setStatus("Allow camera access…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setStatus("Loading pose model…");
        try {
          landmarker = await createTlPoseLandmarker();
          if (!cancelled) setStatus("");
          gestures = await createThumbRecognizer();
          gestureReady = gestures != null;
        } catch (error) {
          const message = error instanceof Error ? error.message.split("\n")[0] : "Pose model failed";
          if (!cancelled) setStatus(`Camera is on. Pose tracking failed: ${message}`);
        }
        if (!cancelled) raf = requestAnimationFrame(loop);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Camera failed");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      recorder.dispose();
      landmarker?.close?.();
      gestures?.close?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  return (
    <div className="stage-wrap">
      <div className="stage" ref={hostRef} />
      {status ? <p className="stage-status">{status}</p> : <p className="stage-status stage-status-idle">Camera on</p>}
      <p className={`rec-badge${recPhase === "keep" || recPhase === "post" ? " on" : ""}`}>
        <span className="rec-dot" /> REC
      </p>
      <p className={`rec-badge rec-unavailable${recPhase === "unavailable" ? " on" : ""}`}>Video recording unavailable in this browser.</p>
    </div>
  );
}

function scriptedEr(elapsed: number): number {
  if (elapsed < 3200) return 0;
  if (elapsed < 5200) return ((elapsed - 3200) / 2000) * 45;
  if (elapsed < 7200) return 45 - ((elapsed - 5200) / 2000) * 45;
  if (elapsed < 9200) return -((elapsed - 7200) / 2000) * 40;
  return -40;
}

function drawBody(ctx: CanvasRenderingContext2D | null, image: { x: number; y: number; visibility: number }[]): void {
  if (!ctx) return;
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#d7e6f5";
  for (const index of [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip, LM.nose]) {
    const point = image[index];
    if (!point || point.visibility < 0.2) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

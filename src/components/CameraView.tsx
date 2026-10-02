import { useEffect, useRef, useState } from "react";
import type { QFConfig } from "../qf/qfConfig";
import { QFSession } from "../qf/qfStateMachine";
import type { QFSnapshot } from "../qf/qfTypes";
import type { Side } from "../pose/types";
import { createQfPoseLandmarker, imageLandmarks, worldLandmarks, type PoseLandmarkerHandle } from "../pose/mediaPipePose";
import { TrialRecorder, type RecorderStatus, type SavedRecording } from "../recording/trialRecorder";
import { drawQfOverlay } from "./QFOverlay";

type Props = {
  side: Side;
  config: QFConfig;
  resetSignal: number;
  nextSignal: number;
  preRollMs: number;
  postRollMs: number;
  onSnapshot: (snapshot: QFSnapshot) => void;
  onRecording: (recording: SavedRecording) => void;
  onRecorderStatus: (status: RecorderStatus) => void;
};

export function CameraView({ side, config, resetSignal, nextSignal, preRollMs, postRollMs, onSnapshot, onRecording, onRecorderStatus }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  const onRecordingRef = useRef(onRecording);
  const onStatusRef = useRef(onRecorderStatus);
  const preRollRef = useRef(preRollMs);
  const postRollRef = useRef(postRollMs);
  const configRef = useRef(config);
  const sideRef = useRef(side);
  const sessionRef = useRef<QFSession | null>(null);
  onSnapshotRef.current = onSnapshot;
  onRecordingRef.current = onRecording;
  onStatusRef.current = onRecorderStatus;
  preRollRef.current = preRollMs;
  postRollRef.current = postRollMs;
  configRef.current = config;
  sideRef.current = side;
  const [status, setStatus] = useState("Starting camera…");
  const [recPhase, setRecPhase] = useState<RecorderStatus["phase"]>("off");

  useEffect(() => {
    sessionRef.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    sessionRef.current?.setSide(side);
  }, [side]);

  useEffect(() => {
    if (resetSignal === 0) return;
    sessionRef.current?.reset();
  }, [resetSignal]);

  useEffect(() => {
    if (nextSignal === 0) return;
    sessionRef.current?.nextTrial();
  }, [nextSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = new QFSession(configRef.current, sideRef.current);
    sessionRef.current = session;

    let cancelled = false;
    let raf = 0;
    let lastDetectTs = -1;
    let lastUi = 0;
    let lastState = "";
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarkerHandle | null = null;

    const video = document.createElement("video");
    video.className = "camera-feed";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    const canvas = document.createElement("canvas");
    host.replaceChildren(video, canvas);
    const ctx = canvas.getContext("2d");
    const recorder = new TrialRecorder(canvas, {
      onSaved: (recording) => onRecordingRef.current(recording),
      onStatus: (next) => {
        setRecPhase((phase) => (phase === next.phase ? phase : next.phase));
        onStatusRef.current(next);
      },
      preRollMs: () => preRollRef.current,
      postRollMs: () => postRollRef.current,
    });

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || !ctx || !landmarker) return;
      const now = Math.round(performance.now());
      if (now <= lastDetectTs) return;
      lastDetectTs = now;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width < 2 || height < 2) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      try {
        const detection = landmarker.detectForVideo(video, now);
        const image = imageLandmarks(detection.landmarks?.[0], width, height);
        const world = worldLandmarks(detection.worldLandmarks?.[0], detection.landmarks?.[0]);
        session.setConfig(configRef.current);
        const snapshot = session.push(
          { width, height, image: image ?? [], world: world ?? [] },
          now
        );
        drawQfOverlay(ctx, width, height, snapshot, configRef.current);
        if (snapshot.state !== lastState || now - lastUi > 80) {
          lastState = snapshot.state;
          lastUi = now;
          onSnapshotRef.current(snapshot);
        }
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
          landmarker = await createQfPoseLandmarker();
          if (!cancelled) setStatus("");
        } catch (error) {
          const message = error instanceof Error ? error.message.split("\n")[0] : "Pose model failed";
          if (!cancelled) setStatus(`Camera is on. Pose tracking failed: ${message}`);
        }
        if (!cancelled) raf = requestAnimationFrame(loop);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Camera failed";
        setStatus(message);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      recorder.dispose();
      landmarker?.close?.();
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

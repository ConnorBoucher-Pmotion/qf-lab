import { useEffect, useRef, useState } from "react";
import { createTlPoseLandmarker, imageLandmarks, worldLandmarks, type PoseLandmarkerHandle } from "../pose/mediaPipePose";
import { createThumbRecognizer, isThumbUp, type GestureHandle } from "../pose/thumbsUp";
import type { ObliqueConfig } from "./config";
import { drawObliqueOverlay } from "./ObliqueOverlay";
import { ObliqueCaptureRecorder, type RecordingMeta } from "./obliqueRecorder";
import { ObliqueSession } from "./session";
import { attachTrialVideo, saveTrial } from "./trialStore";
import type { ObliqueSnapshot, RotationDirection } from "./types";

type Props = {
  direction: RotationDirection;
  config: ObliqueConfig;
  resetSignal: number;
  nextSignal: number;
  startSignal: number;
  voiceSignal: number;
  switchSignal: number;
  onSnapshot: (snapshot: ObliqueSnapshot) => void;
  onRecordingMeta?: (meta: RecordingMeta | null) => void;
};

export function ObliqueCameraView({
  direction,
  config,
  resetSignal,
  nextSignal,
  startSignal,
  voiceSignal,
  switchSignal,
  onSnapshot,
  onRecordingMeta,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  const onRecordingMetaRef = useRef(onRecordingMeta);
  const configRef = useRef(config);
  const directionRef = useRef(direction);
  const sessionRef = useRef<ObliqueSession | null>(null);
  onSnapshotRef.current = onSnapshot;
  onRecordingMetaRef.current = onRecordingMeta;
  configRef.current = config;
  directionRef.current = direction;
  const [status, setStatus] = useState("Starting camera…");

  useEffect(() => {
    sessionRef.current?.setConfig(config);
  }, [config]);
  useEffect(() => {
    sessionRef.current?.setDirection(direction);
  }, [direction]);
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
    if (switchSignal === 0) return;
    sessionRef.current?.completeDirection(performance.now());
  }, [switchSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = new ObliqueSession(directionRef.current, configRef.current);
    sessionRef.current = session;
    let cancelled = false;
    let raf = 0;
    let lastDetectTs = -1;
    let lastUi = 0;
    let lastState = "";
    let lastRawKey = "";
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarkerHandle | null = null;
    let gestures: GestureHandle | null = null;
    let recorder: ObliqueCaptureRecorder | null = null;
    let recording = false;
    let finishingVideo = false;

    const video = document.createElement("video");
    video.className = "camera-feed";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    host.replaceChildren(video, canvas);
    const ctx = canvas.getContext("2d");
    // Record the LIVE camera MediaStream — never the overlay canvas (clearRect-only → black).
    recorder = new ObliqueCaptureRecorder();

    session.setTrialCompleteHandler((trial) => {
      void saveTrial(trial);
    });

    const publish = (snapshot: ObliqueSnapshot, now: number) => {
      const rawKey = `${snapshot.rawRom?.toFixed(1)}|${snapshot.maxRawRom?.toFixed(1)}|${snapshot.captureProgress?.toFixed(2)}`;
      if (snapshot.state !== lastState || rawKey !== lastRawKey || now - lastUi > 50) {
        lastState = snapshot.state;
        lastRawKey = rawKey;
        lastUi = now;
        onSnapshotRef.current(snapshot);
      }
    };

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (!ctx || !landmarker || video.readyState < 2) return;
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
        const snapshot = session.push({ width, height, image: image ?? [], world: world ?? [], thumbUp }, now);
        drawObliqueOverlay(ctx, width, height, snapshot);

        if (snapshot.state === "MEASURING" && !recording && recorder?.supported && stream) {
          recording = true;
          const meta = recorder.start(stream, `pending-${now}`);
          onRecordingMetaRef.current?.(meta);
        }
        if (
          (snapshot.state === "TRIAL_COMPLETE" || snapshot.state === "SESSION_COMPLETE") &&
          recording &&
          !finishingVideo &&
          snapshot.result?.id
        ) {
          finishingVideo = true;
          const trialId = snapshot.result.id;
          void recorder?.stop(trialId).then(async (saved) => {
            recording = false;
            finishingVideo = false;
            if (!saved) {
              onRecordingMetaRef.current?.(recorder?.getLastMeta() ?? null);
              return;
            }
            onRecordingMetaRef.current?.(saved.meta);
            await attachTrialVideo(trialId, {
              blob: saved.blob,
              mimeType: saved.mimeType,
              durationMs: saved.durationMs,
              bytes: saved.blob.size,
              recordingMeta: saved.meta,
            });
          });
        }
        if (snapshot.state !== "MEASURING" && snapshot.state !== "TRIAL_COMPLETE" && snapshot.state !== "SESSION_COMPLETE") {
          recording = false;
        }

        publish(snapshot, now);
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
        landmarker = await createTlPoseLandmarker();
        gestures = await createThumbRecognizer();
        if (!cancelled) {
          setStatus("");
          raf = requestAnimationFrame(loop);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Camera failed");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      recorder?.dispose();
      landmarker?.close?.();
      gestures?.close?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  return (
    <div className="stage-wrap">
      <div className="stage" ref={hostRef} />
      {status ? (
        <p className="stage-status">{status}</p>
      ) : (
        <p className="stage-status stage-status-idle">Camera on · multi-estimator CV · camera-stream record</p>
      )}
    </div>
  );
}

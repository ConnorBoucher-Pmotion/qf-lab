import { useEffect, useRef, useState } from "react";
import type { Trial } from "../qf/qfTypes";
import { deleteRecording, downloadBlob, getRecording, recordingFilename, type StoredRecording } from "../recording/recordingStore";

type Props = {
  trial: Trial | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

export function TrialVideoDialog({ trial, onClose, onDeleted }: Props) {
  const [clip, setClip] = useState<StoredRecording | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const trialId = trial?.id ?? null;

  useEffect(() => {
    if (!trialId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setClip(null);
    setMissing(false);
    void getRecording(trialId).then((recording) => {
      if (cancelled) return;
      if (!recording) {
        setMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(recording.blob);
      setClip(recording);
      setUrl(objectUrl);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [trialId]);

  if (!trial) return null;
  const status = trial.accepted ? "Valid" : "Invalid";
  const reason = trial.accepted ? trial.instruction : trial.instruction || trial.failedConstraints.join(", ") || "Rejected";

  return (
    <div className="video-dialog" role="dialog" aria-modal="true" aria-label={`Trial ${trial.trialNumber} video`}>
      <div className="video-card">
        <div className="video-head">
          <h2>
            Trial {trial.trialNumber} · {trial.side} · {status}
          </h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="video-summary">
          {trial.accepted && trial.measuredRom != null ? `QF ROM ${trial.measuredRom.toFixed(1)}°` : "No accepted angle"}
          {trial.goniometer != null ? ` · Goniometer ${trial.goniometer.toFixed(1)}°` : ""}
          {trial.signedError != null ? ` · Difference ${trial.signedError > 0 ? "+" : ""}${trial.signedError.toFixed(1)}°` : ""}
          {clip ? ` · ${(clip.durationMs / 1000).toFixed(1)} s` : ""}
        </p>
        <p className="muted small">{reason}</p>
        {url ? (
          <video key={url} src={url} controls autoPlay playsInline />
        ) : (
          <p className="video-waiting">{missing ? "No video was stored for this trial." : "Loading video…"}</p>
        )}
        <div className="row wrap">
          <button
            type="button"
            onClick={() => {
              const video = document.querySelector(".video-card video");
              if (video instanceof HTMLVideoElement) {
                video.currentTime = 0;
                void video.play();
              }
            }}
            disabled={!url}
          >
            Restart
          </button>
          <button
            type="button"
            onClick={() => {
              const video = document.querySelector(".video-card video");
              if (video instanceof HTMLVideoElement) void video.requestFullscreen?.();
            }}
            disabled={!url}
          >
            Full screen
          </button>
          <button
            type="button"
            onClick={() => {
              if (!clip) return;
              downloadBlob(recordingFilename(trial, clip.mimeType), clip.blob);
            }}
            disabled={!clip}
          >
            Download
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm(`Delete the video for trial ${trial.trialNumber}? The angle stays.`)) return;
              void deleteRecording(trial.id).then(() => onDeleted(trial.id));
            }}
          >
            Delete video
          </button>
        </div>
        <p className="muted small">Saved on this computer only. Nothing is uploaded.</p>
      </div>
    </div>
  );
}

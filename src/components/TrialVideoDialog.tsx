import { useEffect, useRef, useState } from "react";
import type { TLTrial } from "../tl/tlTypes";
import { deleteRecording, downloadBlob, getRecording, recordingFilename, type StoredRecording } from "../recording/recordingStore";

type Props = {
  trial: TLTrial | null;
  preRollMs: number;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

export function TrialVideoDialog({ trial, preRollMs, onClose, onDeleted }: Props) {
  const [clip, setClip] = useState<StoredRecording | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!trial) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setClip(null);
    setMissing(false);
    void getRecording(trial.id).then((recording) => {
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
  }, [trial]);

  if (!trial) return null;
  const seek = (offsetMs: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, (preRollMs + offsetMs) / 1000);
    void video.play();
  };

  return (
    <div className="video-dialog" role="dialog" aria-modal="true" aria-label={`Trial ${trial.trialNumber} video`}>
      <div className="video-card">
        <div className="video-head">
          <h2>
            Trial {trial.trialNumber} · {trial.direction} rotation · {trial.accepted ? "Valid" : "Invalid"}
          </h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="video-summary">
          Valid {trial.measuredRom == null ? "—" : `${trial.measuredRom.toFixed(1)}°`} · Raw {trial.rawMaximum == null ? "—" : `${trial.rawMaximum.toFixed(1)}°`}
          {trial.goniometer != null ? ` · Goniometer ${trial.goniometer.toFixed(1)}°` : ""}
          {clip ? ` · ${(clip.durationMs / 1000).toFixed(1)} s` : ""}
        </p>
        <p className="muted small">{trial.instruction} The replay includes the camera and the measurement overlay.</p>
        {url ? <video ref={videoRef} key={url} src={url} controls autoPlay playsInline /> : <p className="video-waiting">{missing ? "No video was stored for this trial." : "Loading video…"}</p>}
        <h3>Event timeline</h3>
        <p className="muted small">Times are approximate. The file starts about {Math.round(preRollMs / 100) / 10}s before rotation.</p>
        <div className="event-list">
          {trial.events.map((event, index) => (
            <button key={`${event.label}-${index}`} type="button" onClick={() => seek(event.offsetMs)} disabled={!url}>
              {formatOffset(event.offsetMs)} {event.label}
            </button>
          ))}
          {trial.events.length === 0 ? <p className="muted">No events were stored.</p> : null}
        </div>
        <div className="row wrap">
          <button
            type="button"
            disabled={!url || !clip}
            onClick={() => clip && downloadBlob(recordingFilename({ side: trial.direction, trialNumber: trial.trialNumber, timestamp: trial.timestamp }, clip.mimeType), clip.blob)}
          >
            Download
          </button>
          <button
            type="button"
            onClick={() => {
              void deleteRecording(trial.id).then(() => onDeleted(trial.id));
            }}
          >
            Delete video
          </button>
        </div>
      </div>
    </div>
  );
}

function formatOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total - minutes * 60).toFixed(1).padStart(4, "0");
  return `${sign}${minutes}:${seconds}`;
}

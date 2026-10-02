import { useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "./components/CameraView";
import { DebugPanel } from "./components/DebugPanel";
import { PositioningGuide, instructionTone } from "./components/PositioningGuide";
import { QualityIndicator } from "./components/QualityIndicator";
import { RepeatabilityPanel } from "./components/RepeatabilityPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { TrialVideoDialog } from "./components/TrialVideoDialog";
import type { QFConfig } from "./qf/qfConfig";
import type { Side } from "./pose/types";
import type { QFResult, QFSnapshot, Trial, TrialRecording } from "./qf/qfTypes";
import type { RecorderStatus, SavedRecording } from "./recording/trialRecorder";
import { clearRecordings, deleteRecording, listRecordingIds, putRecording } from "./recording/recordingStore";
import { loadConfig, loadSeries, loadTrials, saveConfig, saveSeries, saveTrials, withGoniometer } from "./storage/trials";

export function App() {
  const [side, setSide] = useState<Side>("right");
  const [config, setConfigState] = useState<QFConfig>(() => loadConfig());
  const [series, setSeriesState] = useState<string>(() => loadSeries());
  const [resetSignal, setResetSignal] = useState(0);
  const [nextSignal, setNextSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<QFSnapshot | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [trials, setTrials] = useState<Trial[]>(() => loadTrials());
  const [videoIds, setVideoIds] = useState<ReadonlySet<string>>(new Set());
  const [recorder, setRecorder] = useState<RecorderStatus | null>(null);
  const [preRollMs, setPreRollMs] = useState(1500);
  const [postRollMs, setPostRollMs] = useState(1000);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const pendingRecording = useRef(new Map<string, TrialRecording>());

  const setConfig = (next: QFConfig) => {
    setConfigState(next);
    saveConfig(next);
  };
  const setSeries = (next: string) => {
    setSeriesState(next);
    saveSeries(next);
  };
  const commit = (update: (current: Trial[]) => Trial[]) =>
    setTrials((current) => {
      const next = update(current);
      if (next !== current) saveTrials(next);
      return next;
    });

  const toTrial = (result: QFResult, current: Trial[]): Trial => ({
    ...result,
    series,
    trialNumber: current.filter((t) => t.series === series && t.side === result.side).reduce((max, t) => Math.max(max, t.trialNumber), 0) + 1,
    goniometer: null,
    absoluteError: null,
    signedError: null,
    percentError: null,
    recording: pendingRecording.current.get(result.id) ?? null,
  });

  useEffect(() => {
    void listRecordingIds().then((ids) => setVideoIds(new Set(ids)));
  }, []);

  useEffect(() => {
    const result = snapshot?.result;
    if (!result || (snapshot?.state !== "RESULT" && snapshot?.state !== "INVALID")) return;
    commit((current) => (current.some((t) => t.id === result.id) ? current : [toTrial(result, current), ...current]));
  }, [snapshot?.result?.id, snapshot?.state]);

  const forgetVideos = (ids: string[]) => {
    ids.forEach((id) => {
      pendingRecording.current.delete(id);
      void deleteRecording(id);
    });
    setVideoIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const onRecording = (saved: SavedRecording) => {
    const meta: TrialRecording = { durationMs: saved.durationMs, mimeType: saved.mimeType, bytes: saved.blob.size };
    pendingRecording.current.set(saved.trialId, meta);
    void putRecording(saved.trialId, { blob: saved.blob, ...meta }).then(() => {
      setVideoIds((current) => new Set(current).add(saved.trialId));
      commit((current) => (current.some((trial) => trial.id === saved.trialId) ? current.map((trial) => (trial.id === saved.trialId ? { ...trial, recording: meta } : trial)) : current));
    });
  };

  const live = snapshot && (snapshot.state === "RESULT" || snapshot.state === "INVALID") ? snapshot.result : null;
  const latest = useMemo(() => (live ? trials.find((t) => t.id === live.id) ?? null : null), [trials, live]);
  const rejectionSaved = live != null && !live.accepted && trials.some((t) => t.id === live.id);
  const savingId = recorder && (recorder.phase === "post" || recorder.phase === "keep") ? recorder.trialId : null;
  const review = reviewId ? trials.find((trial) => trial.id === reviewId) ?? null : null;

  return (
    <div className="page">
      <section className="assessment">
        <header>
          <div className="brand">
            <h1>QF assessment</h1>
            <p className={`pill sev-${toneClass(snapshot)}`}>{snapshot ? snapshot.state.replace("_", " ") : "SEARCHING"}</p>
          </div>
          <div className="row nowrap">
            <div className="segmented">
              <button type="button" className={side === "left" ? "on" : ""} onClick={() => setSide("left")}>
                Left leg
              </button>
              <button type="button" className={side === "right" ? "on" : ""} onClick={() => setSide("right")}>
                Right leg
              </button>
            </div>
            <button type="button" onClick={() => setNextSignal((v) => v + 1)} disabled={!snapshot?.baseline}>
              Next trial
            </button>
            <button type="button" onClick={() => setResetSignal((v) => v + 1)}>
              Recalibrate
            </button>
          </div>
        </header>
        <div className="assessment-grid">
          <div className="camera-column">
            <CameraView
              side={side}
              config={config}
              resetSignal={resetSignal}
              nextSignal={nextSignal}
              preRollMs={preRollMs}
              postRollMs={postRollMs}
              onSnapshot={setSnapshot}
              onRecording={onRecording}
              onRecorderStatus={setRecorder}
            />
            <div className="instruction-bar">
              <p className={`instruction tone-${instructionTone(snapshot?.state)}`}>{snapshot?.instruction ?? "Sit facing the camera."}</p>
            </div>
          </div>
          <aside className="live-rail">
            <QualityIndicator snapshot={snapshot} />
            <PositioningGuide snapshot={snapshot} />
          </aside>
        </div>
      </section>
      <section className="below">
        <div className="below-grid">
          <ResultsPanel
            live={live}
            latest={latest}
            videoIds={videoIds}
            savingId={savingId}
            rejectionSaved={rejectionSaved}
            onNext={() => setNextSignal((v) => v + 1)}
            onReview={setReviewId}
            onGoniometer={(id, value) => commit((current) => current.map((t) => (t.id === id ? withGoniometer(t, value) : t)))}
            onSaveRejection={() => {
              if (!live || live.accepted) return;
              commit((current) => (current.some((t) => t.id === live.id) ? current : [toTrial(live, current), ...current]));
            }}
          />
          <RepeatabilityPanel
            trials={trials}
            side={side}
            series={series}
            videoIds={videoIds}
            savingId={savingId}
            onSeries={setSeries}
            onReview={setReviewId}
            onGoniometer={(id, value) => commit((current) => current.map((t) => (t.id === id ? withGoniometer(t, value) : t)))}
            onDelete={(id) => {
              forgetVideos([id]);
              commit((current) => current.filter((t) => t.id !== id));
            }}
            onClearSeries={() => {
              const ids = trials.filter((t) => t.series === series && t.side === side).map((t) => t.id);
              forgetVideos(ids);
              commit((current) => current.filter((t) => !(t.series === series && t.side === side)));
            }}
            onClearRecordings={() => {
              void clearRecordings().then(() => {
                pendingRecording.current.clear();
                setVideoIds(new Set());
                commit((current) => current.map((trial) => (trial.recording ? { ...trial, recording: null } : trial)));
              });
            }}
          />
        </div>
        <DebugPanel
          open={debugOpen}
          config={config}
          snapshot={snapshot}
          recorder={recorder}
          preRollMs={preRollMs}
          postRollMs={postRollMs}
          onPreRoll={setPreRollMs}
          onPostRoll={setPostRollMs}
          onToggle={() => setDebugOpen((open) => !open)}
          onChange={setConfig}
        />
      </section>
      <TrialVideoDialog
        trial={review}
        onClose={() => setReviewId(null)}
        onDeleted={(id) => {
          forgetVideos([id]);
          commit((current) => current.map((trial) => (trial.id === id ? { ...trial, recording: null } : trial)));
          setReviewId(null);
        }}
      />
    </div>
  );
}

function toneClass(snapshot: QFSnapshot | null): string {
  if (!snapshot || snapshot.state === "INVALID" || snapshot.state === "SEARCHING" || snapshot.hardFailed) return "red";
  if (snapshot.state === "POSITIONING" || snapshot.state === "CALIBRATING" || snapshot.state === "TRACKING_WARNING") return "yellow";
  return "green";
}

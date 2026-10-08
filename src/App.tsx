import { useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "./components/CameraView";
import { DebugPanel } from "./components/DebugPanel";
import { PositioningGuide, instructionTone } from "./components/PositioningGuide";
import { QualityIndicator } from "./components/QualityIndicator";
import { RepeatabilityPanel } from "./components/RepeatabilityPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { TrialVideoDialog } from "./components/TrialVideoDialog";
import type { RecorderStatus, SavedRecording } from "./recording/trialRecorder";
import { deleteRecording, listRecordingIds, putRecording } from "./recording/recordingStore";
import { loadConfig, loadSeries, loadTrials, saveConfig, saveSeries, saveTrials, withGoniometer } from "./storage/trials";
import type { TLConfig } from "./tl/tlConfig";
import type { RotationDirection, TLResult, TLSnapshot, TLTrial, TrialRecording } from "./tl/tlTypes";

export function App() {
  const [direction, setDirection] = useState<RotationDirection>("right");
  const [config, setConfigState] = useState<TLConfig>(() => loadConfig());
  const [series, setSeriesState] = useState(() => loadSeries());
  const [resetSignal, setResetSignal] = useState(0);
  const [nextSignal, setNextSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<TLSnapshot | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [trials, setTrials] = useState<TLTrial[]>(() => loadTrials());
  const [videoIds, setVideoIds] = useState<ReadonlySet<string>>(new Set());
  const [recorder, setRecorder] = useState<RecorderStatus | null>(null);
  const [preRollMs, setPreRollMs] = useState(1500);
  const [postRollMs, setPostRollMs] = useState(1000);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const pendingRecording = useRef(new Map<string, TrialRecording>());

  const setConfig = (next: TLConfig) => {
    setConfigState(next);
    saveConfig(next);
  };
  const setSeries = (next: string) => {
    setSeriesState(next);
    saveSeries(next);
  };
  const commit = (update: (current: TLTrial[]) => TLTrial[]) =>
    setTrials((current) => {
      const next = update(current);
      if (next !== current) saveTrials(next);
      return next;
    });

  const toTrial = (result: TLResult, current: TLTrial[]): TLTrial => ({
    ...result,
    series: seriesRef.current,
    trialNumber: current.filter((trial) => trial.series === seriesRef.current && trial.direction === result.direction).reduce((max, trial) => Math.max(max, trial.trialNumber), 0) + 1,
    preRollMs: preRollRef.current,
    goniometer: null,
    absoluteError: null,
    signedError: null,
    recording: pendingRecording.current.get(result.id) ?? null,
  });

  useEffect(() => {
    void listRecordingIds().then((ids) => setVideoIds(new Set(ids)));
  }, []);

  useEffect(() => {
    const result = snapshot?.result;
    if (!result || (snapshot?.state !== "COMPLETE" && snapshot?.state !== "INVALID")) return;
    commit((current) => (current.some((trial) => trial.id === result.id) ? current : [toTrial(result, current), ...current]));
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
      commit((current) => current.map((trial) => (trial.id === saved.trialId ? { ...trial, recording: meta } : trial)));
    });
  };

  const live = snapshot && (snapshot.state === "COMPLETE" || snapshot.state === "INVALID") ? snapshot.result : null;
  const latest = useMemo(() => (live ? (trials.find((trial) => trial.id === live.id) ?? null) : null), [trials, live]);
  const savingId = recorder && (recorder.phase === "post" || recorder.phase === "keep") ? recorder.trialId : null;
  const review = reviewId ? (trials.find((trial) => trial.id === reviewId) ?? null) : null;
  const seriesRef = useRef(series);
  const preRollRef = useRef(preRollMs);
  seriesRef.current = series;
  preRollRef.current = preRollMs;

  return (
    <div className="page">
      <section className="assessment">
        <header>
          <div className="brand">
            <h1>TL Junction</h1>
            <p className={`pill sev-${tone(snapshot)}`}>{snapshot ? snapshot.state.replaceAll("_", " ") : "SEARCHING"}</p>
          </div>
          <div className="row nowrap">
            <div className="segmented">
              <button type="button" className={direction === "left" ? "on" : ""} onClick={() => setDirection("left")}>
                Left rotation
              </button>
              <button type="button" className={direction === "right" ? "on" : ""} onClick={() => setDirection("right")}>
                Right rotation
              </button>
            </div>
            <button type="button" onClick={() => setNextSignal((value) => value + 1)} disabled={!snapshot?.baselineReady}>
              Next trial
            </button>
            <button type="button" onClick={() => setResetSignal((value) => value + 1)}>
              Recalibrate
            </button>
          </div>
        </header>
        <div className="assessment-grid">
          <div className="camera-column">
            <CameraView
              direction={direction}
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
            onNext={() => setNextSignal((value) => value + 1)}
            onReview={setReviewId}
            onGoniometer={(id, value) => commit((current) => current.map((trial) => (trial.id === id ? withGoniometer(trial, value) : trial)))}
          />
          <RepeatabilityPanel
            trials={trials}
            direction={direction}
            series={series}
            videoIds={videoIds}
            savingId={savingId}
            onSeries={setSeries}
            onReview={setReviewId}
            onGoniometer={(id, value) => commit((current) => current.map((trial) => (trial.id === id ? withGoniometer(trial, value) : trial)))}
            onDelete={(id) => {
              forgetVideos([id]);
              commit((current) => current.filter((trial) => trial.id !== id));
            }}
            onClearSeries={() => {
              const ids = trials.filter((trial) => trial.series === series && trial.direction === direction).map((trial) => trial.id);
              forgetVideos(ids);
              commit((current) => current.filter((trial) => !(trial.series === series && trial.direction === direction)));
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
      <TrialVideoDialog trial={review} preRollMs={preRollMs} onClose={() => setReviewId(null)} onDeleted={forgetVideos.bind(null, review ? [review.id] : [])} />
    </div>
  );
}

function tone(snapshot: TLSnapshot | null): string {
  if (!snapshot || snapshot.state === "SEARCHING" || snapshot.state === "INVALID" || snapshot.state === "TRACKING_LOST") return "red";
  if (snapshot.state === "POSITIONING" || snapshot.state === "CALIBRATING" || snapshot.state === "PEAK" || snapshot.hardFailed) return "yellow";
  return "green";
}

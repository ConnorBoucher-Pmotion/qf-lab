import { useEffect, useRef, useState } from "react";
import { speak, useReadyVoice } from "../audio/cues";
import { OBLIQUE_CONFIG, cameraModeLabel, type ObliqueConfig } from "./config";
import { ObliqueCameraView } from "./ObliqueCameraView";
import { ObliqueDebugPanel } from "./ObliqueDebugPanel";
import type { ObliqueCameraMode, ObliqueSnapshot, RotationDirection } from "./types";

type Props = {
  onBack: () => void;
};

export function ObliqueApp({ onBack }: Props) {
  const [direction, setDirection] = useState<RotationDirection>("right");
  const [config, setConfig] = useState<ObliqueConfig>(OBLIQUE_CONFIG);
  const [resetSignal, setResetSignal] = useState(0);
  const [nextSignal, setNextSignal] = useState(0);
  const [startSignal, setStartSignal] = useState(0);
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [switchSignal, setSwitchSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<ObliqueSnapshot | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);
  const heardState = useRef<string | null>(null);

  const canListen = (snapshot?.state === "READY" || snapshot?.state === "READY_CONFIRMING") && snapshot.canStart;
  const mic = useReadyVoice(canListen, () => setVoiceSignal((value) => value + 1));

  useEffect(() => {
    const state = snapshot?.state ?? null;
    if (!state || state === heardState.current) return;
    const previous = heardState.current;
    heardState.current = state;
    if (state === "COUNTDOWN" && (previous === "READY" || previous === "READY_CONFIRMING")) playTone(660, 140);
    if (state === "ACTIVE" && (previous === "COUNTDOWN" || previous === "READY" || previous === "READY_CONFIRMING")) {
      playTone(880, 160);
      speak("Rotate as far as you comfortably can.");
    }
    if (state === "COMPLETE" && snapshot?.result?.accepted) speak("Assessment Completed");
  }, [snapshot?.state, snapshot?.result]);

  const setMode = (mode: ObliqueCameraMode) => setConfig((current) => ({ ...current, cameraMode: mode }));

  return (
    <div className="page">
      <section className="assessment">
        <header>
          <div className="brand">
            <h1>TL Junction – 45°</h1>
            <p className={`pill sev-${pillTone(snapshot)}`}>{snapshot ? snapshot.state.replaceAll("_", " ") : "SEARCHING"}</p>
          </div>
          <div className="row nowrap">
            <button type="button" onClick={onBack}>
              ← Labs
            </button>
            <div className="segmented">
              <button type="button" className={direction === "left" ? "on" : ""} onClick={() => setDirection("left")}>
                Left
              </button>
              <button type="button" className={direction === "right" ? "on" : ""} onClick={() => setDirection("right")}>
                Right
              </button>
            </div>
            <button type="button" onClick={() => setNextSignal((n) => n + 1)}>
              Next trial
            </button>
            <button type="button" onClick={() => setSwitchSignal((n) => n + 1)}>
              Switch side
            </button>
            <button type="button" onClick={() => setResetSignal((n) => n + 1)}>
              Reset
            </button>
          </div>
        </header>
        <div className="assessment-grid">
          <div className="camera-column">
            <div className="camera-stage">
              <ObliqueCameraView
                direction={direction}
                config={config}
                resetSignal={resetSignal}
                nextSignal={nextSignal}
                startSignal={startSignal}
                voiceSignal={voiceSignal}
                switchSignal={switchSignal}
                onSnapshot={setSnapshot}
              />
              {snapshot?.countdownLabel ? (
                <p className={`countdown${snapshot.countdownLabel.length > 3 ? " countdown-word" : ""}`}>{snapshot.countdownLabel}</p>
              ) : null}
            </div>
            <div className="instruction-bar">
              <p className="instruction">{snapshot?.instruction ?? "Sit upright. Camera ~45° to your body."}</p>
              <p className="mic-note">{snapshot?.setupMessage}</p>
              <p className="mic-note">
                Mic: {mic} · {cameraModeLabel(config.cameraMode)} ·{" "}
                {snapshot?.movementStarted
                  ? `${Math.round((snapshot.captureRemainingMs ?? 0) / 100) / 10}s left in capture window`
                  : snapshot?.baselineReady
                    ? "Baseline ready — say Ready or hold a thumbs up"
                    : `Calibrating neutral 0° · ${Math.round((snapshot?.calibrationProgress ?? 0) * 100)}%`}
              </p>
              {snapshot?.frame.rejectReason === "Pelvis unstable" ? <p className="blocked-by">Keep your hips facing forward.</p> : null}
              <div className="start-row">
                <button type="button" disabled={!snapshot?.canStart} onClick={() => setStartSignal((n) => n + 1)}>
                  I'm Ready
                </button>
                <label className="mic-note">
                  Camera mode{" "}
                  <select value={config.cameraMode} onChange={(e) => setMode(e.target.value as ObliqueCameraMode)}>
                    <option value="oblique-45">45° Oblique</option>
                    <option value="oblique-30">30° Oblique (prep)</option>
                    <option value="front">Front label (same world math)</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <aside className="live-rail">
            <section className="gate-box">
              <h2>Live ROM</h2>
              <dl className="readout">
                <div>
                  <dt>Raw</dt>
                  <dd>{deg(snapshot?.rawRom)}</dd>
                </div>
                <div>
                  <dt>Filtered</dt>
                  <dd>{deg(snapshot?.filteredRom)}</dd>
                </div>
                <div>
                  <dt>Max Raw</dt>
                  <dd>{deg(snapshot?.maxRawRom)}</dd>
                </div>
                <div>
                  <dt>Max Valid</dt>
                  <dd>{deg(snapshot?.maxValidRom)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{snapshot ? `${snapshot.measurementConfidence}%` : "—"}</dd>
                </div>
                <div>
                  <dt>Frame</dt>
                  <dd>{snapshot?.frame.frameValid.toUpperCase() ?? "—"}</dd>
                </div>
              </dl>
            </section>
            <section className="gate-box">
              <h2>Session</h2>
              <dl className="readout">
                <div>
                  <dt>Left</dt>
                  <dd>{deg(snapshot?.leftResult)}</dd>
                </div>
                <div>
                  <dt>Right</dt>
                  <dd>{deg(snapshot?.rightResult)}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd>{deg(snapshot?.asymmetryDeg)}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </section>
      <section className="below">
        <ObliqueDebugPanel open={debugOpen} onToggle={() => setDebugOpen((v) => !v)} snapshot={snapshot} />
      </section>
    </div>
  );
}

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}°`;
}

function pillTone(snapshot: ObliqueSnapshot | null): string {
  if (!snapshot) return "na";
  if (snapshot.state === "COMPLETE") return "pass";
  if (snapshot.state === "ACTIVE") return "warn";
  if (snapshot.frame.frameValid === "reject") return "fail";
  return "pass";
}

function playTone(freq: number, ms: number): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, ms);
  } catch {
    // optional
  }
}

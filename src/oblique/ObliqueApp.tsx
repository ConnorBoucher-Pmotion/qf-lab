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
  const readyPrompted = useRef(false);

  const canListen = (snapshot?.state === "WAITING_FOR_READY" || snapshot?.state === "READY_CONFIRMING") && snapshot.canStart;
  const mic = useReadyVoice(canListen, () => setVoiceSignal((value) => value + 1));

  useEffect(() => {
    const state = snapshot?.state ?? null;
    if (!state || state === heardState.current) return;
    const previous = heardState.current;
    heardState.current = state;

    if (state === "WAITING_FOR_READY" && !readyPrompted.current) {
      readyPrompted.current = true;
      speak("Say ready when in position.");
    }
    if (state === "ALIGNMENT" || state === "CALIBRATING" || state === "SEARCHING") {
      readyPrompted.current = false;
    }
    if (state === "COUNTDOWN" && (previous === "WAITING_FOR_READY" || previous === "READY_CONFIRMING")) {
      playTone(660, 140);
    }
    if (state === "MEASURING" && (previous === "COUNTDOWN" || previous === "WAITING_FOR_READY" || previous === "READY_CONFIRMING")) {
      playTone(880, 160);
      speak("Rotate as far as you comfortably can.");
    }
    if (state === "TRIAL_COMPLETE") {
      speak("Trial complete.");
    }
    if (state === "SESSION_COMPLETE") {
      speak("Assessment Completed.");
    }
  }, [snapshot?.state]);

  useEffect(() => {
    // Keep React direction toggle in sync when session auto-advances.
    if (snapshot?.direction && snapshot.direction !== direction && snapshot.state !== "MEASURING" && snapshot.state !== "COUNTDOWN") {
      setDirection(snapshot.direction);
    }
  }, [snapshot?.direction, snapshot?.state, direction]);

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
            <button
              type="button"
              disabled={snapshot?.state !== "TRIAL_COMPLETE"}
              onClick={() => setSwitchSignal((n) => n + 1)}
            >
              Next direction
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
              {snapshot?.state === "MEASURING" && snapshot.captureProgress != null ? (
                <div className="measure-progress" aria-label="Measurement progress">
                  <div className="measure-progress-fill" style={{ width: `${Math.round(snapshot.captureProgress * 100)}%` }} />
                  <span className="measure-progress-label">
                    {(snapshot.captureRemainingMs ?? 0) / 1000 > 0
                      ? `${((snapshot.captureRemainingMs ?? 0) / 1000).toFixed(1)}s`
                      : "0.0s"}
                  </span>
                </div>
              ) : null}
              <LiveDebugHud snapshot={snapshot} />
            </div>
            <div className="instruction-bar">
              <p className={`instruction${snapshot?.state === "WAITING_FOR_READY" ? " instruction-ready" : ""}`}>
                {snapshot?.instruction ?? "Sit upright. Camera ~45° to your body."}
              </p>
              <p className="mic-note">{snapshot?.setupMessage}</p>
              <p className="mic-note">
                Mic: {mic} · {cameraModeLabel(config.cameraMode)} ·{" "}
                {snapshot?.state === "MEASURING"
                  ? `Measuring · ${((snapshot.captureRemainingMs ?? 0) / 1000).toFixed(1)}s left`
                  : snapshot?.baselineReady
                    ? "Aligned — say Ready or hold a thumbs up"
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
            <section className="gate-box result-card">
              <h2>RAW MAX ROM</h2>
              <p className="result-hero">{deg(snapshot?.maxRawRom ?? snapshot?.result?.rawMaximum)}</p>
              <p className="mic-note">
                {snapshot?.direction === "left" ? "LEFT" : "RIGHT"} ROTATION
                {snapshot?.state === "TRIAL_COMPLETE" || snapshot?.state === "SESSION_COMPLETE" ? " · TRIAL COMPLETE" : ""}
              </p>
              <dl className="readout">
                <div>
                  <dt>Current Raw</dt>
                  <dd>{deg(snapshot?.rawRom)}</dd>
                </div>
                <div>
                  <dt>Raw Max</dt>
                  <dd>{deg(snapshot?.maxRawRom)}</dd>
                </div>
                <div>
                  <dt>Filtered</dt>
                  <dd>{deg(snapshot?.filteredRom)}</dd>
                </div>
              </dl>
            </section>
            <section className="gate-box">
              <h2>Live angles</h2>
              <dl className="readout">
                <div>
                  <dt>Shoulder raw</dt>
                  <dd>{deg(snapshot?.shoulderRawDeg)}</dd>
                </div>
                <div>
                  <dt>Pelvis</dt>
                  <dd>{deg(snapshot?.pelvisRawDeg)}</dd>
                </div>
                <div>
                  <dt>Thoracic</dt>
                  <dd>{deg(snapshot?.thoracicRawDeg)}</dd>
                </div>
              </dl>
            </section>
            <section className="gate-box">
              <h2>{snapshot?.bothDirectionsComplete ? "TL JUNCTION COMPLETE" : "Session"}</h2>
              <dl className="readout">
                <div>
                  <dt>Right Raw Max</dt>
                  <dd>{deg(snapshot?.rightResult)}</dd>
                </div>
                <div>
                  <dt>Left Raw Max</dt>
                  <dd>{deg(snapshot?.leftResult)}</dd>
                </div>
                <div>
                  <dt>Asymmetry</dt>
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

function LiveDebugHud({ snapshot }: { snapshot: ObliqueSnapshot | null }) {
  if (!snapshot) return null;
  const f = snapshot.frame;
  const ls = f.leftShoulder;
  const rs = f.rightShoulder;
  return (
    <div className="oblique-hud">
      <div>STATE: {snapshot.state}</div>
      <div>
        LS: {ls ? `${ls.x.toFixed(2)} / ${ls.y.toFixed(2)} / ${ls.z.toFixed(2)} / ${f.leftShoulderConfidence.toFixed(2)}` : "—"}
      </div>
      <div>
        RS: {rs ? `${rs.x.toFixed(2)} / ${rs.y.toFixed(2)} / ${rs.z.toFixed(2)} / ${f.rightShoulderConfidence.toFixed(2)}` : "—"}
      </div>
      <div>CURRENT SHOULDER ANGLE: {deg(f.liveShoulderYawDeg)}</div>
      <div>NEUTRAL SHOULDER ANGLE: {deg(f.neutralShoulderYawDeg)}</div>
      <div>RAW ROTATION FROM BASELINE: {deg(f.shoulderRotationDeg)}</div>
      <div>PELVIS ROTATION: {deg(f.pelvisRotationDeg)}</div>
      <div>THORACIC ROTATION: {deg(f.thoracicRotationDeg)}</div>
      <div>CURRENT RAW TL ROM: {deg(snapshot.rawRom)}</div>
      <div>RAW MAX ROM: {deg(snapshot.maxRawRom)}</div>
      <div>
        TIME REMAINING:{" "}
        {snapshot.state === "MEASURING" && snapshot.captureRemainingMs != null
          ? `${(snapshot.captureRemainingMs / 1000).toFixed(1)}s`
          : "—"}
      </div>
      <div>BASELINE SEALED: {f.baselineSealed ? "YES" : "NO"}</div>
    </div>
  );
}

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}°`;
}

function pillTone(snapshot: ObliqueSnapshot | null): string {
  if (!snapshot) return "na";
  if (snapshot.state === "TRIAL_COMPLETE" || snapshot.state === "SESSION_COMPLETE") return "pass";
  if (snapshot.state === "MEASURING") return "warn";
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

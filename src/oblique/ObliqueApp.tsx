import { useEffect, useRef, useState } from "react";
import { speak, useReadyVoice } from "../audio/cues";
import { OBLIQUE_CONFIG, cameraModeLabel, type ObliqueConfig } from "./config";
import { ObliqueCameraView } from "./ObliqueCameraView";
import { ObliqueDebugPanel } from "./ObliqueDebugPanel";
import type { RecordingMeta } from "./obliqueRecorder";
import type { ObliqueCameraMode, ObliqueSnapshot, RotationDirection } from "./types";

type Props = {
  onBack: () => void;
  onOpenReview?: () => void;
};

export function ObliqueApp({ onBack, onOpenReview }: Props) {
  const [direction, setDirection] = useState<RotationDirection>("right");
  const [config, setConfig] = useState<ObliqueConfig>(OBLIQUE_CONFIG);
  const [resetSignal, setResetSignal] = useState(0);
  const [nextSignal, setNextSignal] = useState(0);
  const [startSignal, setStartSignal] = useState(0);
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [switchSignal, setSwitchSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<ObliqueSnapshot | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);
  const [recordingMeta, setRecordingMeta] = useState<RecordingMeta | null>(null);
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
            <h1>TL Junction – Oblique</h1>
            <p className={`pill sev-${pillTone(snapshot)}`}>{snapshot ? snapshot.state.replaceAll("_", " ") : "SEARCHING"}</p>
          </div>
          <div className="row nowrap">
            <button type="button" onClick={onBack}>
              ← Labs
            </button>
            {onOpenReview ? (
              <button type="button" onClick={onOpenReview}>
                Trial review
              </button>
            ) : null}
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
            <button type="button" disabled={snapshot?.state !== "TRIAL_COMPLETE"} onClick={() => setSwitchSignal((n) => n + 1)}>
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
                onRecordingMeta={setRecordingMeta}
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
              <LiveDebugHud snapshot={snapshot} recordingMeta={recordingMeta} />
            </div>
            <div className="instruction-bar">
              <p className={`instruction${snapshot?.state === "WAITING_FOR_READY" ? " instruction-ready" : ""}`}>
                {snapshot?.instruction ?? "Sit upright. Camera ~35–40° to your body."}
              </p>
              <p className="mic-note">{snapshot?.setupMessage}</p>
              <p className="mic-note">
                Mic: {mic} · {cameraModeLabel(config.cameraMode)} ·{" "}
                {snapshot?.state === "MEASURING"
                  ? `Measuring · ${((snapshot.captureRemainingMs ?? 0) / 1000).toFixed(1)}s left`
                  : snapshot?.frame.readyBaselineCaptured
                    ? "Baseline = 0° · hybrid frozen-hip / visible-shoulder"
                    : snapshot?.baselineReady
                      ? "Aligned — say Ready or hold a thumbs up (sets 0°)"
                      : `Calibrating alignment · ${Math.round((snapshot?.calibrationProgress ?? 0) * 100)}%`}
              </p>
              {snapshot?.frame.hipDeviationWarning ? <p className="blocked-by">Keep your hips facing forward.</p> : null}
              <div className="start-row">
                <button type="button" disabled={!snapshot?.canStart} onClick={() => setStartSignal((n) => n + 1)}>
                  I'm Ready
                </button>
                <label className="mic-note">
                  Camera mode{" "}
                  <select value={config.cameraMode} onChange={(e) => setMode(e.target.value as ObliqueCameraMode)}>
                    <option value="oblique-35">35° Oblique (recommended)</option>
                    <option value="oblique-40">40° Oblique</option>
                    <option value="oblique-45">45° Oblique</option>
                    <option value="oblique-30">30° Oblique</option>
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
                {snapshot?.direction === "left" ? "LEFT" : "RIGHT"} ROTATION · hybrid frozen-hip
                {snapshot?.state === "TRIAL_COMPLETE" || snapshot?.state === "SESSION_COMPLETE" ? " · TRIAL COMPLETE" : ""}
              </p>
              <dl className="readout">
                <div>
                  <dt>Current Raw</dt>
                  <dd>{deg(snapshot?.rawRom)}</dd>
                </div>
                <div>
                  <dt>Raw Max</dt>
                  <dd>{deg(snapshot?.maxRawRom ?? snapshot?.result?.rawMaximum)}</dd>
                </div>
                <div>
                  <dt>Filtered</dt>
                  <dd>{deg(snapshot?.filteredRom)}</dd>
                </div>
                <div>
                  <dt>Filtered Max</dt>
                  <dd>{deg(snapshot?.maxFilteredRom ?? snapshot?.result?.filteredMaximum)}</dd>
                </div>
                <div>
                  <dt>Left Raw Max</dt>
                  <dd>{deg(snapshot?.leftResult)}</dd>
                </div>
                <div>
                  <dt>Right Raw Max</dt>
                  <dd>{deg(snapshot?.rightResult)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{snapshot?.measurementConfidence != null ? `${snapshot.measurementConfidence}%` : "—"}</dd>
                </div>
              </dl>
            </section>
            <section className="gate-box">
              <h2>Hybrid / frozen hip</h2>
              <dl className="readout">
                <div>
                  <dt>Mode</dt>
                  <dd>{snapshot?.frame.hybridMode ?? "—"}</dd>
                </div>
                <div>
                  <dt>Trusted</dt>
                  <dd>{String(snapshot?.frame.reliableShoulder ?? "—")}</dd>
                </div>
                <div>
                  <dt>Both-sh ROM</dt>
                  <dd>{deg(snapshot?.frame.bothShoulderRomDeg)}</dd>
                </div>
                <div>
                  <dt>Visible-sh ROM</dt>
                  <dd>{deg(snapshot?.frame.visibleShoulderRomDeg)}</dd>
                </div>
                <div>
                  <dt>Frozen hip ref</dt>
                  <dd>{deg(snapshot?.frame.frozenHipReferenceDeg)}</dd>
                </div>
                <div>
                  <dt>Live hip dev</dt>
                  <dd>{deg(snapshot?.frame.liveHipDeviationDeg)}</dd>
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
        <LiveEstimatorGraph snapshot={snapshot} />
      </section>
    </div>
  );
}

function LiveDebugHud({
  snapshot,
  recordingMeta,
}: {
  snapshot: ObliqueSnapshot | null;
  recordingMeta: RecordingMeta | null;
}) {
  if (!snapshot) return null;
  const f = snapshot.frame;
  const ils = f.imageLeftShoulder;
  const irs = f.imageRightShoulder;
  const ilh = f.imageLeftHip;
  const irh = f.imageRightHip;
  const wls = f.worldLeftShoulder ?? f.leftShoulder;
  const wrs = f.worldRightShoulder ?? f.rightShoulder;
  const wlh = f.worldLeftHip ?? f.leftHip;
  const wrh = f.worldRightHip ?? f.rightHip;
  const occ =
    f.occlusionActive || f.hybridMode === "VISIBLE_SHOULDER"
      ? f.reliableShoulder === "left"
        ? "Right"
        : f.reliableShoulder === "right"
          ? "Left"
          : "Far"
      : "None";
  return (
    <div className="oblique-hud">
      <div>RAW CV DEBUG</div>
      <div>TRIAL: {snapshot.direction.toUpperCase()} · {snapshot.state}</div>
      <div>CURRENT ROM: {deg(f.rawRom)} · PEAK: {deg(snapshot.maxRawRom)}</div>
      <div>BASELINE: {f.baselineLocked ? "LOCKED" : f.readyBaselineCaptured ? "captured" : "open"}</div>
      <div>A Existing: {deg(f.estimatorExistingDeg)}</div>
      <div>B 2D shoulder-line: {deg(f.estimator2dLineDeg)}</div>
      <div>C World yaw: {deg(f.estimatorWorldYawDeg)}</div>
      <div>D Image orbit: {deg(f.estimatorImageOrbitDeg)}</div>
      <div>Signed world (unclamped): {deg(f.worldSignedUnclampedDeg)}</div>
      <div>SELECTED: {deg(f.rawRom)} ← {f.estimatorSelectedSource ?? "—"}</div>
      <div>Trusted: {String(f.reliableShoulder).toUpperCase()} · Occ: {occ}</div>
      <div>L/R conf: {Math.round(f.leftShoulderConfidence * 100)}% / {Math.round(f.rightShoulderConfidence * 100)}%</div>
      <div>IMG LS: {ils ? `${ils.x.toFixed(0)},${ils.y.toFixed(0)}` : "—"}</div>
      <div>IMG RS: {irs ? `${irs.x.toFixed(0)},${irs.y.toFixed(0)}` : "—"}</div>
      <div>IMG LH: {ilh ? `${ilh.x.toFixed(0)},${ilh.y.toFixed(0)}` : "—"}</div>
      <div>IMG RH: {irh ? `${irh.x.toFixed(0)},${irh.y.toFixed(0)}` : "—"}</div>
      <div>WLD LS: {wls ? `${wls.x.toFixed(3)},${wls.y.toFixed(3)},${wls.z.toFixed(3)}` : "—"}</div>
      <div>WLD RS: {wrs ? `${wrs.x.toFixed(3)},${wrs.y.toFixed(3)},${wrs.z.toFixed(3)}` : "—"}</div>
      <div>WLD LH: {wlh ? `${wlh.x.toFixed(3)},${wlh.y.toFixed(3)},${wlh.z.toFixed(3)}` : "—"}</div>
      <div>WLD RH: {wrh ? `${wrh.x.toFixed(3)},${wrh.y.toFixed(3)},${wrh.z.toFixed(3)}` : "—"}</div>
      {recordingMeta ? (
        <>
          <div>REC src: {recordingMeta.source}</div>
          <div>
            REC blob: {recordingMeta.blobBytes}B · {recordingMeta.mimeType}
          </div>
          <div>
            REC tracks: {recordingMeta.trackCount} live={recordingMeta.trackReadyState}{" "}
            {recordingMeta.width}x{recordingMeta.height}@{recordingMeta.frameRate ?? "?"}
          </div>
          <div>REC fail: {recordingMeta.failed ? recordingMeta.failReason ?? "yes" : "no"}</div>
        </>
      ) : null}
    </div>
  );
}

function LiveEstimatorGraph({ snapshot }: { snapshot: ObliqueSnapshot | null }) {
  type Row = { t: number; a: number; b: number; c: number; d: number; sel: number; conf: number };
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (snapshot?.state === "MEASURING" && snapshot.frame) {
      const f = snapshot.frame;
      const t = performance.now();
      setRows((prev) => {
        const last = prev[prev.length - 1];
        if (last && t - last.t < 40) return prev;
        const next = [
          ...prev,
          {
            t,
            a: f.estimatorExistingDeg ?? 0,
            b: Math.abs(f.estimator2dLineDeg ?? 0),
            c: f.estimatorWorldYawDeg ?? 0,
            d: f.estimatorImageOrbitDeg ?? 0,
            sel: f.rawRom ?? 0,
            conf: (f.leftShoulderConfidence + f.rightShoulderConfidence) / 2,
          },
        ];
        return next.length > 180 ? next.slice(-180) : next;
      });
    } else if (snapshot?.state === "WAITING_FOR_READY" || snapshot?.state === "COUNTDOWN") {
      setRows([]);
    }
  }, [snapshot]);
  if (rows.length < 2) return null;
  const w = 640;
  const h = 160;
  const pad = 24;
  const maxY = Math.max(10, ...rows.flatMap((r) => [r.a, r.b, r.c, r.d, r.sel]));
  const path = (pick: (r: (typeof rows)[0]) => number, color: string) => {
    const d = rows
      .map((r, i) => {
        const x = pad + (i / (rows.length - 1)) * (w - pad * 2);
        const y = h - pad - (pick(r) / maxY) * (h - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return <path d={d} fill="none" stroke={color} strokeWidth="1.6" />;
  };
  return (
    <section className="gate-box" style={{ marginTop: 12 }}>
      <h2>Live estimator graph</h2>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#0f172a", borderRadius: 8 }}>
        {path((r) => r.a, "#94a3b8")}
        {path((r) => r.b, "#f472b6")}
        {path((r) => r.c, "#60a5fa")}
        {path((r) => r.d, "#34d399")}
        {path((r) => r.sel, "#fbbf24")}
        {path((r) => r.conf * maxY, "#a78bfa")}
        <text x={pad} y={14} fill="#94a3b8" fontSize="10">
          A hybrid
        </text>
        <text x={pad + 70} y={14} fill="#f472b6" fontSize="10">
          B 2d-line
        </text>
        <text x={pad + 140} y={14} fill="#60a5fa" fontSize="10">
          C world
        </text>
        <text x={pad + 200} y={14} fill="#34d399" fontSize="10">
          D orbit
        </text>
        <text x={pad + 260} y={14} fill="#fbbf24" fontSize="10">
          selected
        </text>
        <text x={pad + 330} y={14} fill="#a78bfa" fontSize="10">
          conf×
        </text>
      </svg>
    </section>
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

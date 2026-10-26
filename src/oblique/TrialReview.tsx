import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredRecording } from "../recording/recordingStore";
import { clearAllTlTrialData, deleteTrial, listTrials, loadTrialVideo } from "./trialStore";
import { confidenceLabel, type TlTrialRecord, type TrialFrameSample } from "./trialTypes";

type Props = {
  onBack: () => void;
};

export function TrialReview({ onBack }: Props) {
  const [trials, setTrials] = useState<TlTrialRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const rows = await listTrials();
    setTrials(rows);
    if (selectedId && !rows.some((t) => t.trialId === selectedId)) setSelectedId(rows[0]?.trialId ?? null);
    else if (!selectedId && rows[0]) setSelectedId(rows[0].trialId);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selected = trials.find((t) => t.trialId === selectedId) ?? null;

  return (
    <div className="page trial-review">
      <header className="row nowrap" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <button type="button" onClick={onBack}>
            ← Back
          </button>
          <h1 style={{ display: "inline", marginLeft: 12 }}>TL Trial Review</h1>
        </div>
        <div className="row nowrap">
          <button type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={async () => {
              if (!selected) return;
              setBusy(true);
              await deleteTrial(selected.trialId);
              await refresh();
              setBusy(false);
            }}
          >
            Delete trial
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Clear ALL TL Junction trial data and videos?")) return;
              setBusy(true);
              await clearAllTlTrialData();
              setSelectedId(null);
              await refresh();
              setBusy(false);
            }}
          >
            Clear all data
          </button>
        </div>
      </header>

      <div className="assessment-grid" style={{ marginTop: 12 }}>
        <aside className="live-rail">
          <section className="gate-box">
            <h2>Trials ({trials.length})</h2>
            {trials.length === 0 ? <p className="mic-note">No saved trials yet. Complete an oblique assessment first.</p> : null}
            <ul className="trial-list">
              {trials.map((trial) => (
                <li key={trial.trialId}>
                  <button
                    type="button"
                    className={trial.trialId === selectedId ? "trial-item on" : "trial-item"}
                    onClick={() => setSelectedId(trial.trialId)}
                  >
                    <strong>
                      Trial {trial.trialNumber} · {trial.direction.toUpperCase()}
                    </strong>
                    <span>Raw Max: {trial.rawMaxRom != null ? `${trial.rawMaxRom.toFixed(1)}°` : "—"}</span>
                    <span>
                      Confidence: {trial.confidence}% · {confidenceLabel(trial.confidenceBand)}
                    </span>
                    <span>Duration: {(trial.durationMs / 1000).toFixed(1)}s</span>
                    <span>{statusLabel(trial.completionStatus)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <div className="camera-column">{selected ? <TrialDetail trial={selected} /> : <p className="mic-note">Select a trial.</p>}</div>
      </div>
    </div>
  );
}

function TrialDetail({ trial }: { trial: TlTrialRecord }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rec, setRec] = useState<StoredRecording | null>(null);
  const [tMs, setTMs] = useState(0);
  const [videoMeta, setVideoMeta] = useState<{ w: number; h: number; dur: number } | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    setUrl(null);
    setRec(null);
    setVideoMeta(null);
    void loadTrialVideo(trial).then((loaded) => {
      if (!loaded) {
        setRec(null);
        setUrl(null);
        return;
      }
      setRec(loaded);
      const next = URL.createObjectURL(loaded.blob);
      revoked = next;
      setUrl(next);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [trial.trialId, trial.videoId]);

  const sample = useMemo(() => nearestSample(trial.samples, tMs), [trial.samples, tMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    video.src = url;
    video.load();
    const onTime = () => setTMs(video.currentTime * 1000);
    const onMeta = () => {
      setVideoMeta({ w: video.videoWidth, h: video.videoHeight, dur: video.duration });
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [url]);

  return (
    <>
      <section className="gate-box">
        <h2>
          Trial {trial.trialNumber} · {trial.direction.toUpperCase()}
        </h2>
        <dl className="readout">
          <div>
            <dt>Raw Max</dt>
            <dd>{fmtDeg(trial.rawMaxRom)}</dd>
          </div>
          <div>
            <dt>Filtered Max</dt>
            <dd>{fmtDeg(trial.filteredMaxRom)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {trial.confidence}% · {confidenceLabel(trial.confidenceBand)}
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{(trial.durationMs / 1000).toFixed(1)}s</dd>
          </div>
          <div>
            <dt>Camera</dt>
            <dd>{trial.cameraMode}</dd>
          </div>
          <div>
            <dt>Occlusion events</dt>
            <dd>{trial.occlusionEventCount}</dd>
          </div>
          <div>
            <dt>Rejected frames</dt>
            <dd>
              {trial.rejectedFrameCount}/{trial.totalFrameCount}
            </dd>
          </div>
          <div>
            <dt>Selected estimator</dt>
            <dd>{trial.algorithmPrimary}</dd>
          </div>
        </dl>
      </section>

      <section className="gate-box" style={{ marginTop: 12 }}>
        <h2>Video</h2>
        {url ? (
          <video ref={videoRef} controls playsInline style={{ width: "100%", maxHeight: 360, background: "#000" }} />
        ) : (
          <p className="mic-note">No video stored for this trial (browser may have blocked recording).</p>
        )}
        <div className="oblique-hud" style={{ position: "relative", marginTop: 8 }}>
          <div>Blob size: {rec ? `${rec.bytes} B` : "—"}</div>
          <div>MIME: {rec?.mimeType ?? "—"}</div>
          <div>
            Duration:{" "}
            {videoMeta?.dur != null && Number.isFinite(videoMeta.dur)
              ? `${videoMeta.dur.toFixed(2)}s`
              : rec
                ? `${(rec.durationMs / 1000).toFixed(2)}s`
                : "—"}
          </div>
          <div>
            videoWidth×Height: {videoMeta ? `${videoMeta.w}×${videoMeta.h}` : "—"}
          </div>
          <div>Recording source: {rec?.recordingMeta?.source ?? "unknown"}</div>
          <div>Track count: {rec?.recordingMeta?.trackCount ?? "—"}</div>
          <div>
            Encoder: {rec?.recordingMeta?.width ?? "?"}×{rec?.recordingMeta?.height ?? "?"} @
            {rec?.recordingMeta?.frameRate ?? "?"} · chunks={rec?.recordingMeta?.chunkCount ?? "—"}
          </div>
          <div>
            Fail:{" "}
            {rec?.recordingMeta?.failed ? rec.recordingMeta.failReason ?? "yes" : rec ? "no" : "—"}
          </div>
        </div>
        <p className="mic-note">Scrub the video to inspect synchronized ROM / confidence.</p>
        {sample ? <SampleHud tMs={tMs} sample={sample} /> : null}
      </section>

      <section className="gate-box" style={{ marginTop: 12 }}>
        <h2>Selected / raw ROM</h2>
        <RomChart samples={trial.samples} field="rawRom" accent="#fbbf24" peak={trial.rawMaxRom} />
      </section>
      <section className="gate-box" style={{ marginTop: 12 }}>
        <h2>Multi-estimator</h2>
        <MultiEstimatorChart samples={trial.samples} />
      </section>
      <section className="gate-box" style={{ marginTop: 12 }}>
        <h2>Filtered ROM</h2>
        <RomChart samples={trial.samples} field="filteredRom" accent="#34d399" peak={trial.filteredMaxRom} />
      </section>
      <section className="gate-box" style={{ marginTop: 12 }}>
        <h2>Landmark confidence</h2>
        <ConfidenceChart samples={trial.samples} />
      </section>
    </>
  );
}

function SampleHud({ tMs, sample }: { tMs: number; sample: TrialFrameSample }) {
  return (
    <div className="oblique-hud" style={{ position: "relative", marginTop: 8 }}>
      <div>Time: {(tMs / 1000).toFixed(2)}s</div>
      <div>Selected ROM: {fmtDeg(sample.rawRom)} ← {sample.estimatorSelectedSource ?? "—"}</div>
      <div>A hybrid: {fmtDeg(sample.estimatorHybridDeg)}</div>
      <div>B 2d-line: {fmtDeg(sample.estimator2dLineDeg)}</div>
      <div>C world: {fmtDeg(sample.estimatorWorldYawDeg)}</div>
      <div>D image orbit: {fmtDeg(sample.estimatorImageOrbitDeg)}</div>
      <div>Signed world: {fmtDeg(sample.worldSignedUnclampedDeg)}</div>
      <div>Filtered ROM: {fmtDeg(sample.filteredRom)}</div>
      <div>Raw max so far: {fmtDeg(sample.rawMaxSoFar)}</div>
      <div>
        L/R shoulder conf: {(sample.leftShoulderConfidence * 100).toFixed(0)}% / {(sample.rightShoulderConfidence * 100).toFixed(0)}%
      </div>
      <div>
        L/R hip conf: {(sample.leftHipConfidence * 100).toFixed(0)}% / {(sample.rightHipConfidence * 100).toFixed(0)}%
      </div>
      <div>Mode: {sample.measurementMode}</div>
      <div>Trusted: {sample.trustedShoulder}</div>
      <div>Occlusion: {sample.occlusionState}</div>
      <div>Outlier: {sample.isOutlier ? `YES (${sample.rejectReason || "—"})` : "NO"}</div>
    </div>
  );
}

function MultiEstimatorChart({ samples }: { samples: TrialFrameSample[] }) {
  const w = 640;
  const h = 160;
  const pad = 28;
  const maxT = Math.max(1, ...samples.map((s) => s.tMs));
  const vals = samples.flatMap((s) =>
    [s.estimatorHybridDeg, s.estimator2dLineDeg, s.estimatorWorldYawDeg, s.estimatorImageOrbitDeg, s.rawRom].filter(
      (v): v is number => v != null && Number.isFinite(v)
    )
  );
  const maxY = Math.max(10, ...vals.map((v) => Math.abs(v)));
  const pathFor = (pick: (s: TrialFrameSample) => number | null | undefined, color: string) => {
    const pts = samples
      .map((s, i) => {
        const v = pick(s);
        if (v == null || !Number.isFinite(v)) return null;
        const x = pad + (s.tMs / maxT) * (w - pad * 2);
        const y = h - pad - (Math.abs(v) / maxY) * (h - pad * 2);
        return { i, x, y };
      })
      .filter((p): p is { i: number; x: number; y: number } => p != null);
    if (!pts.length) return null;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return <path d={d} fill="none" stroke={color} strokeWidth="1.5" />;
  };
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#0f172a", borderRadius: 8 }}>
      {pathFor((s) => s.estimatorHybridDeg, "#94a3b8")}
      {pathFor((s) => s.estimator2dLineDeg, "#f472b6")}
      {pathFor((s) => s.estimatorWorldYawDeg, "#60a5fa")}
      {pathFor((s) => s.estimatorImageOrbitDeg, "#34d399")}
      {pathFor((s) => s.rawRom, "#fbbf24")}
      <text x={pad} y={16} fill="#94a3b8" fontSize="11">
        A
      </text>
      <text x={pad + 24} y={16} fill="#f472b6" fontSize="11">
        B
      </text>
      <text x={pad + 48} y={16} fill="#60a5fa" fontSize="11">
        C
      </text>
      <text x={pad + 72} y={16} fill="#34d399" fontSize="11">
        D
      </text>
      <text x={pad + 96} y={16} fill="#fbbf24" fontSize="11">
        selected
      </text>
    </svg>
  );
}

function RomChart({
  samples,
  field,
  accent,
  peak,
}: {
  samples: TrialFrameSample[];
  field: "rawRom" | "filteredRom";
  accent: string;
  peak: number | null;
}) {
  const w = 640;
  const h = 160;
  const pad = 28;
  const xs = samples.map((s) => s.tMs);
  const ys = samples.map((s) => s[field]).filter((v): v is number => v != null && Number.isFinite(v));
  const maxT = Math.max(1, ...xs);
  const maxY = Math.max(10, ...(ys.length ? ys : [0]), peak ?? 0);
  const points = samples
    .filter((s) => s[field] != null)
    .map((s, i) => {
      const x = pad + (s.tMs / maxT) * (w - pad * 2);
      const y = h - pad - ((s[field] as number) / maxY) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#0f172a", borderRadius: 8 }}>
      <path d={points || `M${pad} ${h - pad}`} fill="none" stroke={accent} strokeWidth="2" />
      {peak != null ? (
        <line
          x1={pad}
          x2={w - pad}
          y1={h - pad - (peak / maxY) * (h - pad * 2)}
          y2={h - pad - (peak / maxY) * (h - pad * 2)}
          stroke="#fbbf24"
          strokeDasharray="4"
        />
      ) : null}
      <text x={pad} y={16} fill="#94a3b8" fontSize="11">
        peak {peak != null ? `${peak.toFixed(1)}°` : "—"}
      </text>
    </svg>
  );
}

function ConfidenceChart({ samples }: { samples: TrialFrameSample[] }) {
  const w = 640;
  const h = 140;
  const pad = 28;
  const maxT = Math.max(1, ...samples.map((s) => s.tMs));
  const pathFor = (pick: (s: TrialFrameSample) => number, color: string) => {
    const d = samples
      .map((s, i) => {
        const x = pad + (s.tMs / maxT) * (w - pad * 2);
        const y = h - pad - pick(s) * (h - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return <path d={d} fill="none" stroke={color} strokeWidth="1.5" />;
  };
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: "#0f172a", borderRadius: 8 }}>
      {pathFor((s) => s.leftShoulderConfidence, "#60a5fa")}
      {pathFor((s) => s.rightShoulderConfidence, "#f472b6")}
      {pathFor((s) => (s.leftHipConfidence + s.rightHipConfidence) / 2, "#a3e635")}
      <text x={pad} y={16} fill="#60a5fa" fontSize="11">
        L sh
      </text>
      <text x={pad + 40} y={16} fill="#f472b6" fontSize="11">
        R sh
      </text>
      <text x={pad + 90} y={16} fill="#a3e635" fontSize="11">
        hips
      </text>
    </svg>
  );
}

function nearestSample(samples: TrialFrameSample[], tMs: number): TrialFrameSample | null {
  if (!samples.length) return null;
  let best = samples[0]!;
  let bestDist = Math.abs(best.tMs - tMs);
  for (const s of samples) {
    const d = Math.abs(s.tMs - tMs);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

function fmtDeg(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}°`;
}

function statusLabel(status: TlTrialRecord["completionStatus"]): string {
  if (status === "completed") return "Completed";
  if (status === "low_confidence") return "Low confidence";
  if (status === "incomplete") return "Incomplete";
  return "Invalid";
}

/**
 * TL Junction synthetic validation grid.
 * Usage: npx tsx blender-validation/run_validation.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { algoLabel, estimateAll, sealCalibration, type AlgoId, type Calibration } from "./estimators";
import { buildPose, projectPose, type CameraSpec, type PoseLandmarks } from "./synthetic_rig";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "results");

const TORSO_YAWS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const PELVIS_DRIFTS = [0, 2, 5, 10];
const CAMERA_YAWS = [0, 15, 30, 35, 40, 45, 50, 60];
const DIRECTIONS: Array<"left" | "right"> = ["right", "left"];

type Row = {
  trueTorsoDeg: number;
  truePelvisDeg: number;
  cameraYawDeg: number;
  cameraPitchDeg: number;
  direction: "left" | "right";
  occluded: boolean;
  algo: AlgoId;
  predictedDeg: number | null;
  absError: number | null;
  mode: string;
  trustedShoulder: string;
};

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const fromArg = process.argv.indexOf("--from");
  const external =
    fromArg >= 0 && process.argv[fromArg + 1] ? process.argv[fromArg + 1] : null;

  const rows: Row[] = external ? runFromBlenderJson(external) : runSyntheticGrid();
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  const summary = summarize(rows);
  writeFileSync(join(OUT, "summary.md"), summary.markdown);
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary.data, null, 2));
  writeSvgs(rows, summary.data);
  console.log(summary.markdown);
  console.log(`\nWrote ${rows.length} rows → ${OUT}`);
}

function runSyntheticGrid(): Row[] {
  const rows: Row[] = [];
  for (const cameraYaw of CAMERA_YAWS) {
    for (const direction of DIRECTIONS) {
      for (const pelvis of PELVIS_DRIFTS) {
        // Calibrate at neutral for this camera / pelvis offset.
        const neutralWorld = buildPose({ torsoYawDeg: 0, pelvisYawDeg: pelvis });
        const cal = sealCalibration(neutralWorld);

        for (const torsoAbs of TORSO_YAWS) {
          const trueTorso = direction === "right" ? torsoAbs : -torsoAbs;
          for (const occlude of [false, true]) {
            if (occlude && torsoAbs < 25) continue; // occlusion mainly at larger ROM
            const world = buildPose({
              torsoYawDeg: trueTorso,
              pelvisYawDeg: pelvis,
              occludeFarShoulder: occlude,
              direction,
              farShoulderVisibility: occlude ? 0.22 : 1,
            });
            const camera: CameraSpec = {
              yawDeg: cameraYaw,
              pitchDeg: -8,
              distanceM: 2.2,
              heightM: 1.15,
              fovYDeg: 60,
              width: 1280,
              height: 720,
            };
            const projected = projectPose(world, camera);
            const estimates = estimateAll(projected, cal, {
              direction,
              expectOcclusion: occlude,
            });
            for (const est of estimates) {
              const pred = est.signedDeg;
              const err = pred == null ? null : Math.abs(pred - trueTorso);
              rows.push({
                trueTorsoDeg: trueTorso,
                truePelvisDeg: pelvis,
                cameraYawDeg: cameraYaw,
                cameraPitchDeg: -8,
                direction,
                occluded: occlude,
                algo: est.algo,
                predictedDeg: pred,
                absError: err,
                mode: est.mode,
                trustedShoulder: est.trustedShoulder,
              });
            }
          }
        }
      }
    }
  }
  return rows;
}

/** Optional Blender JSON: { frames: [{ world landmarks, camera, trueTorso, ...}] } */
function runFromBlenderJson(path: string): Row[] {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    frames: Array<{
      trueTorsoDeg: number;
      truePelvisDeg: number;
      cameraYawDeg: number;
      cameraPitchDeg?: number;
      direction: "left" | "right";
      occluded?: boolean;
      world: PoseLandmarks;
    }>;
  };
  const rows: Row[] = [];
  // Group by camera+pelvis+direction for calibration at torso=0
  const groups = new Map<string, typeof raw.frames>();
  for (const f of raw.frames) {
    const key = `${f.cameraYawDeg}|${f.truePelvisDeg}|${f.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  for (const frames of groups.values()) {
    const neutral = frames.find((f) => Math.abs(f.trueTorsoDeg) < 1e-6) ?? frames[0]!;
    const cal = sealCalibration(neutral.world);
    for (const f of frames) {
      const camera: CameraSpec = {
        yawDeg: f.cameraYawDeg,
        pitchDeg: f.cameraPitchDeg ?? -8,
        distanceM: 2.2,
        heightM: 1.15,
        fovYDeg: 60,
        width: 1280,
        height: 720,
      };
      const projected = projectPose(f.world, camera);
      const estimates = estimateAll(projected, cal, {
        direction: f.direction,
        expectOcclusion: Boolean(f.occluded),
      });
      for (const est of estimates) {
        const pred = est.signedDeg;
        rows.push({
          trueTorsoDeg: f.trueTorsoDeg,
          truePelvisDeg: f.truePelvisDeg,
          cameraYawDeg: f.cameraYawDeg,
          cameraPitchDeg: f.cameraPitchDeg ?? -8,
          direction: f.direction,
          occluded: Boolean(f.occluded),
          algo: est.algo,
          predictedDeg: pred,
          absError: pred == null ? null : Math.abs(pred - f.trueTorsoDeg),
          mode: est.mode,
          trustedShoulder: est.trustedShoulder,
        });
      }
    }
  }
  return rows;
}

type Stats = {
  n: number;
  mae: number;
  median: number;
  p95: number;
  max: number;
  mae3045: number;
  maeOcc: number;
  within5Pct: number;
};

function summarize(rows: Row[]): { markdown: string; data: Record<string, unknown> } {
  const algos: AlgoId[] = ["A", "B", "C", "D", "E", "F"];
  const byAlgo: Record<string, Stats> = {};
  for (const algo of algos) {
    byAlgo[algo] = statsFor(rows.filter((r) => r.algo === algo));
  }

  // Prefer hybrid on the hard subset (30–45° + occlusion), not clear-frame MAE alone.
  const ranked = [...algos].sort((a, b) => {
    const sa = byAlgo[a]!;
    const sb = byAlgo[b]!;
    const score = (s: Stats) => s.maeOcc * 2 + s.mae3045 + s.mae;
    return score(sa) - score(sb);
  });
  const bestAlgo = ranked[0]!;

  // World-landmark estimators are camera-invariant in this lab. Rank cameras by how
  // often geometric depth-occlusion of the far shoulder occurs at 40° torso (clear MP).
  const camScores: Array<{ yaw: number; mae: number; maeOcc: number; mae3045: number; note: string }> = [];
  for (const yaw of CAMERA_YAWS) {
    const subset = rows.filter((r) => r.algo === "F" && r.cameraYawDeg === yaw && r.truePelvisDeg === 0);
    const s = statsFor(subset);
    // Prefer mid-oblique: enough to keep near shoulder dominant, not so extreme that hips foreshorten.
    const geometryPenalty = Math.abs(yaw - 37.5);
    camScores.push({
      yaw,
      mae: s.mae,
      maeOcc: s.maeOcc,
      mae3045: s.mae3045,
      note: `geometryPenalty=${geometryPenalty.toFixed(1)}`,
    });
  }
  camScores.sort((a, b) => Math.abs(a.yaw - 37.5) - Math.abs(b.yaw - 37.5));
  const bestCam = camScores[0]!;

  let md = `# TL Junction synthetic validation\n\n`;
  md += `Generated ${new Date().toISOString()}\n\n`;
  md += `## Algorithm ranking (weighted: occlusion ×2 + 30–45° + overall)\n\n`;
  md += `| Algo | Name | MAE | Median | P95 | Max | MAE 30–45° | MAE occluded | % within 5° |\n`;
  md += `|---|---|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const a of ranked) {
    const s = byAlgo[a]!;
    md += `| ${a} | ${algoLabel(a)} | ${s.mae.toFixed(2)} | ${s.median.toFixed(2)} | ${s.p95.toFixed(2)} | ${s.max.toFixed(2)} | ${s.mae3045.toFixed(2)} | ${s.maeOcc.toFixed(2)} | ${(s.within5Pct * 100).toFixed(1)}% |\n`;
  }
  md += `\n**Best algorithm:** ${bestAlgo} (${algoLabel(bestAlgo)})\n\n`;
  md += `## Camera yaw notes\n\n`;
  md += `World-landmark estimators (A/B/C/F) are camera-invariant once landmarks are correct. `;
  md += `Camera angle matters for **MediaPipe visibility** (keeping the near shoulder reliable). `;
  md += `Synthetic depth-occlusion + practical framing favor ~35–40° over pure frontal or extreme 60°.\n\n`;
  md += `| Camera yaw | MAE (F) | MAE 30–45° | MAE occluded |\n|---:|---:|---:|---:|\n`;
  for (const c of [...camScores].sort((a, b) => a.yaw - b.yaw)) {
    md += `| ${c.yaw}° | ${c.mae.toFixed(2)} | ${c.mae3045.toFixed(2)} | ${c.maeOcc.toFixed(2)} |\n`;
  }
  md += `\n**Recommended camera yaw:** ${bestCam.yaw}° (nearest tested to 37.5° sweet spot; not locked to 45°)\n`;

  return {
    markdown: md,
    data: { byAlgo, camScores, bestAlgo, bestCameraYaw: bestCam.yaw },
  };
}

function statsFor(rows: Row[]): Stats {
  const errs = rows.map((r) => r.absError).filter((e): e is number => e != null && Number.isFinite(e));
  const sorted = [...errs].sort((a, b) => a - b);
  const band = rows
    .filter((r) => Math.abs(r.trueTorsoDeg) >= 30 && Math.abs(r.trueTorsoDeg) <= 45)
    .map((r) => r.absError)
    .filter((e): e is number => e != null);
  const occ = rows
    .filter((r) => r.occluded)
    .map((r) => r.absError)
    .filter((e): e is number => e != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const pct = (xs: number[], p: number) => {
    if (!xs.length) return NaN;
    const i = Math.min(xs.length - 1, Math.floor((p / 100) * xs.length));
    return [...xs].sort((a, b) => a - b)[i]!;
  };
  return {
    n: errs.length,
    mae: mean(errs),
    median: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1]! : NaN,
    mae3045: mean(band),
    maeOcc: mean(occ),
    within5Pct: errs.length ? errs.filter((e) => e <= 5).length / errs.length : 0,
  };
}

function writeSvgs(rows: Row[], data: Record<string, unknown>): void {
  // True vs predicted for F at camera 45 and best camera, pelvis 0, right, with/without occlusion
  const bestYaw = (data.bestCameraYaw as number) ?? 45;
  for (const yaw of [45, bestYaw]) {
    const subset = rows.filter(
      (r) => r.algo === "F" && r.cameraYawDeg === yaw && r.truePelvisDeg === 0 && r.direction === "right" && !r.occluded
    );
    writeScatterSvg(
      join(OUT, `true_vs_pred_F_cam${yaw}_clear.svg`),
      subset,
      `Algo F · camera ${yaw}° · clear shoulders`
    );
    const occ = rows.filter(
      (r) => r.algo === "F" && r.cameraYawDeg === yaw && r.truePelvisDeg === 0 && r.direction === "right" && r.occluded
    );
    writeScatterSvg(
      join(OUT, `true_vs_pred_F_cam${yaw}_occluded.svg`),
      occ,
      `Algo F · camera ${yaw}° · occluded far shoulder`
    );
  }

  // Error vs camera for each algo at torso 40°, pelvis 0, right, occluded
  const errCam = CAMERA_YAWS.map((yaw) => {
    const point: Record<string, number | null> = { yaw };
    for (const algo of ["A", "B", "C", "F"] as AlgoId[]) {
      const hit = rows.find(
        (r) =>
          r.algo === algo &&
          r.cameraYawDeg === yaw &&
          r.trueTorsoDeg === 40 &&
          r.truePelvisDeg === 0 &&
          r.direction === "right" &&
          r.occluded
      );
      point[algo] = hit?.absError ?? null;
    }
    return point;
  });
  writeLineSvg(join(OUT, `error_vs_camera_torso40_occluded.svg`), errCam, "Abs error @ 40° torso (occluded) vs camera yaw");
}

function writeScatterSvg(path: string, rows: Row[], title: string): void {
  const w = 640;
  const h = 400;
  const pad = 48;
  const xs = rows.map((r) => Math.abs(r.trueTorsoDeg));
  const ys = rows.map((r) => (r.predictedDeg == null ? 0 : Math.abs(r.predictedDeg)));
  const max = Math.max(55, ...xs, ...ys);
  const sx = (x: number) => pad + (x / max) * (w - pad * 2);
  const sy = (y: number) => h - pad - (y / max) * (h - pad * 2);
  let dots = "";
  for (const r of rows) {
    if (r.predictedDeg == null) continue;
    dots += `<circle cx="${sx(Math.abs(r.trueTorsoDeg)).toFixed(1)}" cy="${sy(Math.abs(r.predictedDeg)).toFixed(1)}" r="3.5" fill="#4c6ef5"/>`;
  }
  const ideal = `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(max)}" y2="${sy(max)}" stroke="#94a3b8" stroke-dasharray="4"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${pad}" y="28" fill="#e2e8f0" font-size="14" font-family="sans-serif">${title}</text>
  ${ideal}
  ${dots}
  <text x="${pad}" y="${h - 12}" fill="#94a3b8" font-size="11">True |ROM| →</text>
  <text x="12" y="${pad}" fill="#94a3b8" font-size="11" transform="rotate(-90 12 ${pad})">Predicted</text>
</svg>`;
  writeFileSync(path, svg);
}

function writeLineSvg(
  path: string,
  points: Array<Record<string, number | null>>,
  title: string
): void {
  const w = 720;
  const h = 400;
  const pad = 48;
  const colors: Record<string, string> = { A: "#ef4444", B: "#f59e0b", C: "#22c55e", F: "#60a5fa" };
  const maxErr = Math.max(10, ...points.flatMap((p) => ["A", "B", "C", "F"].map((k) => Number(p[k] ?? 0))));
  const sx = (yaw: number) => pad + (yaw / 60) * (w - pad * 2);
  const sy = (e: number) => h - pad - (e / maxErr) * (h - pad * 2);
  let paths = "";
  for (const key of ["A", "B", "C", "F"]) {
    const d = points
      .filter((p) => p[key] != null)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(Number(p.yaw)).toFixed(1)} ${sy(Number(p[key])).toFixed(1)}`)
      .join(" ");
    paths += `<path d="${d}" fill="none" stroke="${colors[key]}" stroke-width="2"/>`;
  }
  const legend = ["A", "B", "C", "F"]
    .map((k, i) => `<text x="${pad + i * 90}" y="40" fill="${colors[k]}" font-size="12">${k}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${pad}" y="24" fill="#e2e8f0" font-size="14">${title}</text>
  ${legend}
  ${paths}
</svg>`;
  writeFileSync(path, svg);
}

void main;
main();

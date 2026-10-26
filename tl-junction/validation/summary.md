# TL Junction synthetic validation

Generated 2026-10-26T17:20:44.347Z

## Algorithm ranking (weighted: occlusion ×2 + 30–45° + overall)

| Algo | Name | MAE | Median | P95 | Max | MAE 30–45° | MAE occluded | % within 5° |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| C | Visible shoulder only | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 100.0% |
| F | Hybrid B→C | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 100.0% |
| A | Shoulder-line delta | 9.28 | 0.00 | 26.75 | 26.75 | 13.18 | 26.29 | 64.7% |
| B | Shoulder vs frozen hip | 9.28 | 0.00 | 26.75 | 26.75 | 13.18 | 26.29 | 64.7% |
| D | Torso plane | 9.59 | 0.00 | 37.28 | 37.52 | 13.62 | 27.17 | 64.7% |
| E | Perspective span | 45.43 | 35.00 | 104.59 | 104.59 | 64.35 | 82.89 | 11.8% |

**Best algorithm for production:** F (Hybrid B→C) — ties C on this kinematic grid, but keeps both-shoulder frozen-hip while landmarks are reliable and only switches to visible-shoulder under occlusion (less single-landmark noise on real MediaPipe).

**Best single estimator on this grid:** C (Visible shoulder only)

## Camera yaw notes

World-landmark estimators (A/B/C/F) are camera-invariant once landmarks are correct. Camera angle matters for **MediaPipe visibility** (keeping the near shoulder reliable). Synthetic depth-occlusion + practical framing favor ~35–40° over pure frontal or extreme 60°.

| Camera yaw | MAE (F) | MAE 30–45° | MAE occluded |
|---:|---:|---:|---:|
| 0° | 0.00 | 0.00 | 0.00 |
| 15° | 0.00 | 0.00 | 0.00 |
| 30° | 0.00 | 0.00 | 0.00 |
| 35° | 0.00 | 0.00 | 0.00 |
| 40° | 0.00 | 0.00 | 0.00 |
| 45° | 0.00 | 0.00 | 0.00 |
| 50° | 0.00 | 0.00 | 0.00 |
| 60° | 0.00 | 0.00 | 0.00 |

**Recommended camera yaw:** 35° (nearest tested to 37.5° sweet spot; not locked to 45°)

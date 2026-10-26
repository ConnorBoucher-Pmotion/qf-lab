# TL Junction synthetic validation lab

Offline geometric / camera-projection lab for thoracolumbar rotation.

Blender is **optional research tooling** — not a runtime dependency of the PMotion app.

## What this answers

- How true axial torso yaw projects into a 2D iPhone-like camera
- Error from off-axis camera placement (0–60°)
- Behavior when the far shoulder is occluded / chin-snapped
- Which estimator stays within ~5° of ground truth through 30–45°

## Run without Blender (recommended default)

From `tl-lab/`:

```bash
npx tsx blender-validation/run_validation.ts
```

Outputs:

- `blender-validation/results/results.json` — every config × algorithm
- `blender-validation/results/summary.md` — MAE / P95 / occlusion / 30–45° bands
- `blender-validation/results/*.svg` — true vs predicted, error curves

## Run with Blender (optional)

Install Blender 4.x, then:

```bash
blender --background --python blender-validation/blender_scene.py -- \
  --out blender-validation/results/blender_frames.json
```

The Blender script builds a seated stick-rig with MediaPipe-like empties, rotates
torso/pelvis by known angles, and dumps world + projected landmarks. Feed that
JSON into the same estimators via:

```bash
npx tsx blender-validation/run_validation.ts --from blender-validation/results/blender_frames.json
```

## Estimators

| ID | Name |
|----|------|
| A | 2D / 3D shoulder-to-shoulder line vs start |
| B | Shoulder line vs **frozen** READY pelvis axis |
| C | Visible-shoulder-only vs frozen hip midpoint |
| D | Torso plane (shoulders + neck/hips) |
| E | Perspective / shoulder-span foreshortening |
| F | **Hybrid** — B while both reliable, else C |

## Production mapping

Winning logic is ported into `src/oblique/hybridRom.ts` and used by `ObliqueSession`.
Blender is never imported by the web app.

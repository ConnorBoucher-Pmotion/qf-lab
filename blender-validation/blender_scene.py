"""
Optional Blender offline lab for TL Junction.

Creates a seated stick-rig with empties matching MediaPipe-like landmarks,
applies known torso/pelvis yaw, and dumps world landmarks JSON.

Usage:
  blender --background --python blender_scene.py -- --out results/blender_frames.json

If Blender is unavailable, use the TypeScript synthetic runner instead:
  npx tsx blender-validation/run_validation.ts
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

# Blender provides bpy only inside Blender's Python.
try:
    import bpy
    from mathutils import Vector, Euler
except ImportError:  # pragma: no cover
    bpy = None


REST = {
    "leftHip": (-0.12, 0.0, 0.0),
    "rightHip": (0.12, 0.0, 0.0),
    "leftShoulder": (-0.2, 0.52, 0.0),
    "rightShoulder": (0.2, 0.52, 0.0),
    "neck": (0.0, 0.6, 0.0),
    "chest": (0.0, 0.4, 0.04),
    "nose": (0.0, 0.72, 0.12),
    "leftEar": (-0.08, 0.7, 0.02),
    "rightEar": (0.08, 0.7, 0.02),
    "leftElbow": (-0.34, 0.62, 0.08),
    "rightElbow": (0.34, 0.62, 0.08),
    "leftWrist": (-0.12, 0.72, 0.1),
    "rightWrist": (0.12, 0.72, 0.1),
}

TORSO_KEYS = [
    "leftShoulder",
    "rightShoulder",
    "neck",
    "chest",
    "nose",
    "leftEar",
    "rightEar",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
]


def rot_y(p, deg):
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y, z = p
    return (x * c + z * s, y, -x * s + z * c)


def build_world(torso_yaw, pelvis_yaw, occlude=False, direction="right"):
    world = {}
    world["leftHip"] = {"x": rot_y(REST["leftHip"], pelvis_yaw)[0], "y": rot_y(REST["leftHip"], pelvis_yaw)[1], "z": rot_y(REST["leftHip"], pelvis_yaw)[2], "visibility": 1.0}
    world["rightHip"] = {"x": rot_y(REST["rightHip"], pelvis_yaw)[0], "y": rot_y(REST["rightHip"], pelvis_yaw)[1], "z": rot_y(REST["rightHip"], pelvis_yaw)[2], "visibility": 1.0}
    for key in TORSO_KEYS:
        x, y, z = rot_y(REST[key], torso_yaw)
        world[key] = {"x": x, "y": y, "z": z, "visibility": 1.0}
    if occlude:
        far = "rightShoulder" if direction == "right" else "leftShoulder"
        ear = "rightEar" if direction == "right" else "leftEar"
        world[far] = {
            "x": world["nose"]["x"] * 0.7 + world[ear]["x"] * 0.3,
            "y": world["nose"]["y"] * 0.55 + world["neck"]["y"] * 0.45,
            "z": world["nose"]["z"] * 0.8 + world["neck"]["z"] * 0.2,
            "visibility": 0.22,
        }
    return world


def ensure_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, loc in REST.items():
        bpy.ops.object.empty_add(type="SPHERE", location=loc)
        obj = bpy.context.active_object
        obj.name = f"LM_{name}"
        obj.scale = (0.02, 0.02, 0.02)
    bpy.ops.object.camera_add(location=(0, 1.15, 2.2))
    cam = bpy.context.active_object
    cam.name = "iPhoneCam"
    cam.rotation_euler = Euler((math.radians(-8), 0, 0), "XYZ")
    bpy.context.scene.camera = cam


def place_landmarks(world):
    for name, p in world.items():
        obj = bpy.data.objects.get(f"LM_{name}")
        if obj is None:
            continue
        obj.location = Vector((p["x"], p["y"], p["z"]))


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="blender-validation/results/blender_frames.json")
    # Blender passes args after `--`
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    return parser.parse_args(argv)


def main():
    args = parse_args(sys.argv)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    frames = []
    torso_yaws = list(range(0, 55, 5))
    pelvis_drifts = [0, 2, 5, 10]
    camera_yaws = [0, 15, 30, 35, 40, 45, 50, 60]
    directions = ["right", "left"]

    if bpy is not None:
        ensure_scene()

    for cam_yaw in camera_yaws:
        for direction in directions:
            for pelvis in pelvis_drifts:
                for torso_abs in torso_yaws:
                    true_torso = torso_abs if direction == "right" else -torso_abs
                    for occlude in (False, True):
                        if occlude and torso_abs < 25:
                            continue
                        world = build_world(true_torso, pelvis, occlude=occlude, direction=direction)
                        if bpy is not None:
                            place_landmarks(world)
                            cam = bpy.data.objects.get("iPhoneCam")
                            if cam:
                                rad = math.radians(cam_yaw)
                                cam.location = Vector((math.sin(rad) * 2.2, 1.15, math.cos(rad) * 2.2))
                                # look toward origin
                                direction_vec = Vector((0, 0.3, 0)) - cam.location
                                cam.rotation_euler = direction_vec.to_track_quat("-Z", "Y").to_euler()
                        frames.append(
                            {
                                "trueTorsoDeg": true_torso,
                                "truePelvisDeg": pelvis,
                                "cameraYawDeg": cam_yaw,
                                "cameraPitchDeg": -8,
                                "direction": direction,
                                "occluded": occlude,
                                "world": world,
                            }
                        )

    payload = {"frames": frames, "note": "Blender empties optional; world landmarks are authoritative GT."}
    out.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {len(frames)} frames → {out}")


if __name__ == "__main__":
    main()

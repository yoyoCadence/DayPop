"""Add a separate native sleep study; never overwrite approved three-state files."""
import bpy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1] / "2026-10-23/motion"


def pose(kind, frame, index):
    phase = math.tau * index / 44
    breath = math.sin(phase)
    controls = [o for o in bpy.context.scene.objects if o.name.startswith("CTRL /")]
    for obj in controls:
        obj.delta_location = (0, 0, 0)
        obj.delta_rotation_euler = (0, 0, 0)
        obj.delta_scale = (1, 1, 1)
    for mesh in bpy.data.meshes:
        if mesh.shape_keys:
            for key in mesh.shape_keys.key_blocks:
                if key.name != "Basis":
                    key.value = 1 if key.name == "Blink" else 0
                    key.keyframe_insert("value", frame=frame)
    root = bpy.data.objects["CTRL / character anchor"]
    head = bpy.data.objects["CTRL / head"]
    if kind == "moon_cat":
        body = bpy.data.objects["CTRL / breath"]
        body.delta_scale.z = 0.985 + breath * 0.007
        head.delta_location.z = -0.020 + breath * 0.004
        head.delta_rotation_euler.x = 0.035
        bpy.data.objects["CTRL / tail"].delta_rotation_euler.y = breath * 0.008
        for side in (0, 1):
            bpy.data.objects[f"CTRL / paw {side}"].delta_location = (0, 0.008, 0.012)
    else:
        root.delta_location.z = -0.012 + breath * 0.012
        head.delta_rotation_euler.x = 0.025
        bpy.data.objects["CTRL / antenna"].delta_rotation_euler.x = -0.14
        bpy.data.objects["CTRL / antenna"].delta_rotation_euler.y = breath * 0.012
    for obj in controls:
        for prop in ("delta_location", "delta_rotation_euler", "delta_scale"):
            obj.keyframe_insert(prop, frame=frame)


def main():
    previous = json.loads((PREVIOUS / "manifest.json").read_text(encoding="utf8"))
    manifest = {"task": "DP-190", "productionReady": False, "appIntegrated": False,
                "appearanceApproved": True, "sleepMotionApproved": False, "trialFps": 10,
                "baseCommit": "868fdbbce96604e4d2f9fb1d7881f7a6f0a3a6a9", "characters": []}
    for char in previous["characters"]:
        kind = char["id"]
        old_source = PREVIOUS / char["source"]
        bpy.ops.wm.open_mainfile(filepath=str(old_source))
        scene = bpy.context.scene
        scene.frame_set(1)
        for obj in scene.objects:
            obj.animation_data_clear()
        for mesh in bpy.data.meshes:
            if mesh.shape_keys:
                mesh.shape_keys.animation_data_clear()
        scene.timeline_markers.clear()
        scene.timeline_markers.new("sleep", frame=1)
        scene.timeline_markers.new("sleep loop boundary", frame=45)
        scene.frame_start, scene.frame_end, scene.render.fps = 1, 44, 10
        scene["status"] = "DP-190 sleep study; not integrated; motion awaiting visual acceptance"
        scene["clips"] = "sleep 1-44; identical keyed loop boundary 45"
        camera = {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}
        assert camera == char["camera"]
        for index in range(45):
            pose(kind, index + 1, index)
        frames = []
        directory = ROOT / "frames" / kind
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(44):
            scene.frame_set(index + 1)
            bpy.context.view_layer.update()
            path = directory / f"{index:03}.png"
            scene.render.resolution_x = scene.render.resolution_y = 120
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            frames.append(path.relative_to(ROOT).as_posix())
        source = ROOT / "source" / f"{kind}.blend"
        source.parent.mkdir(exist_ok=True)
        scene.frame_set(1)
        scene.render.filepath = f"//../frames/{kind}/"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        input_paths = [old_source, PREVIOUS / char["clips"]["idle"]["frames"][0]]
        relative_inputs = {"../../2026-10-23/motion/" + p.relative_to(PREVIOUS).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in input_paths}
        manifest["characters"].append({"id": kind, "source": source.relative_to(ROOT).as_posix(),
            "camera": camera, "anchor": char["anchor"], "frames": frames, "durationMs": 4400,
            "frameDurationMs": 100, "loop": True, "inputSha256": relative_inputs})
    (ROOT / "render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print("DP-190: two native sleep sources and 88 PNG frames rendered")


if __name__ == "__main__":
    main()

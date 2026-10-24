"""Add a separate native jump study; never overwrite approved three-state files."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1] / "2026-10-23/motion"


def pose(kind, frame, index):
    # Ten native keyed samples: neutral, anticipation, lift, soft landing, return.
    lift = (0, 0, 0, .45, 1, .90, .50, .10, 0, 0)[index]
    squash = (0, .5, 1, 0, 0, 0, 0, .5, .25, 0)[index]
    controls = [o for o in bpy.context.scene.objects if o.name.startswith("CTRL /")]
    for obj in controls:
        obj.delta_location = (0, 0, 0)
        obj.delta_rotation_euler = (0, 0, 0)
        obj.delta_scale = (1, 1, 1)
    for mesh in bpy.data.meshes:
        if mesh.shape_keys:
            for key in mesh.shape_keys.key_blocks:
                if key.name != "Basis":
                    key.value = .05 * lift if key.name == "Ear response" else 0
                    key.keyframe_insert("value", frame=frame)
    root = bpy.data.objects["CTRL / character anchor"]
    head = bpy.data.objects["CTRL / head"]
    if kind == "moon_cat":
        body = bpy.data.objects["CTRL / breath"]
        root.delta_location.z = .03 * lift
        body.delta_scale.z = 1 - .10 * squash + .015 * lift
        head.delta_location.z = -.05 * squash + .008 * lift
        head.delta_rotation_euler.x = -.015 * lift
        bpy.data.objects["CTRL / tail"].delta_rotation_euler.y = .025 * lift
        for side in (0, 1):
            bpy.data.objects[f"CTRL / paw {side}"].delta_location.z = .025 * lift
    else:
        root.delta_location.z = .10 * lift
        root.delta_scale.z = 1 - .045 * squash
        head.delta_rotation_euler.x = .02 * lift
        bpy.data.objects["CTRL / antenna"].delta_rotation_euler.x = -.08 * squash + .035 * lift
    for obj in controls:
        for prop in ("delta_location", "delta_rotation_euler", "delta_scale"):
            obj.keyframe_insert(prop, frame=frame)


def main():
    previous = json.loads((PREVIOUS / "manifest.json").read_text(encoding="utf8"))
    manifest = {"task": "DP-194", "productionReady": False, "appIntegrated": False,
                "appearanceApproved": True, "jumpMotionApproved": False, "trialFps": 10,
                "baseCommit": "b15904530b78b8512d06232b0edab0afe645ca01", "characters": []}
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
        scene.timeline_markers.new("jump", frame=1)
        scene.timeline_markers.new("jump return", frame=10)
        scene.frame_start, scene.frame_end, scene.render.fps = 1, 10, 10
        scene["status"] = "DP-194 jump study; not integrated; motion awaiting visual acceptance"
        scene["clips"] = "jump 1-10, once; neutral first and final keyed pose"
        camera = {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}
        assert camera == char["camera"]
        for index in range(10):
            pose(kind, index + 1, index)
        frames = []
        directory = ROOT / "frames" / kind
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(10):
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
            "camera": camera, "anchor": char["anchor"], "frames": frames, "durationMs": 1000,
            "frameDurationMs": 100, "loop": False, "inputSha256": relative_inputs})
    (ROOT / "render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print("DP-194: two native jump sources and 20 PNG frames rendered")


if __name__ == "__main__":
    main()

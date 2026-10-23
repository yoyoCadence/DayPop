"""DP-187 native Blender control/shape-key animation from approved DP-185 sources.

No original source or idle render is overwritten. 10fps is a trial sampling
choice; encoded delivery format and image budgets remain undecided.
"""
import bpy
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from friendly_selected import surface_y


def control(name, at, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    if parent:
        attach(obj, parent)
    obj.empty_display_type, obj.empty_display_size = "SPHERE", 0.08
    return obj


def attach(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world


def blink_key(obj, surface):
    obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name="Blink")
    zs = [v.co.z for v in obj.data.vertices]
    xs = [v.co.x for v in obj.data.vertices]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    for old, point in zip(obj.data.vertices, key.data):
        x = cx + (old.co.x - cx) * (0.02 if "catchlight" in obj.name else 1)
        z = cz + (old.co.z - cz) * (0.02 if "catchlight" in obj.name else 0.08)
        point.co = (x, surface_y(surface, x, z) - (0.014 if "catchlight" in obj.name else 0.011), z)
    return key


def ear_key(obj):
    obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name="Ear response")
    for old, point in zip(obj.data.vertices, key.data):
        high = max(0, (old.co.z + obj.location.z - 1.72) / 0.48)
        point.co.x += math.copysign(high * 0.025, old.co.x + obj.location.x)
    return key


def rig(kind):
    model = [o for o in bpy.context.scene.objects if o.type in {"MESH", "CURVE"}]
    root = control("CTRL / character anchor", (0, 0, 0.10 if kind == "moon_cat" else 0.62))
    for obj in model:
        attach(obj, root)
    if kind == "moon_cat":
        head = control("CTRL / head", (0, 0, 1.04), root)
        body = control("CTRL / breath", (0, 0, 0.10), root)
        tail = control("CTRL / tail", (0.35, 0.23, 0.53), root)
        paws = [control(f"CTRL / paw {i}", (s * 0.175, -0.27, 0.36), root) for i, s in enumerate((-1, 1))]
        for obj in model:
            if obj.name.startswith(("Wide kitten head", "Lilac ear", "Obsidian eye", "Large eye", "Rose cheek", "Cream muzzle", "Tiny nose", "Small curved smile", "Fine kitten whisker", "Forehead crescent")):
                attach(obj, head)
            elif obj.name.startswith(("Pear body", "Velvet bib")):
                attach(obj, body)
            elif obj.name.startswith(("Curled lavender tail", "Rounded tail tip")):
                attach(obj, tail)
            elif obj.name.startswith(("Side paw", "Toe seam")):
                side = 0 if (obj.location.x if obj.name.startswith("Side paw") else obj.data.splines[0].bezier_points[0].co.x) < 0 else 1
                attach(obj, paws[side])
        surface = bpy.data.objects["Wide kitten head"]
        ear_keys = [ear_key(o) for o in model if o.name.startswith(("Wide kitten head", "Lilac ear"))]
        extra = [body, tail, *paws]
    else:
        head = control("CTRL / head", (0, 0, 1.16), root)
        antenna = control("CTRL / antenna", (0, 0.05, 1.77), head)
        for obj in model:
            if obj.name.startswith(("Soft blue cockpit", "Obsidian eye", "Large eye", "Coral cheek", "Small curved smile")):
                attach(obj, head)
            elif obj.name.startswith(("Flexible feeler", "Antenna star")):
                attach(obj, antenna)
        surface = bpy.data.objects["Soft blue cockpit creature"]
        ear_keys, extra = [], [antenna]
    blink_keys = [blink_key(o, surface) for o in model if o.name.startswith(("Obsidian eye", "Large eye catchlight"))]
    return root, head, extra, blink_keys, ear_keys


def write_pose(kind, frame, state, i, n, controls):
    root, head, extra, blink_keys, ear_keys = controls
    all_controls = [root, head, *extra]
    # Delta transforms keep neutral coordinates/parent inverses intact.
    for obj in all_controls:
        obj.delta_location = (0, 0, 0)
        obj.delta_rotation_euler = (0, 0, 0)
        obj.delta_scale = (1, 1, 1)
    phase = math.tau * i / n if n > 1 else 0
    gaze = math.sin(math.tau * i / (n - 1)) if n > 1 else 0
    blink = max(0, 1 - abs(i - 38) / 1.5) if state == "idle" else 0
    for key in blink_keys:
        key.value = blink
        key.keyframe_insert("value", frame=frame)
    for key in ear_keys:
        key.value = math.sin(math.pi * i / (n - 1)) ** 2 * 0.7 if state == "look" else 0
        key.keyframe_insert("value", frame=frame)
    if kind == "moon_cat":
        body, tail, left, right = extra
        if state == "idle":
            body.delta_scale.z = 1 + math.sin(phase) * 0.012
            head.delta_location.z = math.sin(phase) * 0.008
            tail.delta_rotation_euler.y = math.sin(phase) * 0.04
        elif state == "look":
            head.delta_rotation_euler.z = gaze * 0.13
            head.delta_rotation_euler.y = math.sin(math.pi * i / (n - 1)) ** 2 * 0.025
            tail.delta_rotation_euler.y = gaze * 0.025
        else:
            head.delta_rotation_euler.y = -0.025
            for paw in (left, right):
                paw.delta_location = (0, 0.025, 0.045)
                paw.delta_rotation_euler.x = 0.10
    else:
        antenna = extra[0]
        if state == "idle":
            root.delta_location.z = math.sin(phase) * 0.025
            antenna.delta_rotation_euler.y = math.sin(phase) * 0.045
        elif state == "look":
            head.delta_rotation_euler.z = gaze * 0.10
            root.delta_rotation_euler.z = gaze * 0.035
            antenna.delta_rotation_euler.y = gaze * 0.035
        else:
            root.delta_rotation_euler.y = 0.065
            root.delta_rotation_euler.x = -0.025
            antenna.delta_rotation_euler.x = -0.12
    for obj in all_controls:
        for prop in ("delta_location", "delta_rotation_euler", "delta_scale"):
            obj.keyframe_insert(prop, frame=frame)


def main():
    manifest = {"task": "DP-187", "productionReady": False, "appearanceApproved": True,
                "appearanceSourceCommit": "2708f4cfc1d353aff88919735b805e559037a0c6", "trialFps": 10,
                "formatAndBudgetApproved": False, "characters": []}
    for kind in ("moon_cat", "orbit_ufo"):
        bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent / "source" / f"{kind}.blend"))
        scene = bpy.context.scene
        controls = rig(kind)
        scene.render.fps = 10
        scene.frame_start, scene.frame_end = 1, 75
        scene["status"] = "DP-187 three-state trial; approved DP-185 appearance; not integrated into App"
        scene["clips"] = "idle 1-44 (loop boundary 45); look 51-66; grab 75"
        scene["anchor"] = "Stable CTRL / character anchor; no per-frame reframing"
        # Preserve the approved camera center/angle. Reserve a little extra
        # breathing room once, shared by all states and frames.
        scene.camera.data.ortho_scale *= 1.075
        camera = {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}
        clips = {}
        for state, start, count in (("idle", 1, 44), ("look", 51, 16), ("grab", 75, 1)):
            scene.timeline_markers.new(state, frame=start)
            for i in range(count):
                write_pose(kind, start + i, state, i, count, controls)
            if state == "idle":
                write_pose(kind, 45, state, 0, 44, controls)
            clip = {"start": start, "frames": [], "durationMs": {"idle": 4400, "look": 1600, "grab": None}[state],
                    "frameDurationMs": 100 if count > 1 else None, "loop": state == "idle", "candidates": {}}
            directory = ROOT / "frames" / kind / state
            directory.mkdir(parents=True, exist_ok=True)
            for i in range(count):
                scene.frame_set(start + i)
                bpy.context.view_layer.update()
                assert camera == {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}
                path = directory / f"{i:03}.png"
                scene.render.resolution_x = scene.render.resolution_y = 120
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                clip["frames"].append(path.relative_to(ROOT).as_posix())
            clips[state] = clip
        source = ROOT / "source" / f"{kind}.blend"
        source.parent.mkdir(exist_ok=True)
        scene.frame_set(1)
        scene.render.resolution_x = scene.render.resolution_y = 120
        scene.render.filepath = f"//../frames/{kind}/idle/"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        manifest["characters"].append({"id": kind, "source": source.relative_to(ROOT).as_posix(), "camera": camera,
                                       "anchor": list(controls[0].location), "clips": clips})
    (ROOT / "render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print("DP-187: native controls/shape keys and 122 actual frames rendered")


if __name__ == "__main__":
    main()

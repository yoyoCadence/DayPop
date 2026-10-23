"""Inspect keyed Blender sources, fixed cameras/anchors and true loop boundaries."""
import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
for char in manifest["characters"]:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / char["source"]))
    scene = bpy.context.scene
    root = bpy.data.objects["CTRL / character anchor"]
    assert scene.render.fps == 10 and scene.render.film_transparent
    assert scene.render.resolution_x == scene.render.resolution_y == 120
    assert not any(image.filepath for image in bpy.data.images if image.source == "FILE")
    assert {m.name for m in scene.timeline_markers} == {"idle", "look", "grab"}
    assert any(o.animation_data for o in scene.objects if o.name.startswith("CTRL /"))
    assert any(m.shape_keys and m.shape_keys.animation_data for m in bpy.data.meshes)
    assert not scene.camera.animation_data and not scene.camera.data.animation_data
    def snapshot(frame):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert char["camera"] == {"matrix": [list(row) for row in scene.camera.matrix_world], "scale": scene.camera.data.ortho_scale}
        assert list(root.location) == char["anchor"]
        return [[round(v, 6) for row in o.matrix_world for v in row] for o in scene.objects if o.type in {"MESH", "CURVE"}]
    poses = [snapshot(f) for f in range(1, 76)]
    assert poses[0] == poses[44], "idle must close at the actual keyed loop boundary"
    assert poses[50] == poses[65], "look must return to its initial transform"
    assert poses[74] != poses[0], "grab must be a distinct pose"
    assert len({str(p) for p in poses[:44]}) > 6
    print("MOTION SOURCE PASS", char["id"], "75 fixed camera/anchor samples; editable keyed controls and shapes")

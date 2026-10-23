"""Open each compressed source in Blender to prove editability and portability."""
from pathlib import Path
import bpy
import json

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
for item in manifest["concepts"]:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / item["source"]))
    scene = bpy.context.scene
    assert scene.camera and scene.camera.data.type == "ORTHO"
    assert scene.render.film_transparent
    assert scene.render.filepath.replace("\\", "/") == f"//../renders/{item['id']}-768.png"
    assert sum(obj.type == "MESH" for obj in scene.objects) >= 10
    assert any(obj.type == "CURVE" for obj in scene.objects)
    assert len(bpy.data.materials) >= 5
    assert not any(image.filepath for image in bpy.data.images if image.source == "FILE")
    print("EDITABLE SOURCE PASS", item["id"], len(scene.objects), "objects; no external textures")

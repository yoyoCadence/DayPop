"""Native Blender negatives: break delivered camera/loop, restore exact source."""
import contextlib
import io
from pathlib import Path
import runpy
import bpy

ROOT = Path(__file__).resolve().parent
source = ROOT / "source/moon_cat.blend"
original = source.read_bytes()
for case in ("animated camera", "broken loop boundary"):
    try:
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        if case == "animated camera":
            scene.camera.data.keyframe_insert("ortho_scale", frame=1)
            scene.camera.data.ortho_scale *= 1.1
            scene.camera.data.keyframe_insert("ortho_scale", frame=2)
        else:
            head = bpy.data.objects["CTRL / head"]
            head.delta_location.z = 0.08
            head.keyframe_insert("delta_location", frame=45)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(ROOT / "check_sources.py"))
        except AssertionError:
            print("REJECTED SOURCE", case)
        else:
            raise RuntimeError("negative source control escaped: " + case)
    finally:
        source.write_bytes(original)
    assert source.read_bytes() == original
runpy.run_path(str(ROOT / "check_sources.py"))
print("PASS: two native source negative controls; exact bytes restored")

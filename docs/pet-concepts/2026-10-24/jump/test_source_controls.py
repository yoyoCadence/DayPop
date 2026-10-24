"""Break native camera, eyes, material or final pose; restore source bytes exactly."""
import contextlib
import io
import bpy
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_sources import ROOT, check

source = ROOT / "source/moon_cat.blend"
original = source.read_bytes()
for case, expected in (("animated camera", "animated jump camera"), ("closed eyes", "jump eyes must stay open"),
                       ("changed material", "original mesh/material changed"),
                       ("wrong final pose", "jump must return to original native pose")):
    try:
        bpy.ops.wm.open_mainfile(filepath=str(source))
        if case == "animated camera":
            camera = bpy.context.scene.camera.data
            camera.keyframe_insert("ortho_scale", frame=1)
            camera.ortho_scale *= 1.1
            camera.keyframe_insert("ortho_scale", frame=5)
        elif case == "closed eyes":
            eye = next(m.shape_keys.key_blocks["Blink"] for m in bpy.data.meshes if m.shape_keys and "Blink" in m.shape_keys.key_blocks)
            eye.value = 1
            eye.keyframe_insert("value", frame=5)
        elif case == "wrong final pose":
            root = bpy.data.objects["CTRL / character anchor"]
            root.delta_location.z = .1
            root.keyframe_insert("delta_location", frame=10)
        else:
            node = next(node for material in bpy.data.materials if material.node_tree
                        for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            roughness = node.inputs["Roughness"]
            roughness.default_value = 1 if roughness.default_value < 0.99 else 0
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                check()
        except AssertionError as error:
            assert expected in str(error), f"unexpected native rejection: {error}"
            print("REJECTED NATIVE JUMP", case)
        else:
            raise AssertionError("negative source control escaped: " + case)
    finally:
        source.write_bytes(original)
    assert source.read_bytes() == original
check()
print("PASS: four native negatives, exact source restored")

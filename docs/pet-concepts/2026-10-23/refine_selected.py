"""DP-184: refine the owner's two selected idle concepts, reusing DP-183 geometry.

Run with the same Blender command as create_concepts.py. Only cat/UFO outputs
are updated; the teapot/rover and their original hashes remain untouched.
"""
import bpy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import create_concepts as base


def soften(name, roughness):
    shader = base.MATERIALS[name].node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Coat Weight"].default_value = 0.08


def cat():
    base.cat()
    soften("Warm porcelain", 0.52)
    soften("Moon lavender", 0.48)
    # Fuse the ears into the head. Separate overlapping ink shells left a
    # serrated seam at the roots even though the small export looked fine.
    head = bpy.data.objects["Wide kitten head"]
    ears = [obj for obj in base.MODEL if obj.name.startswith("Rounded kitten ear") and "ink silhouette" not in obj.name]
    bpy.context.view_layer.objects.active = head
    head.select_set(True)
    for ear in ears:
        union = head.modifiers.new("Continuous ear root", "BOOLEAN")
        union.operation, union.solver, union.object = "UNION", "EXACT", ear
        bpy.ops.object.modifier_apply(modifier=union.name)
    removed = [obj for obj in base.MODEL if obj.name.startswith("Rounded kitten ear") or obj.name.startswith("Wide kitten head / ink silhouette")]
    for obj in removed:
        base.MODEL.remove(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    remesh = head.modifiers.new("Continuous sculpted head", "REMESH")
    remesh.mode, remesh.voxel_size, remesh.use_smooth_shade = "VOXEL", 0.025, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = head.modifiers.new("Polished ear transition", "SMOOTH")
    smooth.factor, smooth.iterations = 0.6, 3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    base.MODEL.remove(head)
    head.data.materials.clear()
    base.finish(head, "Wide kitten head", base.CREAM, True)
    tail = bpy.data.objects["Curled lavender tail"]
    positions = [(0.35, 0.23, 0.53), (0.82, 0.23, 0.54), (1.0, 0.20, 0.89), (0.89, 0.13, 1.14)]
    for point, position, radius in zip(tail.data.splines[0].bezier_points, positions, (1.12, 1.0, 0.92, 0.76)):
        point.co, point.radius = position, radius
    tip = bpy.data.objects["Rounded tail tip"]
    tip.location, tip.scale = positions[-1], (0.76, 0.76, 0.76)
    for sign in (-1, 1):
        for z, end_z in ((1.29, 1.34), (1.21, 1.19)):
            base.tube("Fine kitten whisker", [(sign * 0.43, -0.405, z), (sign * 0.53, -0.37, z), (sign * 0.61, -0.31, end_z)], 0.009, base.INK)
    bpy.context.scene["refinement"] = "DP-184 / softer ears and coat, tapered curl, whiskers; idle only"


def ufo():
    base.ufo()
    soften("Persimmon coral", 0.46)
    soften("Glacier mint", 0.42)
    soften("Blue milk glass", 0.32)
    # Separate the two overlapping ring profiles: the seam no longer fights
    # the mint bumper. The saucer keeps its original silhouette and palette.
    belt = bpy.data.objects["Ink belt"]
    belt.location.z = 0.94
    belt.data.materials.clear()
    belt.data.materials.append(base.NAVY)
    # The first portholes were hidden by the bumper. Reposition the same four
    # objects onto the exposed front shell rather than adding more decoration.
    portholes = sorted([obj for obj in base.MODEL if obj.name.startswith("Amber living porthole")], key=lambda obj: obj.name)
    for obj, x in zip(portholes, (-0.57, -0.20, 0.20, 0.57)):
        obj.location = (x, -0.72 * (1 - (x / 0.98) ** 2) ** 0.5, 0.93)
        obj.scale = (0.95, 1.0, 0.9)
    for obj in base.MODEL:
        if obj.name.startswith("Soft landing pad"):
            obj.scale.z *= 1.16
    bpy.context.scene["refinement"] = "DP-184 / satin shell, separated belt, visible portholes, soft pads; idle only"


def fit_selected(scene):
    base.fit_visible_silhouette(scene)
    # Fill more of the 60px control without changing the control itself.
    # The 8/4px transparent margin is still checked against rendered pixels.
    scene.camera.data.ortho_scale *= 0.74 / 0.84
    bpy.context.view_layer.update()


if __name__ == "__main__":
    sys.argv = sys.argv[:sys.argv.index("--")] if "--" in sys.argv else sys.argv
    sys.argv += ["--", "moon_cat", "orbit_ufo"]
    base.main(builders={"moon_cat": cat, "orbit_ufo": ufo}, fit=fit_selected)
    path = ROOT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf8"))
    manifest["latestTask"] = "DP-184"
    manifest["conceptBaseline"] = "f51dd605bafd502fbf8ec2c8a5a5d589ea70b9e7"
    manifest["selectedForRefinement"] = ["moon_cat", "orbit_ufo"]
    for item in manifest["concepts"]:
        item["revision"] = "DP-184" if item["id"] in manifest["selectedForRefinement"] else "DP-183"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

"""DP-185 geometry/material acceptance, run by Blender against the real sources.

These checks cover agreed measurable changes, not subjective cuteness. The
reverse control substitutes the actual DP-184 sources, then restores exact bytes.
"""
import io
import subprocess
import sys
import unittest
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parent
BASELINE = "0cd76deeb96a28fac3e0206364bcd03ec78fec4c"


def open_source(kind):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / "source" / f"{kind}.blend"))


def parts(prefix):
    return [obj for obj in bpy.context.scene.objects if obj.name.startswith(prefix) and "ink silhouette" not in obj.name]


def bounds(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    # Curve bounds can conservatively include their origin; inspect the actual
    # evaluated vertices so a smile is not mistaken for a dangling leg.
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()
    return [min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]


def extent(obj, axis):
    low, high = bounds(obj)
    return high[axis] - low[axis]


class FriendlySources(unittest.TestCase):
    def test_cat_eyes_are_smaller_and_muzzle_is_shallow(self):
        open_source("moon_cat")
        head = bpy.data.objects["Wide kitten head"]
        eyes, muzzle = parts("Obsidian eye"), parts("Cream muzzle")
        self.assertEqual(len(eyes), 2)
        self.assertLessEqual(max(extent(eye, 2) for eye in eyes) / extent(head, 2), 0.16)
        self.assertLessEqual(len(parts("Large eye catchlight")) + len(parts("Small eye catchlight")), 2)
        self.assertEqual(len(muzzle), 2)
        self.assertLessEqual(max(extent(part, 1) for part in muzzle) / extent(head, 1), 0.05)

    def test_cat_supports_are_short_and_grounded(self):
        open_source("moon_cat")
        body = bpy.data.objects["Pear body"]
        paws = parts("Side paw")
        self.assertEqual(len(paws), 2)
        self.assertLessEqual(max(extent(paw, 2) for paw in paws) / extent(body, 2), 0.4)
        # Forepaws support a sitting cat instead of dangling beside the torso.
        ground = bounds(body)[0][2]
        self.assertLessEqual(max(bounds(paw)[0][2] for paw in paws) - ground, 0.12)

    def test_ufo_has_no_geometry_hanging_below_its_underbelly(self):
        open_source("orbit_ufo")
        belly = bpy.data.objects["Cream underbelly"]
        floor = bounds(belly)[0][2] - 0.05  # Allow only the ink shell thickness.
        dangling = [obj.name for obj in bpy.context.scene.objects if obj.type in {"MESH", "CURVE"} and not obj.hide_render and bounds(obj)[0][2] < floor]
        self.assertEqual(dangling, [], "hovering body must have no legs, shoes or replacement hanging parts")

    def test_selected_materials_reduce_gloss(self):
        for kind, names in [("moon_cat", ("Warm porcelain", "Moon lavender", "Obsidian eyes")), ("orbit_ufo", ("Persimmon coral", "Glacier mint", "Blue milk glass", "Obsidian eyes"))]:
            open_source(kind)
            for name in names:
                with self.subTest(kind=kind, material=name):
                    shader = bpy.data.materials[name].node_tree.nodes.get("Principled BSDF")
                    self.assertGreaterEqual(shader.inputs["Roughness"].default_value, 0.65)
                    self.assertLessEqual(shader.inputs["Coat Weight"].default_value, 0.02)
                    self.assertLessEqual(shader.inputs["Specular IOR Level"].default_value, 0.25)


if __name__ == "__main__":
    reverse = "--reverse-control" in sys.argv
    if reverse:
        paths = [ROOT / f"source/{kind}.blend" for kind in ("moon_cat", "orbit_ufo")]
        originals = {path: path.read_bytes() for path in paths}
        try:
            for path in paths:
                path.write_bytes(subprocess.run(["git", "show", f"{BASELINE}:{path.relative_to(ROOT.parents[2]).as_posix()}"], cwd=ROOT.parents[2], capture_output=True, check=True).stdout)
            result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(FriendlySources))
            failed = {test.id().split(".")[-1] for test, _ in result.failures}
            # Subtests report a trailing parameter suffix, so compare test ids
            # without parameters for material cases.
            self_tests = {name for name in dir(FriendlySources) if name.startswith("test_")}
            assert not result.errors and all(any(item.startswith(name) for item in failed) for name in self_tests), "every acceptance group must reject the old sources"
            print("REVERSE CONTROL: all four DP-184 acceptance groups fail")
        finally:
            for path, data in originals.items():
                path.write_bytes(data)
        assert all(path.read_bytes() == data for path, data in originals.items())
        print("RESTORED: exact source bytes")
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(FriendlySources))
    if not result.wasSuccessful():
        raise AssertionError("DP-185 source acceptance failed")

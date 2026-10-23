"""DP-185: owner-approved softer seated cat and legless hovering UFO, idle only.

Keeps the prior generators as historical stages; reuses their editable geometry,
palette, ink shells, export and alpha framing. Run this stage last for the latest.
"""
import bpy
import json
from mathutils import Vector
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import create_concepts as base
import refine_selected as previous


def remove_parts(prefixes):
    for obj in list(base.MODEL):
        if any(obj.name.startswith(prefix) for prefix in prefixes):
            base.MODEL.remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)


def matte_materials():
    # The palette stays identical; only surface response changes.
    bpy.context.scene["status"] = "DP-185 adjusted idle / pending owner appearance approval / not production assets"
    for mat in base.MATERIALS.values():
        shader = mat.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Roughness"].default_value = 0.78
        shader.inputs["Coat Weight"].default_value = 0.0
        shader.inputs["Specular IOR Level"].default_value = 0.20
        shader.inputs["Metallic"].default_value = 0.0


def surface_y(surface, x, z):
    """Attach facial strokes to the real curved surface, not one flat plane."""
    inverse = surface.matrix_world.inverted()
    origin = inverse @ Vector((x, -4, z))
    direction = (inverse.to_3x3() @ Vector((0, 1, 0))).normalized()
    hit, point, _, _ = surface.ray_cast(origin, direction)
    if not hit:
        raise ValueError(f"facial point misses {surface.name}: {x}, {z}")
    return (surface.matrix_world @ point).y


def face_patch(surface, name, x, z, rx, rz, mat, depth=0.008):
    # A shallow surface-conforming patch avoids stuck-on muzzle and eye beads.
    import math
    bpy.context.view_layer.update()
    center_y = surface_y(surface, x, z) - depth
    vertices = [(x, center_y, z)]
    rings, segments = 8, 48
    for ring in range(1, rings + 1):
        for index in range(segments):
            angle = math.tau * index / segments
            px, pz = x + rx * ring / rings * math.cos(angle), z + rz * ring / rings * math.sin(angle)
            vertices.append((px, surface_y(surface, px, pz) - depth, pz))
    faces = [(0, i + 1, (i + 1) % segments + 1) for i in range(segments)]
    for ring in range(1, rings):
        inner, outer = (ring - 1) * segments + 1, ring * segments + 1
        faces += [(inner + i, outer + i, outer + (i + 1) % segments, inner + (i + 1) % segments) for i in range(segments)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return base.finish(obj, name, mat)


def face_stroke(surface, name, xz, radius=0.010):
    return base.tube(name, [(x, surface_y(surface, x, z) - 0.012, z) for x, z in xz], radius, base.INK)


def quiet_eyes(surface, x, z, radius):
    for sign in (-1, 1):
        face_patch(surface, "Obsidian eye", sign * x, z, radius, radius * 1.12, base.OBSIDIAN)
        face_patch(surface, "Large eye catchlight", sign * x - 0.014, z + 0.021, 0.011, 0.011, base.WHITE, 0.011)


def cat():
    previous.cat()
    matte_materials()
    remove_parts(("Pear body", "Velvet bib", "Bean foot", "Side paw", "Toe seam", "Obsidian eye", "Large eye catchlight", "Small eye catchlight", "Rose cheek", "Cream muzzle", "Tiny nose", "Small curved smile", "Fine kitten whisker", "Midnight collar", "North star collar charm"))
    # Broad seated haunches, with two short forelegs grounded in front. No
    # hanging human-like arms or broad shoe-like feet alongside the torso.
    body = base.ellipsoid("Pear body", (0, 0.07, 0.65), (0.47, 0.40, 0.56), base.CREAM)
    haunches = [base.ellipsoid("Seated haunch", (sign * 0.30, 0.04, 0.37), (0.27, 0.34, 0.27), base.CREAM) for sign in (-1, 1)]
    bpy.context.view_layer.objects.active = body
    for haunch in haunches:
        union = body.modifiers.new("Seated continuous body", "BOOLEAN")
        union.operation, union.solver, union.object = "UNION", "EXACT", haunch
        bpy.ops.object.modifier_apply(modifier=union.name)
    remove_parts(("Seated haunch",))
    remesh = body.modifiers.new("Soft seated silhouette", "REMESH")
    remesh.mode, remesh.voxel_size, remesh.use_smooth_shade = "VOXEL", 0.022, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = body.modifiers.new("Soft haunch transition", "SMOOTH")
    smooth.factor, smooth.iterations = 0.6, 3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    base.MODEL.remove(body)
    body.data.materials.clear()
    base.finish(body, "Pear body", base.CREAM, True)
    face_patch(body, "Velvet bib", 0, 0.69, 0.25, 0.24, base.WHITE, 0.005)
    for sign in (-1, 1):
        paw = base.ellipsoid("Side paw", (sign * 0.175, -0.27, 0.355), (0.12, 0.18, 0.16), base.CREAM)
        foot = base.ellipsoid("Bean foot", (sign * 0.175, -0.335, 0.20), (0.135, 0.20, 0.105), base.CREAM)
        bpy.context.view_layer.objects.active = paw
        union = paw.modifiers.new("Continuous forepaw", "BOOLEAN")
        union.operation, union.solver, union.object = "UNION", "EXACT", foot
        bpy.ops.object.modifier_apply(modifier=union.name)
        base.MODEL.remove(foot)
        bpy.data.objects.remove(foot, do_unlink=True)
        remesh = paw.modifiers.new("Soft forepaw transition", "REMESH")
        remesh.mode, remesh.voxel_size, remesh.use_smooth_shade = "VOXEL", 0.014, True
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth = paw.modifiers.new("Polished forepaw", "SMOOTH")
        smooth.factor, smooth.iterations = 0.6, 3
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        for dx in (-0.035, 0.035):
            base.tube("Toe seam", [(sign * 0.175 + dx, -0.524, 0.19), (sign * 0.175 + dx, -0.530, 0.23)], 0.006, base.LILAC)
    # Details lie on the remeshed head instead of protruding separate balls.
    head = bpy.data.objects["Wide kitten head"]
    quiet_eyes(head, 0.233, 1.46, 0.064)
    for sign in (-1, 1):
        face_patch(head, "Rose cheek", sign * 0.38, 1.31, 0.066, 0.027, base.BLUSH, 0.006)
        face_patch(head, "Cream muzzle", sign * 0.060, 1.29, 0.081, 0.049, base.WHITE, 0.005)
        for z, end in ((1.30, 1.325), (1.255, 1.24)):
            face_stroke(head, "Fine kitten whisker", [(sign * 0.34, z), (sign * 0.42, z), (sign * 0.48, end)], 0.006)
    face_patch(head, "Tiny nose", 0, 1.338, 0.031, 0.019, base.ROSE, 0.010)
    face_stroke(head, "Small curved smile", [(-0.061, 1.282), (-0.035, 1.268), (0, 1.293), (0.035, 1.268), (0.061, 1.282)], 0.008)
    # Keep the collar and star identity, with a thinner, quieter profile.
    base.torus("Midnight collar", (0, 0, 1.015), 0.34, 0.031, base.NAVY, scale=(1, 0.91, 1))
    base.star("North star collar charm", (0.02, -0.358, 0.97), 0.081, base.GOLD)
    bpy.context.scene["refinement"] = "DP-185 / surface-conforming quiet face, grounded short forelegs, seated haunches, matte palette; idle only"


def ufo():
    previous.ufo()
    matte_materials()
    remove_parts(("Organic landing tendril", "Soft landing pad", "Obsidian eye", "Large eye catchlight", "Small eye catchlight", "Coral cheek", "Small curved smile", "Cockpit reflected streak"))
    belt = bpy.data.objects["Ink belt"]
    belt.scale.y = 0.86  # Sit outside the coral surface instead of intersecting it.
    for port in base.MODEL:
        if port.name.startswith("Amber living porthole"):
            x = port.location.x
            port.location.y = -0.77 * (1 - x * x) ** 0.5
    head = bpy.data.objects["Soft blue cockpit creature"]
    quiet_eyes(head, 0.185, 1.43, 0.061)
    for sign in (-1, 1):
        face_patch(head, "Coral cheek", sign * 0.30, 1.33, 0.055, 0.022, base.BLUSH, 0.006)
    face_stroke(head, "Small curved smile", [(-0.052, 1.33), (0, 1.311), (0.052, 1.33)], 0.009)
    # A smooth hovering underbelly has no leg replacements, beam, floor or
    # baked shadow. Floating is a pose here, not a claim of animated behavior.
    bpy.context.scene["refinement"] = "DP-185 / legless hovering creature, surface-conforming quiet face, matte palette; idle only"


if __name__ == "__main__":
    sys.argv = sys.argv[:sys.argv.index("--")] if "--" in sys.argv else sys.argv
    sys.argv += ["--", "moon_cat", "orbit_ufo"]
    base.main(builders={"moon_cat": cat, "orbit_ufo": ufo}, fit=previous.fit_selected)
    path = ROOT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf8"))
    manifest.update(latestTask="DP-185", conceptBaseline="f51dd605bafd502fbf8ec2c8a5a5d589ea70b9e7", appearanceBaseline="0cd76deeb96a28fac3e0206364bcd03ec78fec4c", selectedForRefinement=["moon_cat", "orbit_ufo"], appearanceApprovalPending=True)
    for item in manifest["concepts"]:
        item["revision"] = "DP-185" if item["id"] in manifest["selectedForRefinement"] else "DP-183"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

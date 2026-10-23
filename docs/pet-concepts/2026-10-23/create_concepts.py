"""DP-183: original, editable Blender concepts; no imported meshes or textures.

Run: blender --background --factory-startup --python create_concepts.py
Outputs live beside this script, outside the production App asset graph.
"""
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
import math
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from check_assets import rgba_png, validate_sprite

MATERIALS = {}
MODEL = []


def material(name, color, roughness=0.38, metallic=0.0, emission=0.0):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Coat Weight"].default_value = 0.16
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    MATERIALS[name] = mat
    return mat


def finish(obj, name, mat, outline=False):
    obj.name = name
    obj.data.materials.append(mat)
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    MODEL.append(obj)
    if outline and obj.type == "MESH":
        import bmesh
        shell = obj.copy()
        shell.data = obj.data.copy()
        shell.name = name + " / ink silhouette"
        bpy.context.collection.objects.link(shell)
        shell.data.materials.clear()
        shell.data.materials.append(INK)
        shell.visible_shadow = False
        bm = bmesh.new()
        bm.from_mesh(shell.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for vertex in bm.verts:
            vertex.co += vertex.normal * 0.018
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(shell.data)
        bm.free()
        MODEL.append(shell)
    return obj


def ellipsoid(name, at, scale, mat, outline=False, rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, location=at)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, name, mat, outline)


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 24
    curve.bevel_depth = radius
    curve.bevel_resolution = 5
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, position in zip(spline.bezier_points, points):
        point.co = position
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def torus(name, at, major, minor, mat, rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=16, location=at, major_radius=major, minor_radius=minor, rotation=rotation)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat)


def rounded_box(name, at, scale, mat, radius=0.15):
    bpy.ops.mesh.primitive_cube_add(size=2, location=at)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Soft manufactured edges", "BEVEL")
    bevel.width, bevel.segments = radius, 6
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat)


def star(name, at, radius, mat, points=5):
    vertices = []
    for y in (-0.035, 0.035):
        for i in range(points * 2):
            angle = math.pi / 2 + i * math.pi / points
            r = radius if i % 2 == 0 else radius * 0.48
            vertices.append((at[0] + math.cos(angle) * r, at[1] + y, at[2] + math.sin(angle) * r))
    n = points * 2
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bevel = obj.modifiers.new("Candy edges", "BEVEL")
    bevel.width, bevel.segments = 0.025, 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat)


def eye(x, y, z, radius=0.10):
    ellipsoid("Obsidian eye", (x, y, z), (radius, 0.043, radius * 1.3), OBSIDIAN)
    ellipsoid("Large eye catchlight", (x - radius * 0.23, y - 0.042, z + radius * 0.37), (radius * 0.27, 0.012, radius * 0.27), WHITE)
    ellipsoid("Small eye catchlight", (x + radius * 0.28, y - 0.043, z - radius * 0.28), (radius * 0.12, 0.009, radius * 0.12), WHITE)


def smile(y, z, width=0.13):
    tube("Small curved smile", [(-width, y, z), (0, y - 0.009, z - 0.055), (width, y, z)], 0.018, INK)


def cat():
    ellipsoid("Pear body", (0, 0.02, 0.77), (0.48, 0.38, 0.58), CREAM, True)
    ellipsoid("Velvet bib", (0, -0.329, 0.72), (0.28, 0.06, 0.32), WHITE)
    tube("Curled lavender tail", [(0.35, 0.23, 0.53), (0.82, 0.28, 0.55), (0.93, 0.21, 0.96), (0.78, 0.1, 1.08)], 0.12, LILAC)
    ellipsoid("Rounded tail tip", (0.78, 0.1, 1.08), (0.12, 0.12, 0.12), LILAC)
    for sign in (-1, 1):
        ellipsoid("Bean foot", (sign * 0.27, -0.14, 0.22), (0.24, 0.31, 0.17), CREAM, True)
        ellipsoid("Side paw", (sign * 0.45, -0.09, 0.74), (0.16, 0.23, 0.29), CREAM, True, (0, sign * -0.25, 0))
        for dx in (-0.045, 0.045):
            tube("Toe seam", [(sign * 0.27 + dx, -0.431, 0.20), (sign * 0.27 + dx, -0.445, 0.25)], 0.008, LILAC)
    ellipsoid("Wide kitten head", (0, -0.03, 1.43), (0.64, 0.43, 0.52), CREAM, True)
    for sign in (-1, 1):
        # Soft tapered ear loft, distinct from an unmodified cone.
        rings = [(1.68, 0.23, 0.15), (1.92, 0.18, 0.12), (2.16, 0.045, 0.04)]
        vertices = []
        for z, rx, ry in rings:
            vertices += [(sign * (0.38 + (z - 1.68) * 0.1) + math.cos(i * math.tau / 24) * rx, -0.015 + math.sin(i * math.tau / 24) * ry, z) for i in range(24)]
        faces = [(j * 24 + i, j * 24 + (i + 1) % 24, (j + 1) * 24 + (i + 1) % 24, (j + 1) * 24 + i) for j in range(2) for i in range(24)]
        faces += [tuple(reversed(range(24))), tuple(range(48, 72))]
        mesh = bpy.data.meshes.new("Rounded kitten ear")
        mesh.from_pydata(vertices, [], faces)
        obj = bpy.data.objects.new("Rounded kitten ear", mesh)
        bpy.context.collection.objects.link(obj)
        finish(obj, "Rounded kitten ear", CREAM, True)
        ellipsoid("Lilac ear velvet", (sign * 0.405, -0.136, 1.92), (0.10, 0.028, 0.17), LILAC, rotation=(0, sign * 0.15, 0))
        eye(sign * 0.235, -0.433, 1.47, 0.105)
        ellipsoid("Rose cheek", (sign * 0.39, -0.405, 1.27), (0.10, 0.025, 0.055), BLUSH)
        ellipsoid("Cream muzzle", (sign * 0.087, -0.447, 1.27), (0.115, 0.047, 0.078), WHITE)
    ellipsoid("Tiny nose", (0, -0.508, 1.32), (0.051, 0.025, 0.033), ROSE)
    smile(-0.495, 1.245, 0.07)
    torus("Midnight collar", (0, 0, 1.02), 0.355, 0.05, NAVY, scale=(1, 0.91, 1))
    star("North star collar charm", (0.08, -0.382, 0.98), 0.115, GOLD)
    tube("Forehead crescent", [(-0.07, -0.417, 1.77), (-0.10, -0.435, 1.68), (-0.01, -0.454, 1.64), (0.055, -0.429, 1.70)], 0.025, LILAC)


def ufo():
    ellipsoid("Living saucer shell", (0, 0, 0.98), (0.98, 0.71, 0.28), CORAL, True)
    ellipsoid("Cream underbelly", (0, 0.02, 0.82), (0.80, 0.58, 0.20), CREAM, True)
    torus("Ink belt", (0, 0, 1.0), 0.84, 0.055, INK, scale=(1.12, 0.79, 1))
    torus("Mint bumper ring", (0, 0, 1.055), 0.84, 0.075, MINT, scale=(1.12, 0.79, 1))
    ellipsoid("Soft blue cockpit creature", (0, 0.01, 1.37), (0.54, 0.46, 0.48), SKY, True)
    torus("Cockpit seal", (0, 0, 1.16), 0.49, 0.045, CREAM, scale=(1, 0.84, 1))
    for sign in (-1, 1):
        eye(sign * 0.19, -0.415, 1.43, 0.09)
        ellipsoid("Coral cheek", (sign * 0.33, -0.382, 1.28), (0.075, 0.022, 0.043), BLUSH)
        tube("Organic landing tendril", [(sign * 0.42, -0.22, 0.8), (sign * 0.57, -0.31, 0.55), (sign * 0.44, -0.4, 0.3)], 0.085, CORAL)
        ellipsoid("Soft landing pad", (sign * 0.43, -0.39, 0.24), (0.19, 0.2, 0.09), NAVY, True)
        ellipsoid("Swept side fin", (sign * 0.96, 0.08, 1.03), (0.24, 0.28, 0.09), CORAL, True, (0, sign * -0.3, 0))
    smile(-0.461, 1.28, 0.09)
    for angle in (-2.55, -1.95, -1.2, -0.6):
        at = (math.cos(angle) * 0.77, math.sin(angle) * 0.57, 0.99)
        ellipsoid("Amber living porthole", at, (0.062, 0.037, 0.055), GOLD)
    tube("Flexible feeler", [(0, 0.05, 1.77), (0.08, 0.03, 1.97), (0.19, 0, 2.03)], 0.028, INK)
    star("Antenna star", (0.2, 0, 2.08), 0.13, GOLD)
    tube("Cockpit reflected streak", [(-0.34, -0.25, 1.68), (-0.3, -0.31, 1.73), (-0.21, -0.34, 1.76)], 0.025, WHITE)


def teapot():
    for sign in (-1, 1):
        ellipsoid("Cloud foot", (sign * 0.30, -0.08, 0.21), (0.22, 0.24, 0.13), LILAC, True)
    ellipsoid("Porcelain cloud pot", (0, 0.02, 0.85), (0.61, 0.47, 0.56), LILAC, True)
    for x, z, scale in [(-0.37, 1.03, 0.30), (0, 1.17, 0.33), (0.37, 1.04, 0.29)]:
        ellipsoid("Sculpted cloud scallop", (x, -0.10, z), (scale, 0.35, scale), CLOUD, True)
    torus("Porcelain loop handle", (0.62, 0.06, 0.96), 0.31, 0.10, LILAC, rotation=(math.pi / 2, 0, 0), scale=(1, 1.18, 1))
    tube("Upturned pouring spout", [(-0.47, 0.02, 0.78), (-0.81, -0.01, 0.93), (-0.92, -0.01, 1.23)], 0.145, LILAC)
    torus("Spout gold lip", (-0.92, -0.01, 1.25), 0.13, 0.026, GOLD)
    ellipsoid("Spout opening", (-0.92, -0.01, 1.253), (0.10, 0.10, 0.02), NAVY)
    ellipsoid("Saucer lid", (0, 0.02, 1.35), (0.40, 0.34, 0.085), CREAM, True)
    ellipsoid("Lid berry", (0, 0.02, 1.46), (0.10, 0.10, 0.10), GOLD)
    for sign in (-1, 1):
        eye(sign * 0.19, -0.458, 0.91, 0.085)
        ellipsoid("Cloud blush", (sign * 0.34, -0.419, 0.76), (0.08, 0.027, 0.04), BLUSH)
    smile(-0.476, 0.76, 0.075)
    tube("Gold porcelain seam", [(-0.42, -0.32, 0.61), (0, -0.435, 0.52), (0.42, -0.32, 0.61)], 0.017, GOLD)
    for at, scale in [((0.02, 0.02, 1.71), (0.16, 0.14, 0.12)), ((0.13, 0.03, 1.81), (0.14, 0.12, 0.14)), ((-0.06, 0.04, 1.84), (0.14, 0.12, 0.13))]:
        ellipsoid("Puffy steam", at, scale, CLOUD, True)
    star("Brewed little star", (-0.19, -0.01, 2.08), 0.13, GOLD)
    star("Brewed tiny star", (0.26, 0.06, 2.04), 0.07, GOLD)


def rover():
    for sign in (-1, 1):
        torus("Soft tread wheel", (sign * 0.53, 0.02, 0.34), 0.20, 0.10, NAVY, rotation=(0, math.pi / 2, 0))
        ellipsoid("Mint wheel hub", (sign * 0.62, 0.02, 0.34), (0.025, 0.14, 0.14), MINT)
        ellipsoid("Golden hub bolt", (sign * 0.65, 0.02, 0.34), (0.026, 0.055, 0.055), GOLD)
    rounded_box("Ivory planter chassis", (0, 0, 0.76), (0.59, 0.40, 0.40), CREAM, 0.21)
    rounded_box("Midnight glass face", (0, -0.394, 0.82), (0.42, 0.045, 0.22), NAVY, 0.13)
    for sign in (-1, 1):
        ellipsoid("Luminous friendly eye", (sign * 0.18, -0.451, 0.86), (0.07, 0.015, 0.095), MINT_GLOW)
        tube("Flexible little arm", [(sign * 0.55, 0, 0.85), (sign * 0.78, -0.04, 0.79), (sign * 0.82, -0.12, 0.98)], 0.045, NAVY)
        ellipsoid("Little mitten", (sign * 0.83, -0.12, 1.02), (0.10, 0.09, 0.12), CORAL, True)
    tube("Screen smile", [(-0.06, -0.451, 0.73), (0, -0.461, 0.70), (0.06, -0.451, 0.73)], 0.013, MINT_GLOW)
    torus("Planter mint collar", (0, 0.02, 1.18), 0.39, 0.07, MINT, scale=(1.1, 0.85, 1))
    ellipsoid("Rich soil", (0, 0.02, 1.185), (0.39, 0.29, 0.035), SOIL)
    tube("Growing stem", [(0, 0.03, 1.19), (-0.04, 0.02, 1.40), (0.04, 0.03, 1.73)], 0.038, LEAF)
    for sign, z, tilt in [(-1, 1.48, -0.55), (1, 1.72, 0.62)]:
        leaf = ellipsoid("Velvet seed leaf", (sign * 0.22, 0.02, z), (0.30, 0.085, 0.145), LEAF, True, (0, -tilt, 0))
        tube("Leaf midrib", [(0, -0.048, z - 0.08), (sign * 0.24, -0.072, z + 0.01), (sign * 0.43, -0.015, z + 0.13)], 0.012, MINT)
    ellipsoid("Dew pearl", (-0.30, -0.07, 1.60), (0.042, 0.042, 0.055), WHITE)
    star("Tiny chassis badge", (0.37, -0.411, 0.51), 0.08, GOLD)
    rounded_box("Coral battery pack", (0, 0.39, 0.77), (0.35, 0.10, 0.24), CORAL, 0.08)


def light(name, at, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    MATERIALS.clear()
    MODEL.clear()
    bpy.data.orphans_purge(do_recursive=True)
    global INK, CREAM, WHITE, LILAC, BLUSH, ROSE, NAVY, GOLD, OBSIDIAN, CORAL, MINT, SKY, CLOUD, LEAF, SOIL, MINT_GLOW
    INK = material("Comic ink / deep blue", (0.025, 0.032, 0.065), 0.8)
    INK.use_backface_culling = True
    INK.use_backface_culling_shadow = True
    CREAM = material("Warm porcelain", (0.92, 0.78, 0.57), 0.42)
    WHITE = material("Cream highlight", (1.0, 0.95, 0.84), 0.27)
    LILAC = material("Moon lavender", (0.45, 0.31, 0.65), 0.38)
    BLUSH = material("Soft blush", (0.94, 0.32, 0.36), 0.55)
    ROSE = material("Petal nose", (0.63, 0.16, 0.23), 0.30)
    NAVY = material("Midnight enamel", (0.035, 0.075, 0.15), 0.30)
    GOLD = material("Honey brass", (0.98, 0.57, 0.12), 0.28, 0.35)
    OBSIDIAN = material("Obsidian eyes", (0.011, 0.016, 0.035), 0.12)
    CORAL = material("Persimmon coral", (0.90, 0.24, 0.17), 0.34)
    MINT = material("Glacier mint", (0.22, 0.73, 0.61), 0.32)
    SKY = material("Blue milk glass", (0.30, 0.64, 0.77), 0.23)
    CLOUD = material("Cloud ceramic", (0.81, 0.83, 0.98), 0.44)
    LEAF = material("Jade living leaf", (0.17, 0.52, 0.28), 0.41)
    SOIL = material("Cocoa soil", (0.08, 0.045, 0.035), 0.85)
    MINT_GLOW = material("Mint screen light", (0.28, 0.97, 0.72), 0.25, emission=0.6)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 80
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.world.color = (0.3, 0.3, 0.3)
    light("Key / large softbox", (-3, -4, 6), 500, 4, (1.0, 0.88, 0.76))
    light("Fill / cool bounce", (4, -1, 3), 350, 3, (0.70, 0.85, 1.0))
    light("Rim / silhouette separation", (1, 3, 4), 600, 3, (0.85, 0.88, 1.0))
    return scene


def frame_camera(scene):
    data = bpy.data.cameras.new("Orthographic portrait")
    camera = bpy.data.objects.new("Orthographic portrait", data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    data.type, data.ortho_scale = "ORTHO", 3.3
    camera.location = (3.3, -8, 3.5)
    target = Vector((0, 0, 1.1))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = 512
    bpy.context.view_layer.update()
    # Project evaluated bounds. Fix framing once, then use it at every export size.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners = [obj.matrix_world @ Vector(corner) for obj in MODEL for corner in obj.evaluated_get(depsgraph).bound_box]
    projection = [world_to_camera_view(scene, camera, point) for point in corners]
    xs, ys = [p.x for p in projection], [p.y for p in projection]
    center_x, center_y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    local_shift = camera.rotation_euler.to_matrix() @ Vector(((center_x - 0.5) * data.ortho_scale, (center_y - 0.5) * data.ortho_scale, 0))
    camera.location += local_shift
    data.ortho_scale *= max(max(xs) - min(xs), max(ys) - min(ys)) / 0.74
    bpy.context.view_layer.update()
    return camera


def fit_visible_silhouette(scene):
    """Bounds of curved geometry are conservative; fit its actual rendered alpha."""
    scene.render.resolution_x = scene.render.resolution_y = 256
    path = ROOT / "renders" / "framing.tmp.png"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    width, height, rows = rgba_png(path)
    points = [(x, y) for y, row in enumerate(rows) for x in range(width) if row[x * 4 + 3] > 0]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    center_x, center_y = (min(xs) + max(xs) + 1) / 2 / width, 1 - (min(ys) + max(ys) + 1) / 2 / height
    camera = scene.camera
    shift = camera.rotation_euler.to_matrix() @ Vector(((center_x - 0.5) * camera.data.ortho_scale, (center_y - 0.5) * camera.data.ortho_scale, 0))
    camera.location += shift
    camera.data.ortho_scale *= max((max(xs) - min(xs) + 1) / width, (max(ys) - min(ys) + 1) / height) / 0.74
    bpy.context.view_layer.update()
    path.unlink()


def main():
    (ROOT / "source").mkdir(exist_ok=True)
    (ROOT / "renders").mkdir(exist_ok=True)
    entries = []
    concepts = [("moon_cat", "Moon Cat", cat), ("orbit_ufo", "Orbit UFO", ufo), ("cloud_teapot", "Cloud Teapot", teapot), ("sprout_rover", "Sprout Rover", rover)]
    selected = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else None
    for key, title, builder in concepts:
        if selected and key not in selected:
            continue
        scene = setup_scene()
        builder()
        frame_camera(scene)
        fit_visible_silhouette(scene)
        scene["concept_title"] = title
        scene["status"] = "DP-183 original concept / pending owner visual selection / not production assets"
        scene["construction"] = "Editable meshes, curves and named materials; no third-party models, fonts or textures."
        source = ROOT / "source" / f"{key}.blend"
        scene.render.resolution_x = scene.render.resolution_y = 768
        scene.render.filepath = f"//../renders/{key}-768.png"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        renders, measurements, hashes = {}, {}, {}
        for size in (768, 120, 60):
            path = ROOT / "renders" / f"{key}-{size}.png"
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            renders[str(size)] = path.relative_to(ROOT).as_posix()
            if size in (120, 60):
                measurements[str(size)] = validate_sprite(path, size)
            hashes[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        hashes[source.relative_to(ROOT).as_posix()] = hashlib.sha256(source.read_bytes()).hexdigest()
        entries.append({"id": key, "title": title, "source": source.relative_to(ROOT).as_posix(), "renders": renders, "measurements": measurements, "sha256": hashes})
    manifest = {"task": "DP-183", "productionReady": False, "blender": bpy.app.version_string, "blenderZipSha256": "723f08a4401502561eb763cdeacf8745b31e5f3f154d287d3830d97cf75dc2fb", "concepts": entries}
    if selected and (ROOT / "manifest.json").exists():
        previous = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
        manifest["concepts"] += [item for item in previous["concepts"] if item["id"] not in selected]
    order = [item[0] for item in concepts]
    manifest["concepts"].sort(key=lambda item: order.index(item["id"]))
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print("DP-183 CONCEPTS COMPLETE", json.dumps({e["id"]: e["measurements"] for e in entries}))


if __name__ == "__main__":
    main()

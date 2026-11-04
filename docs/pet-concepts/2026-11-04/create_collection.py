"""Original editable Blender companions. No external models, images or textures.

Run with official Blender --background --factory-startup --disable-autoexec
--python-exit-code 1 --python <this file> -- [cat|bear|bunny] [--preview].
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
PALETTES = {
    'cat': ('Marshmallow Cat', (0.68, 0.57, 0.87), (0.93, 0.77, 0.48)),
    'bear': ('Honey Bear', (0.68, 0.34, 0.12), (0.37, 0.64, 0.55)),
    'bunny': ('Peach Bunny', (0.97, 0.72, 0.61), (0.58, 0.69, 0.42)),
}
POSES = [('idle', 12, 180), ('walk', 8, 100), ('look', 10, 160),
         ('sit', 1, 100), ('sleep', 8, 300), ('jump', 10, 100), ('grab', 1, 100)]


def material(name, color, roughness=0.72):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def empty(name, at, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    obj.parent = parent
    return obj


def sphere(name, at, scale, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name, obj.parent, obj.location, obj.scale = name, parent, at, scale
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def tube(name, points, radius, mat, parent):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions, data.bevel_depth, data.bevel_resolution = '3D', radius, 4
    data.use_fill_caps = True
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, position in zip(spline.bezier_points, points):
        point.co, point.handle_left_type, point.handle_right_type = position, 'AUTO', 'AUTO'
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    data.materials.append(mat)
    return obj


def star(name, at, size, mat, parent):
    # A rounded, solid five-point charm, rather than a decal.
    points = []
    for i in range(10):
        a = i * math.pi / 5
        radius = size if i % 2 == 0 else size * 0.48
        points.append((math.sin(a) * radius, 0, math.cos(a) * radius))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], [list(range(10))])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent, obj.location = parent, at
    mesh.materials.append(mat)
    solid = obj.modifiers.new('Charm thickness', 'SOLIDIFY'); solid.thickness = 0.045
    bevel = obj.modifiers.new('Soft charm edges', 'BEVEL'); bevel.width = 0.015; bevel.segments = 3


def cat_ear(at, mat, parent, inner=False):
    size = 0.68 if inner else 1
    vertices = [(x * size, y * size, z * size) for y in [-0.10, 0.10]
                for x, z in [(-0.22, -0.11), (0.20, -0.11), (0.08, 0.43)]]
    mesh = bpy.data.meshes.new('Soft triangular ear')
    mesh.from_pydata(vertices, [], [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new('Inner ear' if inner else 'Triangular cat ear', mesh)
    bpy.context.collection.objects.link(obj); obj.parent, obj.location = parent, at
    bevel = obj.modifiers.new('Rounded ear edges', 'BEVEL'); bevel.width = 0.055; bevel.segments = 5
    for polygon in mesh.polygons: polygon.use_smooth = True


def build(kind):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.context.scene.timeline_markers.clear()
    bpy.data.orphans_purge(do_recursive=True)
    title, color, accent_color = PALETTES[kind]
    coat = material('Soft matte coat', color)
    cream = material('Warm milk muzzle and belly', (1.0, 0.94, 0.80))
    pink = material('Peach inner ears', (0.91, 0.43, 0.43))
    ink = material('Cocoa eyes and smile', (0.045, 0.025, 0.041), 0.42)
    accent = material('Woven scarf', accent_color)
    gold = material('Honey gold', (0.95, 0.57, 0.12), 0.48)
    root = empty('CTRL / whole character', (0, 0, 0))
    body = empty('CTRL / breathing body', (0, 0, 0.77), root)
    sphere('Pear-shaped body', (0, 0.06, 0), (0.45, 0.34, 0.55), coat, body)
    sphere('Belly bib', (0, -0.27, -0.04), (0.30, 0.085, 0.36), cream, body)
    head = empty('CTRL / curious head', (0, -0.035, 1.57), root)
    sphere('Rounded cheek silhouette', (0, 0, 0), (0.62, 0.46, 0.53), coat, head)
    eyes = []
    for side in [-1, 1]:
        x = side * 0.225
        eyes.append(sphere('Eye / ' + str(side), (x, -0.438, 0.045), (0.057, 0.032, 0.071), ink, head))
        sphere('Muzzle / ' + str(side), (side * 0.085, -0.45, -0.15), (0.145, 0.065, 0.105), cream, head)
        sphere('Blush / ' + str(side), (side * 0.36, -0.375, -0.105), (0.074, 0.018, 0.038), pink, head)
        if kind == 'cat':
            cat_ear((side * 0.39, 0, 0.35), coat, head)
            cat_ear((side * 0.39, -0.095, 0.36), pink, head, True)
            tube('Whisker / ' + str(side), [(side * 0.31, -0.42, -0.15), (side * 0.49, -0.38, -0.12)], 0.012, ink, head)
        elif kind == 'bear':
            sphere('Round bear ear', (side * 0.48, 0, 0.38), (0.225, 0.15, 0.23), coat, head)
            sphere('Velvet ear inset', (side * 0.48, -0.125, 0.39), (0.125, 0.035, 0.13), cream, head)
        else:
            ear = empty('CTRL / floppy ear ' + str(side), (side * 0.25, 0, 0.39), head)
            ear.rotation_euler.y = side * -0.18
            sphere('Long bunny ear', (0, 0, 0.30), (0.155, 0.15, 0.46), coat, ear)
            sphere('Velvet bunny ear inset', (0, -0.12, 0.31), (0.077, 0.035, 0.32), pink, ear)
    sphere('Tiny petal nose', (0, -0.522, -0.12), (0.042, 0.027, 0.030), pink if kind != 'bear' else ink, head)
    tube('Gentle smile', [(-0.075, -0.516, -0.20), (0, -0.53, -0.22), (0.075, -0.516, -0.20)], 0.012, ink, head)
    arms, legs = [], []
    for side in [-1, 1]:
        arm = empty('CTRL / arm ' + str(side), (side * 0.40, 0.015, 1.00), root)
        sphere('Round arm', (side * 0.025, 0, -0.17), (0.15, 0.17, 0.30), coat, arm)
        sphere('Paw mitten', (side * 0.025, -0.03, -0.38), (0.145, 0.16, 0.15), cream, arm)
        arms.append(arm)
        leg = empty('CTRL / leg ' + str(side), (side * 0.235, 0.04, 0.40), root)
        sphere('Short leg', (0, 0, -0.08), (0.19, 0.20, 0.24), coat, leg)
        sphere('Soft foot', (0, -0.09, -0.25), (0.20, 0.27, 0.14), cream, leg)
        legs.append(leg)
    tail = empty('CTRL / tail', (0.30, 0.26, 0.50), root)
    if kind == 'cat':
        tube('Curled cat tail', [(0, 0, 0), (0.34, 0.04, 0.02), (0.43, 0.04, 0.40), (0.30, 0.04, 0.55)], 0.095, coat, tail)
    else:
        sphere('Cotton tail', (0, 0.09, 0.08), (0.17, 0.17, 0.18), cream if kind == 'bunny' else coat, tail)
    # Scarf has real depth, a knot, two tails and a distinct little charm.
    sphere('Scarf collar', (0, -0.01, 1.13), (0.40, 0.31, 0.115), accent, root)
    sphere('Scarf knot', (-0.24, -0.27, 1.10), (0.12, 0.08, 0.11), accent, root)
    end = sphere('Scarf end', (-0.21, -0.30, 0.93), (0.10, 0.052, 0.22), accent, root)
    end.rotation_euler.y = -0.25
    if kind == 'cat':
        star('Little moonlight star', (0.09, -0.345, 1.09), 0.09, gold, root)
    elif kind == 'bear':
        sphere('Honey pot satchel', (0.29, -0.25, 0.63), (0.16, 0.12, 0.18), gold, root)
        sphere('Honey pot rim', (0.29, -0.25, 0.79), (0.17, 0.13, 0.045), cream, root)
        tube('Satchel strap', [(-0.27, -0.21, 1.15), (0.02, -0.34, 0.94), (0.30, -0.31, 0.68)], 0.025, accent, root)
    else:
        sphere('Carrot charm', (0.12, -0.34, 1.06), (0.045, 0.04, 0.095), gold, root)
        for offset in [-0.035, 0.035]:
            leaf = sphere('Carrot leaf', (0.12 + offset, -0.34, 1.16), (0.022, 0.027, 0.055), accent, root)
            leaf.rotation_euler.y = offset * 10
    controls = [root, body, head, *arms, *legs, tail, *eyes]
    rest = {obj: (obj.location.copy(), obj.rotation_euler.copy(), obj.scale.copy()) for obj in controls}
    return controls, rest, root, body, head, arms, legs, tail, eyes


def setup_scene(kind):
    rig = build(kind)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 64
    scene.render.film_transparent = True
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = 'PNG', 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.world.color = (0.3, 0.3, 0.3)
    for name, at, power, size, color in [
        ('Warm key', (-3, -4, 6), 550, 4, (1, 0.87, 0.75)),
        ('Cool fill', (4, -2, 3), 320, 3, (0.80, 0.90, 1)),
        ('Soft rim', (1, 3, 5), 650, 3, (1, 0.90, 0.80)),
    ]:
        data = bpy.data.lights.new(name, 'AREA'); data.energy, data.shape, data.size, data.color = power, 'DISK', size, color
        obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = at
        obj.rotation_euler = (Vector((0, 0, 1.1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.objects.new('Fixed orthographic camera', bpy.data.cameras.new('Fixed orthographic camera'))
    bpy.context.collection.objects.link(camera)
    camera.location = (2.6, -9, 3.8)
    camera.rotation_euler = (Vector((0, 0, 1.43)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 3.80 if kind == 'bunny' else 3.50
    scene.camera, scene.render.fps = camera, 10
    return scene, rig


def pose(rig, name, phase):
    controls, rest, root, body, head, arms, legs, tail, eyes = rig
    for obj in controls:
        obj.location, obj.rotation_euler, obj.scale = (v.copy() for v in rest[obj])
    wave = math.sin(phase * math.tau)
    body.scale.z *= 1 + 0.018 * wave
    head.rotation_euler.z = 0.025 * wave
    tail.rotation_euler.z = 0.13 * wave
    if name == 'idle':
        if 0.45 < phase < 0.60:
            for eye in eyes: eye.scale.z *= 0.10
    elif name == 'walk':
        root.location.z += 0.035 * (1 - math.cos(phase * math.tau * 2))
        for i in range(2):
            arms[i].rotation_euler.x = 0.42 * wave * (-1 if i else 1)
            legs[i].rotation_euler.x = -0.38 * wave * (-1 if i else 1)
        head.rotation_euler.y = 0.045 * wave
    elif name == 'look':
        head.rotation_euler.z = 0.20 * math.sin(phase * math.tau)
        head.rotation_euler.y = 0.10 * math.sin(phase * math.pi)
        arms[0].rotation_euler.y = 0.25 * math.sin(phase * math.pi)
    elif name in ['sit', 'sleep']:
        body.scale.z *= 0.91
        head.location.z -= 0.13
        head.rotation_euler.y = -0.09
        for i in range(2): legs[i].rotation_euler.x = -0.45
        if name == 'sleep':
            head.rotation_euler.z = 0.10
            head.location.z += 0.012 * wave
            for eye in eyes: eye.scale.z *= 0.08
    elif name == 'jump':
        lift = math.sin(phase * math.pi) ** 2
        root.location.z += 0.34 * lift
        arms[0].rotation_euler.y = -0.85 * lift
        arms[1].rotation_euler.y = 0.85 * lift
        for leg in legs: leg.rotation_euler.x = -0.35 * lift
    elif name == 'grab':
        arms[0].rotation_euler.y = -0.50
        arms[1].rotation_euler.y = 0.50
        head.rotation_euler.y = -0.10


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = '--preview' in args
    selected = [key for key in PALETTES if key in args] or list(PALETTES)
    for kind in selected:
        scene, rig = setup_scene(kind)
        directory = ROOT / 'renders' / kind
        directory.mkdir(parents=True, exist_ok=True)
        if preview:
            scene.render.resolution_x = scene.render.resolution_y = 512
            pose(rig, 'idle', 0)
            scene.render.filepath = str(directory / 'beauty.png')
            bpy.ops.render.render(write_still=True)
            continue
        scene.render.resolution_x = scene.render.resolution_y = 120
        frame = 1
        for name, count, duration in POSES:
            scene.timeline_markers.new(name, frame=frame)
            for i in range(count):
                phase = i / count if name in ['idle', 'walk', 'sleep'] else i / max(1, count - 1)
                scene.frame_set(frame)
                pose(rig, name, phase)
                for obj in rig[0]:
                    for prop in ['location', 'rotation_euler', 'scale']: obj.keyframe_insert(data_path=prop, frame=frame)
                scene.render.filepath = str(directory / f'{name}-{i:02d}.png')
                bpy.ops.render.render(write_still=True)
                frame += 1
        scene.frame_start, scene.frame_end = 1, frame - 1
        scene.frame_set(1)
        scene.render.filepath = f'//../renders/{kind}/idle-00.png'
        (ROOT / 'source').mkdir(exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'source' / f'{kind}.blend'), compress=True)


if __name__ == '__main__': main()

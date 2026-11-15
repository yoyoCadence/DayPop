"""Author and render two native Blender characters.

blender -b --factory-startup --python-exit-code 1 --python create_3d.py -- mecha-spirit /tmp/mecha
"""
import argparse
import math
import sys
from itertools import accumulate
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from motion import SINGLES, TIMING


def rgb(hex_color):
    parts = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055)**2.4 for x in parts)


def material(name, color, rough=.65, metal=0, fiber=False, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb(color), 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Emission Color'].default_value = mat.diffuse_color
    shader.inputs['Emission Strength'].default_value = glow
    if fiber:
        shader.inputs['Sheen Weight'].default_value = .33
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 140
        noise.inputs['Roughness'].default_value = .75
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .21
        bump.inputs['Distance'].default_value = .016
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return mat


def control(name, parent=None, at=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = .18
    obj.parent = parent
    obj.location = at
    return obj


def finish(obj, name, mat, parent, at):
    obj.name = name
    obj.parent = parent
    obj.location = at
    obj.data.materials.append(mat)
    return obj


def oval(name, mat, parent, at, scale, rotation=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16)
    obj = finish(bpy.context.object, name, mat, parent, at)
    obj.scale = scale
    obj.rotation_euler = tuple(math.radians(v) for v in rotation)
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    return obj


def form(name, mat, parent, outline, depth, y=-.1, bevel=.035):
    """Extrude a hand-drawn X/Z contour with beveled solid edges."""
    points = [(x, y + offset, z) for offset in (-depth/2, depth/2) for x, z in outline]
    n = len(outline)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, n+(i+1) % n, n+i) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, name, mat, parent, (0, 0, 0))
    edge = obj.modifiers.new('Rounded edge', 'BEVEL')
    edge.width = bevel
    edge.segments = 3
    obj.modifiers.new('Face-weighted normals', 'WEIGHTED_NORMAL')
    return obj


def line(name, mat, parent, points, radius=.018, loop=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 3
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for p, pos in zip(spline.bezier_points, points):
        p.co = pos
        p.handle_left_type = p.handle_right_type = 'AUTO'
    spline.use_cyclic_u = loop
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, parent, (0, 0, 0))


def jewel(name, mat, parent, at, size):
    mesh = bpy.data.meshes.new(name)
    w, h, d = size
    mesh.from_pydata([(0, 0, h), (w, 0, 0), (0, d, 0), (-w, 0, 0), (0, -d, 0), (0, 0, -h)],
                     [], [(0, i, 1 + i % 4) for i in range(1, 5)] + [(5, 1 + i % 4, i) for i in range(1, 5)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, parent, at)


def ring(name, mat, parent, at, radii, tilt=0, tube=.029):
    points = [(radii[0] * math.cos(a), radii[1] * math.sin(a), tilt * math.cos(a))
              for a in [math.tau * n / 24 for n in range(24)]]
    obj = line(name, mat, parent, points, tube, True)
    obj.location = at
    return obj


def panda_tail(parent, rust, cream, burnt):
    count, sides = 32, 20
    centers = [Vector((1.35*t, .18+.62*math.sin(t*1.55), .03+.85*t*t))
               for t in [n/count for n in range(count+1)]]
    vertices, faces = [], []
    for i, c in enumerate(centers):
        t = i / count
        tangent = centers[min(i+1,count)] - centers[max(i-1,0)]
        u = tangent.normalized().cross(Vector((0, 0, 1))).normalized()
        v = tangent.normalized().cross(u)
        r = .19 + .19*math.sin(math.pi*t*.95)
        if t > .78:
            r *= math.sqrt(max(.002, 1-((t-.78)/.22)**2))
        vertices.extend(c + r*(math.cos(a)*u+math.sin(a)*v)
                        for a in [math.tau*n/sides for n in range(sides)])
    for i in range(count):
        for j in range(sides):
            k = (j+1) % sides
            faces.append((i*sides+j, i*sides+k, (i+1)*sides+k, (i+1)*sides+j))
    faces += [tuple(reversed(range(sides))), tuple(range(count*sides, (count+1)*sides))]
    mesh = bpy.data.meshes.new('Sculpted stripe tube')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('Ringed tail', mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, 'Ringed tail', rust, parent, (0, 0, 0))
    mesh.materials.append(cream)
    mesh.materials.append(burnt)
    for face in mesh.polygons:
        section = face.index // sides
        face.use_smooth = face.index < count*sides
        face.material_index = 1 if section in {7, 8, 9, 16, 17, 18, 25, 26, 27} else 2 if section >= 30 else 0


def panda(rig):
    coat = material('Ginger plush', 'E17D49', fiber=True)
    light = material('Ivory muzzle and brow', 'FFF0CD', fiber=True)
    cheek = material('Apricot cheeks', 'F7BF83', fiber=True)
    dark = material('Mulberry paws', '653934', fiber=True)
    burnt = material('Red umber face mask', 'AC4E3D', fiber=True)
    pink = material('Thread and paw velvet', 'D78371', fiber=True)
    ink = material('Coffee eyes and nose', '2C181D', .35)
    shine = material('Catchlight', 'FFF8ED', .35, glow=.15)
    yellow = material('Marigold bandana', 'F3B237', fiber=True)
    seam = material('Bandana binding', 'AB622A', fiber=True)

    oval('Abdomen', coat, rig['Chest'], (0, .04, .04), (.62, .49, .59))
    oval('Velvet belly', burnt, rig['Chest'], (0, -.36, -.06), (.40, .18, .38))
    oval('Head', coat, rig['Head'], (0, 0, .02), (.76, .58, .64))
    for sign in (-1, 1):
        label = 'L' if sign < 0 else 'R'
        ear = control(f'Panda ear {label}', rig['Head'], (sign*.51, .05, .47))
        rig[f'Ear{label}'] = ear
        oval(f'Ear outer {label}', coat, ear, (0, 0, .05), (.265, .16, .285), (0, sign*20, 0))
        oval(f'Ear cream rim {label}', light, ear, (0, -.106, .07), (.192, .074, .217), (0, sign*20, 0))
        oval(f'Ear lining {label}', pink, ear, (0, -.166, .07), (.129, .035, .155), (0, sign*20, 0))
        oval(f'Teardrop mask {label}', burnt, rig['Head'], (sign*.36, -.43, -.05), (.285, .125, .268), (0, sign*-22, sign*10))
        oval(f'Red panda cheek {label}', light, rig['Head'], (sign*.469, -.447, -.135), (.23, .10, .156), (0, sign*-16, sign*12))
        oval(f'Cheek stitching {label}', cheek, rig['Head'], (sign*.507, -.529, -.133), (.088, .025, .045))
        for step in range(2):
            oval(f'Cheek fur tip {label} {step}', light, rig['Head'],
                 (sign*(.53-step*.032), -.451, -.175-step*.045), (.151,.053,.063), (0,-sign*20,sign*13))
        oval(f'Ivory eyebrow {label}', light, rig['Head'], (sign*.307, -.468, .251), (.137, .055, .073), (0, sign*-15, 0))
        eye = control(f'Eye aperture {label}', rig['Head'], (sign*.286, -.547, .073))
        rig[f'Eye{label}'] = eye
        oval(f'Black glass eye {label}', ink, eye, (0, 0, 0), (.103, .059, .115))
        oval(f'Eye glint {label}', shine, eye, (-.022, -.055, .032), (.029, .013, .032))
    for label in ('L', 'R'):
        paw = rig['Paw'+label]
        oval(f'Sleeve {label}', coat, paw, (0, 0, -.15), (.185, .183, .29), (0, 8 if label == 'L' else -8, 0))
        oval(f'Front paw {label}', dark, paw, (0, -.04, -.34), (.177, .171, .165))
        oval(f'Front pad {label}', pink, paw, (0, -.196, -.36), (.085, .025, .072))
        foot = rig['Foot'+label]
        oval(f'Hind foot {label}', dark, foot, (0, -.095, -.105), (.24, .272, .175))
        oval(f'Hind pad {label}', pink, foot, (0, -.333, -.11), (.102, .025, .073))
        for n in (-1, 0, 1):
            oval(f'Toe {label} {n}', pink, foot, (n*.061, -.321, -.015+.015*(n == 0)), (.028,.018,.028))
    oval('Ivory snout', light, rig['Head'], (0, -.513, -.169), (.311, .196, .213))
    oval('Brown nose', ink, rig['Head'], (0, -.696, -.091), (.111, .059, .069))
    for sign in (-1, 1):
        line('Smile embroidery', ink, rig['Head'], [(0,-.710,-.134),(sign*.048,-.704,-.177),(sign*.116,-.679,-.162)], .012)
    oval('Scarf collar', yellow, rig['Chest'], (0, -.04, .419), (.505, .458, .116), (12, -9, 0))
    form('Folded bandana', yellow, rig['Chest'], [(-.37,.42),(-.29,.25),(-.11,.125),(.18,.26),(.32,.43)], .10, -.445, .08)
    line('Bandana edge stitching', seam, rig['Chest'], [(-.285,-.532,.297),(-.11,-.537,.16),(.11,-.527,.247)], .009)
    oval('Bandana knot', yellow, rig['Scarf'], (0, 0, 0), (.16,.11,.11), (0,35,14))
    form('Bandana tie', yellow, rig['Scarf'], [(-.035,.04),(.13,.055),(.31,-.16),(.20,-.19),(.10,-.13),(.01,-.17)], .072, -.015, .035)
    panda_tail(rig['Tail'], coat, light, burnt)


def mecha(rig):
    purple = material('Midnight enamel', '493688', .39, .27)
    lilac = material('Amethyst enamel', '8271CD', .34, .24)
    black = material('Deep space ceramic', '28223D', .48)
    bronze = material('Brushed antique gold', 'AC6935', .38, .40)
    gold = material('Brushed champagne gold', 'F8C76C', .34, .43)
    white = material('Warm porcelain faceplate', 'FFF0D1', .45)
    peach = material('Coral ceramic', 'EA9891', .5)
    crystal = material('Violet charged crystal', 'BF91FF', .28, .22, glow=.20)
    glint = material('Warm constellation light', 'FFE5A1', .32, glow=.31)
    ink = material('Plum glass eyes', '31224C', .31)
    oval('Purple lower chassis', purple, rig['Chest'], (0,.075,.065), (.47,.39,.51))
    ring('Waist brass seam', bronze, rig['Chest'], (0,.03,-.095), (.439,.36), tilt=.035)
    oval('Crystal housing', bronze, rig['Chest'], (0,-.29,-.19), (.20,.13,.25))
    oval('Crystal bezel', black, rig['Chest'], (0,-.373,-.19), (.16,.065,.198))
    jewel('Chest crystal', crystal, rig['Chest'], (0,-.439,-.19), (.126,.18,.09))
    oval('Helmet', purple, rig['Head'], (0,0,0), (.685,.49,.632))
    oval('Back shell ridge', lilac, rig['Head'], (0,.13,.25), (.49,.39,.367))
    oval('Bezel dark setting', black, rig['Head'], (0,-.285,-.025), (.605,.335,.534))
    oval('Brass faceplate rim', gold, rig['Head'], (0,-.331,-.023), (.565,.32,.499))
    oval('Ceramic insert', white, rig['Head'], (0,-.437,-.032), (.486,.231,.416))
    for sign in (-1, 1):
        label = 'L' if sign < 0 else 'R'
        ear = control(f'Wing hinge {label}', rig['Head'], (sign*.44,.025,.39))
        rig[f'Ear{label}'] = ear
        form(f'Forged gold wing {label}', gold, ear, [(sign*x,z) for x,z in [(0,-.08),(.23,-.13),(.51,.04),(.68,.36),(.29,.27),(.06,.19)]], .14, -.03)
        form(f'Violet inset wing {label}', purple, ear, [(sign*x,z) for x,z in [(.05,-.038),(.23,-.07),(.46,.09),(.58,.29),(.30,.22),(.12,.15)]], .055, -.121, .021)
        line(f'Wing circuit {label}', lilac, ear, [(sign*.12,-.16,.034),(sign*.28,-.16,.083),(sign*.40,-.155,.171)], .016)
        jewel(f'Wing constellation {label}', glint, ear, (sign*.39,-.177,.178), (.067,.085,.026))
        oval(f'Gear collar {label}', bronze, rig['Head'], (sign*.613,.006,-.102), (.139,.232,.216))
        oval(f'Gear cap {label}', gold, rig['Head'], (sign*.678,-.04,-.102), (.107,.172,.148))
        for i in range(6):
            a = math.tau*i/6
            oval(f'Shell bolt {label} {i}', gold, rig['Head'], (sign*.654,-.04+.168*math.cos(a), -.10+.162*math.sin(a)), (.059,.040,.040))
        eye = control(f'Eye aperture {label}', rig['Head'], (sign*.181,-.645,.045))
        rig[f'Eye{label}'] = eye
        oval(f'Plum optical pupil {label}', ink, eye, (0,0,0), (.084,.043,.118))
        oval(f'Optical glint {label}', white, eye, (-.015,-.041,.035), (.021,.011,.029))
        oval(f'Cheek aperture {label}', peach, rig['Head'], (sign*.269,-.626,-.143), (.061,.025,.025))
        paw = rig['Paw'+label]
        oval(f'Arm guard {label}', gold, paw, (0,0,-.109), (.124,.134,.244), (0,-sign*17,0))
        oval(f'Sleeve enamel {label}', purple, paw, (0,-.091,-.15), (.095,.062,.134), (0,-sign*17,0))
        oval(f'Porcelain hand {label}', white, paw, (sign*.055,-.05,-.30), (.102,.102,.088))
        foot = rig['Foot'+label]
        oval(f'Heel rim {label}', bronze, foot, (0,-.023,-.064), (.15,.195,.163))
        oval(f'Heel shell {label}', gold, foot, (0,-.098,-.13), (.152,.167,.098))
    line('Smiling mouth', ink, rig['Head'], [(-.07,-.661,-.123),(0,-.677,-.161),(.07,-.661,-.123)], .02)
    line('Top radial crown stem', gold, rig['Head'], [(0,0,.59), (0,.03,.735),(0,.062,.77)], .051)
    ring('Floating star orbit', gold, rig['Crown'], (0,0,0), (.63,.36), tilt=.079, tube=.027)
    jewel('North star', gold, rig['Crown'], (.02,-.106,.11), (.155,.24,.085))
    jewel('North star highlight', glint, rig['Crown'], (.02,-.190,.117), (.078,.16,.037))
    for sign in (-1,1):
        oval('Orbital rivet', lilac, rig['Crown'], (sign*.522,.16,sign*.062), (.083,.075,.062))
    line('Braided hover rudder', bronze, rig['Tail'], [(0,0,0),(-.24,.12,.04),(-.54,.25,.28),(-.78,.34,.255)], .080)
    form('Rudder gold foil', gold, rig['Tail'], [(-.57,.26),(-.83,.46),(-1.037,.38),(-.90,.16),(-.74,.15)], .075, .30)
    form('Rudder enamel', purple, rig['Tail'], [(-.64,.264),(-.829,.42),(-.981,.365),(-.885,.191),(-.77,.17)], .047, .24, .022)


def make_rig(kind):
    is_panda = kind == 'red-panda'
    root = control('Root')
    chest = control('Chest', root, (0,.03,.76 if is_panda else .89))
    head = control('Head', chest, (0,-.08,.74 if is_panda else .59))
    rig = {
        'Root': root, 'Chest': chest, 'Head': head,
        'Tail': control('Tail', chest, (.27,.27,-.35) if is_panda else (-.15,.25,-.01)),
        'PawL': control('Arm.L', chest, (-.405,-.26,.128)),
        'PawR': control('Arm.R', chest, (.405,-.26,.128)),
        'FootL': control('Leg.L', chest, (-.245,.04,-.44)),
        'FootR': control('Leg.R', chest, (.245,.04,-.44)),
    }
    if is_panda:
        rig['Scarf'] = control('Scarf knot follow', chest, (.31,-.426,.312))
        panda(rig)
    else:
        rig['Crown'] = control('Star orbit tilt', head, (0,.07,.795))
        mecha(rig)
    return rig


def pose_at(rig, base, kind, pose, i, n):
    panda_kind = kind == 'red-panda'
    a = math.tau * i/n
    wave = math.sin(a)
    breathe = (1-math.cos(a))/2
    for name, obj in rig.items():
        obj.location = base[name]
        obj.rotation_euler = (0,0,0)
        obj.scale = (1,1,1)

    def rotate(part, x=0, y=0, z=0):
        rig[part].rotation_euler = tuple(math.radians(v) for v in (x,y,z))

    def move(part, x=0, y=0, z=0):
        rig[part].location += Vector((x,y,z))

    def close_eyes(amount):
        for side in ('L', 'R'):
            rig['Eye'+side].scale.z = amount

    rotate('Tail', 4*wave, 4*wave, 9*wave)
    if 'Crown' in rig:
        rotate('Crown', 4*wave, 6*wave, 4*wave)
    if 'Scarf' in rig:
        rotate('Scarf', 8*wave, 5*wave)
    if pose == 'idle':
        move('Root', z=(.018 if panda_kind else .070)*breathe)
        rotate('Head', 1.5*wave, -2*wave, 2*wave)
        close_eyes(.16 if i == 3 else .8 if i == 4 else 1)
    elif pose == 'walk':
        move('Root', z=(.055 if panda_kind else .14) * abs(wave))
        rotate('Chest', 3, 5*wave, -6)
        rotate('Head', 0, -5*wave, -3)
        for side, sign in [('L',-1),('R',1)]:
            rotate('Paw'+side, 36*sign*wave, 6*sign)
            rotate('Foot'+side, -25*sign*wave, -4*sign)
            move('Foot'+side, y=.13*sign*wave, z=.13*max(0, -sign*wave))
            rotate('Ear'+side, x=6*wave, y=sign*6*wave)
    elif pose == 'sit':
        move('Chest', z=-.16)
        rotate('Chest', 5, 0, -3)
        rotate('Head', -5, 5*wave, 4)
        rotate('Tail', y=15, z=-38+9*wave)
        for side, sign in [('L',-1),('R',1)]:
            move('Foot'+side, x=.105*sign, y=-.285, z=.155)
            rotate('Foot'+side, -23, 3*sign, 12*sign)
            rotate('Paw'+side, -8+8*wave*sign, -10*sign)
        if i == 3:
            close_eyes(.16)
    elif pose == 'sleep':
        move('Chest', x=.16 if panda_kind else .02, z=-.36+.028*breathe)
        rotate('Chest', 15, -16, 13)
        move('Head', x=-.24, y=-.13, z=-.19)
        rotate('Head', 15+4*breathe, -22, 16)
        close_eyes(.125)
        rotate('Tail', 2*wave, 4, (-47 if panda_kind else -63)+3*wave)
        for side, sign in [('L',-1),('R',1)]:
            move('Foot'+side, x=.13*sign, z=.28, y=.14)
            rotate('Paw'+side, -60, 13*sign)
            move('Paw'+side, z=.14)
            rotate('Ear'+side, -11, 12*sign)
    elif pose == 'jump':
        height = (0,-.07,.14,.32,.42,.34,.20,.06,-.05,0)[i]
        move('Root', z=height * (.96 if panda_kind else .70))
        rotate('Chest', -9*max(height,0), 22*max(height,0), 0)
        rotate('Head', -15*max(height,0), -18*max(height,0), 0)
        if height > .08:
            for side, sign in [('L',-1),('R',1)]:
                rotate('Paw'+side,-95*height,-80*sign*height)
                rotate('Foot'+side,-55*height, 28*sign*height)
                move('Foot'+side, y=-.29*height, z=.28*height)
                rotate('Ear'+side, -32*height, 45*height*sign)
            close_eyes(.49)
    elif pose == 'look':
        angle = (0,-14,-25,-22,18,26,24,11,4,0)[i]
        rotate('Head', -abs(angle)*.17, angle*.28, angle)
        move('Head', x=angle*.003, z=abs(angle)*.0014)
        close_eyes(.2 if i == 3 else 1)
    elif pose == 'grab':
        move('Root', z=.16+.05*breathe)
        rotate('Chest', -15, 12+6*wave, -8)
        rotate('Head', 5, -17+6*wave, -9)
        for side, sign in [('L',-1),('R',1)]:
            rotate('Paw'+side, -35+25*sign*wave, -41*sign)
            rotate('Foot'+side, 22+22*sign*wave, 15*sign)
            rotate('Ear'+side, 8, -14*sign)
        close_eyes(.31)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z', 'Y').to_euler()


def studio(kind):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 6
    scene.render.resolution_x = scene.render.resolution_y = 120
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.fps = 100
    scene.view_settings.view_transform = 'AgX'
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.35,.33,.42,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value = .48
    target = (.51,0,1.39) if kind == 'red-panda' else (0,0,1.55)
    bpy.ops.object.camera_add(location=(1.05,-8,3.80))
    camera = bpy.context.object
    point_at(camera, target)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 3.71 if kind == 'red-panda' else 3.58
    scene.camera = camera
    for name, position, watts, size, tone in [
        ('Warm upper key', (-3,-4,6), 460, 3.4, (1,.82,.69)),
        ('Blue studio bounce', (3.8,-2,3.1), 240, 2.8, (.69,.8,1)),
        ('Honey rim', (1,2.8,5), 485, 2.6, (1,.77,.54)),
    ]:
        bpy.ops.object.light_add(type='AREA', location=position)
        light = bpy.context.object
        light.name = name
        light.data.energy = watts
        light.data.size = size
        light.data.color = tone
        point_at(light,target)
    return scene


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=('mecha-spirit','red-panda'))
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = studio(args.kind)
    rig = make_rig(args.kind)
    base = {k:o.location.copy() for k,o in rig.items()}
    timeline, start = {}, 1
    for pose,timing in TIMING.items():
        scene.timeline_markers.new(pose, frame=start)
        frames = [start, *(start+n//10 for n in accumulate(timing))]
        timeline[pose] = frames[:-1]
        for i, frame in enumerate(frames):
            key = i if i < len(timing) else len(timing)-1 if pose in SINGLES else 0
            pose_at(rig,base,args.kind,pose,key,len(timing))
            for obj in rig.values():
                for prop in ('location','rotation_euler','scale'):
                    obj.keyframe_insert(prop, frame=frame, group=obj.name)
        start = frames[-1]+1
    scene.frame_end = start-1
    scene.frame_set(1)
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    rig['Root'].select_set(True)
    bpy.context.view_layer.objects.active = rig['Root']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
    if args.source:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.source.resolve()), compress=True)
    scene.render.resolution_x = scene.render.resolution_y = 600 if not args.preview else 300
    scene.render.filepath = str(out / 'beauty.png')
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x = scene.render.resolution_y = 120
    for pose, frames in timeline.items():
        for i, frame in enumerate(frames):
            if args.preview and i not in {0, len(frames)//2}:
                continue
            scene.frame_set(frame)
            scene.render.filepath = str(out/f'{pose}-{i:02}.png')
            bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()

"""DP-203: seated paw-step and UFO glide studies, without remodeling."""
import bpy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1]/'2026-10-23/motion'


def wave(frame, harmonic=1, offset=0):
    value = math.sin(2*math.pi*((frame-1) % 8)/8*harmonic+offset)
    return 0 if abs(value) < 1e-10 else value


def pose(kind, frame):
    phase = wave(frame)
    if kind == 'moon_cat':
        for side, stride in ((0, phase), (1, -phase)):
            paw = bpy.data.objects[f'CTRL / paw {side}']
            lift = max(0, stride)
            paw.delta_location = (0, .025*stride, .080*lift)
            paw.delta_rotation_euler.x = -.230*lift
        bpy.data.objects['CTRL / breath'].delta_scale.z = .995+.005*math.cos(2*math.pi*((frame-1) % 8)/8*2)
        bpy.data.objects['CTRL / head'].delta_location.z = .012*wave(frame, 2)
        bpy.data.objects['CTRL / tail'].delta_rotation_euler.y = .035*phase
    else:
        root = bpy.data.objects['CTRL / character anchor']
        root.delta_location = (-.025*phase, 0, .020*wave(frame, 2))
        root.delta_rotation_euler = (.040*phase, .055*phase, .025*phase)
        bpy.data.objects['CTRL / antenna'].delta_rotation_euler.x = .040*wave(frame, offset=math.pi/4)


def main():
    published = json.loads((PREVIOUS/'manifest.json').read_text(encoding='utf8'))
    result = {'task':'DP-203', 'productionReady':False, 'appIntegrated':False,
              'fullCatWalkImplemented':False, 'ownerMotionApproved':False,
              'sourceCommit':'96b3836991affc3c471b1189a445d54082ad614f',
              'preparationCommit':'dd1004555410a51cf0358086bd26338e4e169522', 'characters':[]}
    for char in published['characters']:
        kind = char['id']
        source = PREVIOUS/char['source']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == char['sha256'][char['source']], 'published source changed'
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        scene.frame_set(1)
        for obj in scene.objects:
            obj.animation_data_clear()
            if obj.name.startswith('CTRL /'):
                obj.delta_location = (0,0,0)
                obj.delta_rotation_euler = (0,0,0)
                obj.delta_scale = (1,1,1)
        for mesh in bpy.data.meshes:
            if mesh.shape_keys:
                mesh.shape_keys.animation_data_clear()
                for key in mesh.shape_keys.key_blocks:
                    if key.name != 'Basis': key.value=0
        controls = [obj for obj in scene.objects if obj.name.startswith('CTRL /')]
        for frame in range(1,10):
            scene.frame_set(frame)
            pose(kind,frame)
            for obj in controls:
                for channel in ('delta_location','delta_rotation_euler','delta_scale'):
                    obj.keyframe_insert(channel,frame=frame,group='DP-203 existing controls')
        scene.render.fps=10
        scene.render.fps_base=1
        scene.render.resolution_x=scene.render.resolution_y=120
        scene.frame_start=1
        scene.frame_end=9
        scene.timeline_markers.clear()
        name='paw_step' if kind=='moon_cat' else 'glide'
        scene.timeline_markers.new(name+' start',frame=1)
        scene.timeline_markers.new(name+' closure',frame=9)
        scene['status']='DP-203 motion feasibility, not App integrated or owner motion accepted'
        scene['clips']=name+' eight 100ms frames; frame 9 matches frame 1; seated paw-step is not full walking'
        frames=[]
        for frame in range(1,9):
            scene.frame_set(frame)
            output=ROOT/'frames'/kind/f'{frame-1:03}.png'
            output.parent.mkdir(parents=True,exist_ok=True)
            scene.render.filepath=str(output)
            bpy.ops.render.render(write_still=True)
            frames.append(output.relative_to(ROOT).as_posix())
        scene.frame_set(1)
        bpy.context.view_layer.update()
        assert {'matrix':[list(row) for row in scene.camera.matrix_world], 'scale':scene.camera.data.ortho_scale}==char['camera']
        out_source=ROOT/'source'/f'{kind}.blend'
        out_source.parent.mkdir(exist_ok=True)
        scene.render.filepath=f'//../frames/{kind}/'
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(out_source),compress=True)
        result['characters'].append({'id':kind,'motion':name,'source':out_source.relative_to(ROOT).as_posix(),
            'inputSource':'../../2026-10-23/motion/'+char['source'],'inputSourceSha256':char['sha256'][char['source']],
            'camera':char['camera'],'anchor':char['anchor'],'frames':frames,'frameDurationMs':100,
            'durationMs':800,'closureFrame':9})
    (ROOT/'render-manifest.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('DP-203 native seated paw-step / glide sources and 16 actual frames completed',flush=True)


if __name__=='__main__':main()

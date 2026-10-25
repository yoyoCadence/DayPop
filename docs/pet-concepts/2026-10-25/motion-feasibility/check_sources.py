"""Native geometry, bounded existing controls, loop closure and real rerenders."""
import bpy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from contextlib import nullcontext

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('dp194_geometry_digest',ROOT.parents[1]/'2026-10-24/jump/check_sources.py')
original_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(original_module)


def base():
    return {obj.name:(list(obj.location),list(obj.rotation_euler),list(obj.scale),obj.parent.name if obj.parent else None,
                      [list(row) for row in obj.matrix_parent_inverse]) for obj in bpy.context.scene.objects}


def world():
    return {obj.name:[round(value,6) for row in obj.matrix_world for value in row]
            for obj in bpy.context.scene.objects if obj.type in {'MESH','CURVE'}}


def check(render=False):
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    for char in manifest['characters']:
        input_path=ROOT/char['inputSource']
        assert hashlib.sha256(input_path.read_bytes()).hexdigest()==char['inputSourceSha256'],'published native source changed'
        bpy.ops.wm.open_mainfile(filepath=str(input_path))
        bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
        geometry=original_module.geometry();transforms=base()
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/char['source']))
        scene=bpy.context.scene
        assert original_module.geometry()==geometry,'original model/material changed'
        assert base()==transforms,'base transforms/hierarchy changed'
        assert scene.render.fps==10 and scene.render.fps_base==1,'native sample clock'
        assert scene.render.film_transparent and scene.render.resolution_x==scene.render.resolution_y==120
        assert scene.frame_start==1 and scene.frame_end==9,'closure frame range'
        assert {m.name:m.frame for m in scene.timeline_markers}=={char['motion']+' start':1,char['motion']+' closure':9}
        assert not scene.camera.animation_data and not scene.camera.data.animation_data,'animated camera'
        assert not any(image.filepath for image in bpy.data.images if image.source=='FILE'),'external source image'
        root=bpy.data.objects['CTRL / character anchor']
        eyes=[mesh.shape_keys.key_blocks['Blink'] for mesh in bpy.data.meshes if mesh.shape_keys and 'Blink' in mesh.shape_keys.key_blocks]
        assert len(eyes)>=4 and not any(key.id_data.animation_data for key in eyes),'unexpected eye animation'
        controls=[obj for obj in scene.objects if obj.name.startswith('CTRL /')]
        assert all(obj.animation_data for obj in controls),'missing native keyed controls'
        poses=[];paws=[];tilts=[]
        with (tempfile.TemporaryDirectory(prefix='daypop-dp203-native-') if render else nullcontext(None)) as directory:
            for frame in range(1,10):
                scene.frame_set(frame);bpy.context.view_layer.update()
                assert {'matrix':[list(row) for row in scene.camera.matrix_world],'scale':scene.camera.data.ortho_scale}==char['camera'],'camera changed'
                assert list(root.location)==char['anchor'],'base anchor changed'
                assert all(abs(key.value)<1e-6 for key in eyes),'eyes must stay open'
                poses.append(world())
                if char['id']=='moon_cat':
                    assert all(abs(value)<1e-6 for value in root.delta_location),'seated paw-step must stay in place'
                    paws.append(tuple(bpy.data.objects[f'CTRL / paw {side}'].delta_location.z for side in (0,1)))
                else:tilts.append(list(root.delta_rotation_euler))
                if render:
                    output=Path(directory)/f'{frame}.png';scene.render.filepath=str(output)
                    bpy.ops.render.render(write_still=True)
                    reference=ROOT/char['frames'][(frame-1)%8]
                    actual=bpy.data.images.load(str(output),check_existing=False)
                    expected=bpy.data.images.load(str(reference),check_existing=False)
                    assert list(actual.pixels)==list(expected.pixels),'native sample/closure rerender pixels differ'
                    bpy.data.images.remove(actual);bpy.data.images.remove(expected)
        assert poses[0]==poses[-1],'native loop closure changed'
        assert len({str(pose) for pose in poses[:-1]})>=6,'frozen native study'
        if char['id']=='moon_cat':
            assert paws[2][0]>.07 and abs(paws[2][1])<1e-6 and paws[6][1]>.07 and abs(paws[6][0])<1e-6,'alternating seated paw peaks missing'
        else:
            assert max(tilt[1] for tilt in tilts)>.05 and min(tilt[1] for tilt in tilts)<-.05,'opposite glide tilts missing'
        print('NATIVE MOTION PASS',char['id'],char['motion'],'geometry/base/camera, 8 samples + exact closure; rerender',render,flush=True)


if __name__=='__main__':check(render=True)

"""Exact published paw trajectories, frozen non-paw world geometry, real loop renders."""
import bpy
from contextlib import nullcontext
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT=Path(__file__).resolve().parent
PREVIOUS=ROOT.parents[1]/'2026-10-25/motion-feasibility'
spec=importlib.util.spec_from_file_location('dp203_native_geometry',PREVIOUS/'check_sources.py')
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
PAWS={'CTRL / paw 0','CTRL / paw 1'}


def paw_values():
    return {name:[*bpy.data.objects[name].delta_location,*bpy.data.objects[name].delta_rotation_euler,*bpy.data.objects[name].delta_scale] for name in sorted(PAWS)}


def moving(obj):
    while obj:
        if obj.name in PAWS:return True
        obj=obj.parent
    return False


def fixed_world():
    return {obj.name:[round(value,6) for row in obj.matrix_world for value in row]
            for obj in bpy.context.scene.objects if obj.type in {'MESH','CURVE'} and not moving(obj)}


def check(render=False):
    m=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    source=ROOT/m['inputSource']
    assert hashlib.sha256(source.read_bytes()).hexdigest()==m['inputSourceSha256'],'published source changed'
    bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene
    scene.frame_set(1);bpy.context.view_layer.update()
    geometry=original.original_module.geometry();base=original.base();fixed=fixed_world()
    path=[]
    for frame in range(1,10):scene.frame_set(frame);path.append(paw_values())
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/m['source']));scene=bpy.context.scene
    assert original.original_module.geometry()==geometry,'model/material changed'
    assert original.base()==base,'base transforms/hierarchy changed'
    assert {obj.name for obj in scene.objects if obj.animation_data}==PAWS,'only existing paws may be animated'
    assert not any(mesh.shape_keys.animation_data for mesh in bpy.data.meshes if mesh.shape_keys),'unexpected eye animation'
    assert not scene.camera.data.animation_data,'animated camera data'
    assert scene.render.fps==10 and scene.render.fps_base==1 and scene.frame_start==1 and scene.frame_end==9,'native sample clock/closure'
    assert scene.render.resolution_x==scene.render.resolution_y==120 and scene.render.film_transparent
    assert {marker.name:marker.frame for marker in scene.timeline_markers}=={'paw_step_local start':1,'paw_step_local closure':9}
    assert all(any(moving(obj) and obj.type=='MESH' and obj.parent.name==name for obj in scene.objects) for name in PAWS),'real paw geometry must follow controls'
    assert not any(image.filepath for image in bpy.data.images if image.source=='FILE')
    poses=[]
    with (tempfile.TemporaryDirectory(prefix='daypop-dp204-native-') if render else nullcontext(None)) as directory:
        for frame in range(1,10):
            scene.frame_set(frame);bpy.context.view_layer.update()
            assert paw_values()==path[frame-1],'published paw trajectory changed'
            assert fixed_world()==fixed,'non-paw geometry moved'
            assert {'matrix':[list(row) for row in scene.camera.matrix_world],'scale':scene.camera.data.ortho_scale}==m['camera'],'camera changed'
            assert list(bpy.data.objects['CTRL / character anchor'].location)==m['anchor'],'base anchor changed'
            eyes=[mesh.shape_keys.key_blocks['Blink'].value for mesh in bpy.data.meshes if mesh.shape_keys and 'Blink' in mesh.shape_keys.key_blocks]
            assert len(eyes)>=4 and all(abs(value)<1e-6 for value in eyes),'eyes must stay open'
            poses.append(original.world())
            if render:
                output=Path(directory)/f'{frame}.png';scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
                actual=bpy.data.images.load(str(output),check_existing=False)
                expected=bpy.data.images.load(str(ROOT/m['frames'][(frame-1)%8]),check_existing=False)
                assert list(actual.pixels)==list(expected.pixels),'native sample/closure rerender pixels differ'
                bpy.data.images.remove(actual);bpy.data.images.remove(expected)
    assert poses[0]==poses[-1] and len({str(pose) for pose in poses[:-1]})==5,'native loop/unique paw poses'
    print('NATIVE LOCAL STEP PASS exact published paw trajectory / frozen other geometry / 8 samples + closure; rerender',render,flush=True)


if __name__=='__main__':check(render=True)

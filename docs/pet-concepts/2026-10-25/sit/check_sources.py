"""Reopen native sit poses and verify model, materials, camera, controls and render."""
import bpy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('dp194_geometry_digest', ROOT.parents[1]/'2026-10-24/jump/check_sources.py')
geometry_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry_module)


def base_transforms():
    return {obj.name: (list(obj.location), list(obj.rotation_euler), list(obj.scale),
            obj.parent.name if obj.parent else None, [list(row) for row in obj.matrix_parent_inverse]) for obj in bpy.context.scene.objects}


def check(render=False):
    manifest = json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    for char in manifest['characters']:
        source = ROOT/char['inputSource']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == char['inputSourceSha256'], 'original native source changed'
        bpy.ops.wm.open_mainfile(filepath=str(source))
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        original_geometry = geometry_module.geometry()
        original_base = base_transforms()
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/char['source']))
        scene = bpy.context.scene
        assert geometry_module.geometry() == original_geometry, 'model or material changed'
        assert base_transforms() == original_base, 'base transforms or hierarchy changed'
        assert scene.frame_start == scene.frame_end == 1 and scene.render.film_transparent, 'static scene contract'
        assert scene.render.resolution_x == scene.render.resolution_y == 120
        assert {m.name:m.frame for m in scene.timeline_markers} == {'sit static':1}
        assert not any(obj.animation_data for obj in scene.objects), 'sit must be static'
        assert not any(mesh.shape_keys.animation_data for mesh in bpy.data.meshes if mesh.shape_keys), 'static eye keys'
        assert not scene.camera.data.animation_data, 'animated camera data'
        assert {'matrix':[list(row) for row in scene.camera.matrix_world], 'scale':scene.camera.data.ortho_scale} == char['camera'], 'camera changed'
        root = bpy.data.objects['CTRL / character anchor']
        head = bpy.data.objects['CTRL / head']
        assert list(root.location) == char['anchor'], 'base anchor changed'
        eyes = [mesh.shape_keys.key_blocks['Blink'] for mesh in bpy.data.meshes if mesh.shape_keys and 'Blink' in mesh.shape_keys.key_blocks]
        assert len(eyes) >= 4 and all(abs(key.value-(.28 if char['id']=='moon_cat' else .20)) < 1e-6 for key in eyes), 'relaxed eyes changed'
        if char['id'] == 'moon_cat':
            assert abs(bpy.data.objects['CTRL / breath'].delta_scale.z-.94) < 1e-6, 'seated body relaxation changed'
            assert abs(head.delta_location.z+.030) < 1e-6 and abs(head.delta_rotation_euler.x-.040) < 1e-6, 'relaxed head changed'
            for side in (0,1):
                paw = bpy.data.objects[f'CTRL / paw {side}']
                assert abs(paw.delta_rotation_euler.x+.045) < 1e-6 and abs(paw.delta_location.z-.003) < 1e-6, 'relaxed paw changed'
            assert all(abs(v) < 1e-6 for v in root.delta_location), 'cat anchor drift'
        else:
            assert abs(root.delta_location.z+.050) < 1e-6, 'lower hovering pose changed'
            assert all(abs(v) < 1e-6 for v in root.delta_rotation_euler), 'ring must remain level'
            assert abs(bpy.data.objects['CTRL / antenna'].delta_rotation_euler.x+.050) < 1e-6, 'relaxed antenna changed'
        assert not any(image.filepath for image in bpy.data.images if image.source=='FILE'), 'external source image'
        if render:
            with tempfile.TemporaryDirectory(prefix='daypop-dp202-native-') as directory:
                output = Path(directory)/'sit.png'
                scene.render.filepath = str(output)
                bpy.ops.render.render(write_still=True)
                actual = bpy.data.images.load(str(output), check_existing=False)
                expected = bpy.data.images.load(str(ROOT/char['frame']), check_existing=False)
                assert list(actual.size) == list(expected.size) == [120,120]
                assert list(actual.pixels) == list(expected.pixels), 'native rerender pixels differ'
                bpy.data.images.remove(actual)
                bpy.data.images.remove(expected)
        print('NATIVE SIT PASS',char['id'],'same geometry/material/base/camera; relaxed static pose; rerender',render,flush=True)


if __name__=='__main__':
    check(render=True)

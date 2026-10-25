"""DP-202 static relaxed pose, keeping the approved seated model and camera."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1] / '2026-10-23/motion'


def main():
    previous = json.loads((PREVIOUS / 'manifest.json').read_text(encoding='utf8'))
    manifest = {'task': 'DP-202', 'productionReady': False, 'appIntegrated': False,
                'appearanceApproved': True, 'sitPoseApproved': False,
                'sourceCommit': '0a0f3de91531b8c5f4c821ccc7455195d1a54099',
                'preparationCommit': '250ee98e65900842dafed344f323c1ee52bad540', 'characters': []}
    for char in previous['characters']:
        kind = char['id']
        old_source = PREVIOUS / char['source']
        assert hashlib.sha256(old_source.read_bytes()).hexdigest() == char['sha256'][char['source']], 'published source changed'
        bpy.ops.wm.open_mainfile(filepath=str(old_source))
        scene = bpy.context.scene
        scene.frame_set(1)
        for obj in scene.objects:
            obj.animation_data_clear()
            if obj.name.startswith('CTRL /'):
                obj.delta_location = (0, 0, 0)
                obj.delta_rotation_euler = (0, 0, 0)
                obj.delta_scale = (1, 1, 1)
        for mesh in bpy.data.meshes:
            if mesh.shape_keys:
                mesh.shape_keys.animation_data_clear()
                for key in mesh.shape_keys.key_blocks:
                    if key.name != 'Basis':
                        key.value = (.28 if kind == 'moon_cat' else .20) if key.name == 'Blink' else 0
        root = bpy.data.objects['CTRL / character anchor']
        head = bpy.data.objects['CTRL / head']
        if kind == 'moon_cat':
            bpy.data.objects['CTRL / breath'].delta_scale.z = .94
            head.delta_location.z = -.030
            head.delta_rotation_euler.x = .040
            bpy.data.objects['CTRL / tail'].delta_rotation_euler.y = .018
            for side in (0, 1):
                paw = bpy.data.objects[f'CTRL / paw {side}']
                paw.delta_location = (0, .008, .003)
                paw.delta_rotation_euler.x = -.045
        else:
            root.delta_location.z = -.050
            head.delta_rotation_euler.x = .015
            bpy.data.objects['CTRL / antenna'].delta_rotation_euler.x = -.050
        bpy.context.view_layer.update()
        camera = {'matrix': [list(row) for row in scene.camera.matrix_world], 'scale': scene.camera.data.ortho_scale}
        assert camera == char['camera'], 'camera changed'
        assert list(root.location) == char['anchor'], 'base anchor changed'
        scene.timeline_markers.clear()
        scene.timeline_markers.new('sit static', frame=1)
        scene.frame_start = scene.frame_end = 1
        scene['status'] = 'DP-202 static sit study; not integrated; pose awaiting owner acceptance'
        scene['clips'] = 'sit static frame 1; no walking or automatic movement'
        scene.render.resolution_x = scene.render.resolution_y = 120
        frame = ROOT / 'frames' / kind / 'sit.png'
        frame.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(frame)
        bpy.ops.render.render(write_still=True)
        source = ROOT / 'source' / f'{kind}.blend'
        source.parent.mkdir(exist_ok=True)
        scene.render.filepath = f'//../frames/{kind}/sit.png'
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        manifest['characters'].append({'id': kind, 'source': source.relative_to(ROOT).as_posix(),
            'frame': frame.relative_to(ROOT).as_posix(), 'camera': camera, 'anchor': char['anchor'],
            'inputSource': '../../2026-10-23/motion/'+char['source'],
            'inputSourceSha256': char['sha256'][char['source']],
            'idleReference': '../../2026-10-23/motion/'+char['clips']['idle']['frames'][0],
            'idleReferenceSha256': char['sha256'][char['clips']['idle']['frames'][0]]})
    (ROOT / 'render-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
    print('DP-202 two native static sit sources and actual PNG renders completed')


if __name__ == '__main__':
    main()

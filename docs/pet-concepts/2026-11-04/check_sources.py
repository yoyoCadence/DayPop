"""Reopen each delivered .blend and inspect actual editable/native animation data."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
POSES = ['idle', 'walk', 'look', 'sit', 'sleep', 'jump', 'grab']
proof = []
for kind in ['cat', 'bear', 'bunny']:
    path = ROOT / 'source' / f'{kind}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(path), use_scripts=False)
    scene = bpy.context.scene
    assert scene.render.engine == 'BLENDER_EEVEE'
    assert scene.render.film_transparent
    assert scene.render.resolution_x == scene.render.resolution_y == 120
    assert [marker.name for marker in scene.timeline_markers] == POSES
    assert scene.frame_start == 1 and scene.frame_end == 50
    meshes = [obj for obj in scene.objects if obj.type == 'MESH']
    controls = [obj for obj in scene.objects if obj.animation_data]
    assert len(meshes) >= 25 and len(controls) >= 10
    assert all(not image.filepath for image in bpy.data.images if image.type != 'RENDER_RESULT')
    assert all(obj.data.materials for obj in meshes)
    head = bpy.data.objects['CTRL / curious head']
    positions = []
    for frame in [21, 23, 26, 30]:
        scene.frame_set(frame)
        positions.append(round(head.rotation_euler.z, 5))
    assert len(set(positions)) > 2, positions
    proof.append({'kind': kind, 'blenderVersion': bpy.app.version_string,
                  'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                  'meshes': len(meshes), 'animatedControls': len(controls), 'poses': POSES,
                  'headLookSamples': positions, 'externalImages': 0})
(ROOT / 'source-proof.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
print('Three editable Blender sources and native animation checks passed')

"""Verify the reopened .blend contains editable geometry and seven motion segments."""
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from motion import TIMING

scene = bpy.context.scene
markers = {marker.name: marker.frame for marker in scene.timeline_markers}
assert tuple(markers) == tuple(TIMING), markers
meshes = [obj for obj in scene.objects if obj.type == 'MESH']
rig = [obj for obj in scene.objects if obj.type == 'EMPTY' and obj.animation_data]
assert len(meshes) >= 30 and len(rig) >= 12
assert not [image.filepath for image in bpy.data.images if image.source == 'FILE']
assert scene.render.film_transparent and scene.camera
assert scene.render.resolution_x == scene.render.resolution_y == 120
motion = {}
for name, frames in TIMING.items():
    start = markers[name]
    checks = set()
    for elapsed in [0, *[sum(frames[:i]) for i in range(1,len(frames))]]:
        scene.frame_set(start + elapsed // 10)
        checks.add(tuple(round(v, 5) for obj in rig for row in obj.matrix_world for v in row))
    assert len(checks) >= 3, name
    motion[name] = {'startFrame': start, 'uniqueRigStates': len(checks)}
print(json.dumps({'blender': bpy.app.version_string, 'meshObjects': len(meshes), 'rigControllers': len(rig),
                  'externalImageTextures': [], 'poses': motion}))

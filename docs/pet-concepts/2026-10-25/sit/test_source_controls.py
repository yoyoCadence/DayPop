"""Mutate native Blender poses, then restore both actual .blend files exactly."""
import bpy
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from check_sources import check


def main():
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    files=[ROOT/char['source'] for char in manifest['characters']]
    backup={path:path.read_bytes() for path in files}
    def restore():
        for path,data in backup.items():path.write_bytes(data)
    def camera():bpy.context.scene.camera.data.ortho_scale*=1.01
    def material():
        node=next(node for mat in bpy.data.materials if mat.node_tree for node in mat.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
        node.inputs['Roughness'].default_value+=.07
    def anchor():bpy.data.objects['CTRL / character anchor'].location.z+=.01
    def head():bpy.data.objects['CTRL / head'].delta_location.z=0
    def eyes():
        for mesh in bpy.data.meshes:
            if mesh.shape_keys and 'Blink' in mesh.shape_keys.key_blocks:mesh.shape_keys.key_blocks['Blink'].value=0
    def animation():bpy.data.objects['CTRL / head'].keyframe_insert('delta_location',frame=1)
    try:
        for label,mutate in [('camera',camera),('material',material),('base anchor',anchor),('relaxed head',head),('relaxed eyes',eyes),('hidden animation',animation)]:
            restore();bpy.ops.wm.open_mainfile(filepath=str(files[0]));mutate()
            bpy.context.preferences.filepaths.save_version=0
            bpy.ops.wm.save_as_mainfile(filepath=str(files[0]),compress=True)
            try:check(render=False)
            except AssertionError as error:print('REJECTED native '+label+': '+str(error),flush=True)
            else:raise AssertionError('native control escaped: '+label)
    finally:
        restore();assert all(path.read_bytes()==data for path,data in backup.items()),'native restore mismatch'
        print('Both Blender sources restored byte-for-byte',flush=True)
    check(render=False)


if __name__=='__main__':main()

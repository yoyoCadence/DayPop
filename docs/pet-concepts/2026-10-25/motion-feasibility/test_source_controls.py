"""Native negative controls, with byte-exact restoration of both Blender files."""
import bpy
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
    def camera():
        data=bpy.context.scene.camera.data;data.keyframe_insert('ortho_scale',frame=1)
        data.ortho_scale*=1.01;data.keyframe_insert('ortho_scale',frame=5)
    def geometry():next(mesh for mesh in bpy.data.meshes if mesh.vertices).vertices[0].co.x+=.01
    def anchor():bpy.data.objects['CTRL / character anchor'].location.z+=.01
    def paw():
        bpy.context.scene.frame_set(3);obj=bpy.data.objects['CTRL / paw 0'];obj.delta_location.z=0;obj.keyframe_insert('delta_location',frame=3)
    def closure():
        bpy.context.scene.frame_set(9);obj=bpy.data.objects['CTRL / head'];obj.delta_location.z+=.02;obj.keyframe_insert('delta_location',frame=9)
    def clock():bpy.context.scene.render.fps=12
    def freeze():bpy.data.objects['CTRL / character anchor'].animation_data_clear()
    def material():
        node=next(node for mat in bpy.data.materials if mat.node_tree for node in mat.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
        node.inputs['Roughness'].default_value+=.07
    controls=[('animated camera',0,camera),('model geometry',0,geometry),('base anchor',0,anchor),
              ('missing alternating paw peak',0,paw),('loop closure',0,closure),('sample clock',1,clock),
              ('frozen UFO glide',1,freeze),('material',1,material)]
    try:
        for name,index,mutate in controls:
            restore();bpy.ops.wm.open_mainfile(filepath=str(files[index]));mutate()
            bpy.context.preferences.filepaths.save_version=0
            bpy.ops.wm.save_as_mainfile(filepath=str(files[index]),compress=True)
            try:check(render=False)
            except AssertionError as error:print('REJECTED native '+name+': '+str(error),flush=True)
            else:raise AssertionError('native control escaped: '+name)
    finally:
        restore();assert all(path.read_bytes()==data for path,data in backup.items()),'native restore mismatch'
        print('Both actual Blender sources restored byte-for-byte',flush=True)
    check(render=False)


if __name__=='__main__':main()

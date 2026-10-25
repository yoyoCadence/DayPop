"""Protect exact published paw paths and frozen body/head/tail, restoring source."""
import bpy
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from check_sources import check


def main():
    m=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'));path=ROOT/m['source'];backup=path.read_bytes()
    def trajectory():
        bpy.context.scene.frame_set(3);obj=bpy.data.objects['CTRL / paw 0'];obj.delta_location.z=0;obj.keyframe_insert('delta_location',frame=3)
    def animation():bpy.data.objects['CTRL / head'].keyframe_insert('delta_location',frame=1)
    def head():bpy.data.objects['CTRL / head'].delta_location.z+=.01
    def body():bpy.data.objects['CTRL / breath'].delta_scale.z-=.01
    def tail():bpy.data.objects['CTRL / tail'].delta_rotation_euler.y+=.03
    def camera():bpy.context.scene.camera.data.ortho_scale*=1.01
    def material():
        node=next(node for mat in bpy.data.materials if mat.node_tree for node in mat.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
        node.inputs['Roughness'].default_value+=.07
    def closure():
        bpy.context.scene.frame_set(9);obj=bpy.data.objects['CTRL / paw 1'];obj.delta_location.z=.02;obj.keyframe_insert('delta_location',frame=9)
    controls=[('paw trajectory',trajectory),('hidden head keys',animation),('static head change',head),('body scale',body),
              ('tail pose',tail),('camera',camera),('material',material),('closure trajectory',closure)]
    try:
        for label,mutate in controls:
            path.write_bytes(backup);bpy.ops.wm.open_mainfile(filepath=str(path));mutate()
            bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
            try:check(render=False)
            except AssertionError as error:print('REJECTED native '+label+': '+str(error),flush=True)
            else:raise AssertionError('native control escaped: '+label)
    finally:
        path.write_bytes(backup);assert path.read_bytes()==backup,'native restore mismatch'
        print('Actual Blender source restored byte-for-byte',flush=True)
    check(render=False)


if __name__=='__main__':main()

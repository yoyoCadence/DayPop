"""Keep DP-203's exact paw keys; freeze the other existing controls at phase 0."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PREVIOUS=ROOT.parents[1]/'2026-10-25/motion-feasibility'


def main():
    previous=json.loads((PREVIOUS/'manifest.json').read_text(encoding='utf8'))
    char=next(c for c in previous['characters'] if c['id']=='moon_cat')
    source=PREVIOUS/char['source']
    assert hashlib.sha256(source.read_bytes()).hexdigest()==char['sha256'][char['source']],'published full-step source changed'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update()
    paws={'CTRL / paw 0','CTRL / paw 1'}
    for obj in scene.objects:
        if obj.name not in paws:obj.animation_data_clear()
    for mesh in bpy.data.meshes:
        if mesh.shape_keys:mesh.shape_keys.animation_data_clear()
    scene.timeline_markers.clear()
    scene.timeline_markers.new('paw_step_local start',frame=1)
    scene.timeline_markers.new('paw_step_local closure',frame=9)
    scene['status']='DP-204 localized seated paw-step trial; not integrated or owner motion approved'
    scene['clips']='Only existing paw controls keep DP-203 keys, 8 x 100ms + frame9 closure; not standing walking'
    frames=[]
    for frame in range(1,9):
        scene.frame_set(frame)
        output=ROOT/'frames'/f'{frame-1:03}.png';output.parent.mkdir(parents=True,exist_ok=True)
        scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
        frames.append(output.relative_to(ROOT).as_posix())
    scene.frame_set(1);bpy.context.view_layer.update()
    camera={'matrix':[list(row) for row in scene.camera.matrix_world],'scale':scene.camera.data.ortho_scale}
    assert camera==char['camera']
    output=ROOT/'source/moon_cat.blend';output.parent.mkdir(exist_ok=True)
    scene.render.filepath='//../frames/'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
    manifest={'task':'DP-204','sourceCommit':'aab6561aa4599f8ff77a62c2fa436a8be57fca9b',
        'appIntegrated':False,'productionReady':False,'ownerMotionApproved':False,'fullCatWalkImplemented':False,
        'id':'moon_cat','motion':'paw_step_local','inputSource':'../../2026-10-25/motion-feasibility/'+char['source'],
        'inputSourceSha256':char['sha256'][char['source']], 'source':'source/moon_cat.blend',
        'camera':camera,'anchor':char['anchor'],'frames':frames,'durationMs':800,'frameDurationMs':100,'closureFrame':9,
        'animatedControls':sorted(paws)}
    (ROOT/'render-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    print('DP-204 exact published paw keys retained; eight real local-motion PNGs and native source written',flush=True)


if __name__=='__main__':main()

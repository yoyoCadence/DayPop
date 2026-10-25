"""Fixed full-sample local-motion candidate accounting and real decoded image gates."""
import json
from PIL import Image
from contract import ROOT,PREVIOUS,LIMIT,QUALITY,baseline,sha,decode,measure,quality_ok


def check():
    m=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    assert m['task']=='DP-204' and m['id']=='moon_cat' and m['motion']=='paw_step_local'
    assert all(m[key] is False for key in ('appIntegrated','productionReady','ownerMotionApproved','fullCatWalkImplemented')),'do not claim product/owner acceptance'
    assert m['sourceCommit']=='aab6561aa4599f8ff77a62c2fa436a8be57fca9b'
    prior=next(c for c in json.loads((PREVIOUS/'manifest.json').read_text(encoding='utf8'))['characters'] if c['id']=='moon_cat')
    assert m['inputSource']=='../../2026-10-25/motion-feasibility/'+prior['source']
    assert m['inputSourceSha256']==sha(ROOT/m['inputSource'])==prior['sha256'][prior['source']],'published native provenance'
    assert m['camera']==prior['camera'] and m['anchor']==prior['anchor']
    assert m['animatedControls']==['CTRL / paw 0','CTRL / paw 1']
    assert m['policy']=={'characterLimitBytes':LIMIT,'qualityLimit':QUALITY,'indices':list(range(8)),'durationsMs':[100]*8,'alphaQuality':100},'unchanged full-sample policy'
    assert m['frames']==[f'frames/{index:03}.png' for index in range(8)] and m['source']=='source/moon_cat.blend'
    assert m['frameDurationMs']==100 and m['durationMs']==800 and m['closureFrame']==9
    frames=[]
    for name in m['frames']:
        assert (ROOT/name).is_file(),'missing native frame'
        with Image.open(ROOT/name) as image:
            assert image.format=='PNG' and image.n_frames==1 and image.size==(120,120) and image.mode=='RGBA'
            frame=image.copy()
        for size,margin in ((120,8),(60,4)):
            box=frame.resize((size,size),Image.Resampling.LANCZOS).getchannel('A').getbbox()
            assert box and min(box[:2])>=margin and max(box[2:])<=size-margin,'unsafe native PNG'
        frames.append(frame)
    assert len({frame.tobytes() for frame in frames})==5,'expected five unique poses in eight full samples'
    assert frames[0].tobytes()==Image.open(PREVIOUS/prior['frames'][0]).convert('RGBA').tobytes(),'same native start pose'
    assert m['static']=='previews/static.png' and Image.open(ROOT/m['static']).convert('RGBA').tobytes()==frames[0].tobytes()
    assert m['sixStateHypotheticalBytes']==baseline()==185848 and set(m['candidates'])=={'q85','q75'}
    assert m['recommended']=='q85','prefer higher quality when both fit'
    own={m['source'],*m['frames'],m['static']};expected=set(own)
    for name,item in m['candidates'].items():
        assert item['path']==f'previews/paw-step-local-{name}.webp'
        path=ROOT/item['path'];assert path.is_file(),'missing encoded candidate'
        assert item['bytes']==path.stat().st_size and item['sha256']==sha(path),'candidate bytes/hash'
        metrics=measure(path,frames)
        assert metrics['decodedDurationsMs']==[100]*8,'eight full native samples required'
        assert metrics==item['measurement'],'actual decoded timeline measurement'
        assert item['qualityEligible'] is quality_ok(metrics),'quality eligibility'
        assert item['qualityEligible'],'full-sample candidate quality'
        total=baseline()+path.stat().st_size
        assert item['hypotheticalPackageBytes']==total and item['remainingBytes']==LIMIT-total,'hypothetical package accounting'
        assert item['packageEligible'] is (total<=LIMIT) and item['packageEligible'],'package limit/eligibility'
        expected.add(item['path'])
    assert set(m['sha256'])==own and all(sha(ROOT/name)==digest for name,digest in m['sha256'].items()),'native artifacts/hash'
    actual={path.relative_to(ROOT).as_posix() for folder in ('source','frames','previews') for path in (ROOT/folder).rglob('*') if path.is_file()}
    assert actual==expected,'complete local-step inventory'
    print('LOCAL STEP PASS',[(name,item['bytes'],item['hypotheticalPackageBytes']) for name,item in m['candidates'].items()],flush=True)


if __name__=='__main__':check()

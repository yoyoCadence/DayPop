"""Validate actual source samples, decoded phases and honest rejected budget trials."""
import json
from PIL import Image
from contract import ROOT,KINDS,PLANS,LIMIT,QUALITY,baseline,sha,measure,quality_ok,decode


def check():
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    assert manifest['task']=='DP-203' and manifest['appIntegrated'] is False and manifest['productionReady'] is False
    assert manifest['fullCatWalkImplemented'] is False and manifest['ownerMotionApproved'] is False,'trial must not claim accepted full walking'
    assert manifest['sourceCommit']=='96b3836991affc3c471b1189a445d54082ad614f'
    assert manifest['preparationCommit']=='dd1004555410a51cf0358086bd26338e4e169522'
    policy=manifest['policy']
    assert policy=={'characterLimitBytes':LIMIT,'qualityLimit':QUALITY,'plans':{k:list(v) for k,v in PLANS.items()},
                    'budgetIsHypothetical':True,'catStudyIsNotFullWalking':True},'trial policy changed'
    assert [c['id'] for c in manifest['characters']]==list(KINDS)
    expected=set()
    for char in manifest['characters']:
        kind=char['id'];motion='paw_step' if kind=='moon_cat' else 'glide'
        assert char['motion']==motion,'honest motion names'
        assert char['frameDurationMs']==100 and char['durationMs']==800 and char['closureFrame']==9
        frames=[f'frames/{kind}/{i:03}.png' for i in range(8)]
        assert char['frames']==frames and char['source']==f'source/{kind}.blend' and char['static']==f'previews/{kind}/static.png'
        published_folder=ROOT.parents[1]/'2026-10-23/motion'
        prior=next(c for c in json.loads((published_folder/'manifest.json').read_text(encoding='utf8'))['characters'] if c['id']==kind)
        assert char['inputSource']=='../../2026-10-23/motion/'+prior['source']
        assert char['inputSourceSha256']==sha(ROOT/char['inputSource'])==prior['sha256'][prior['source']],'published native provenance'
        assert char['camera']==prior['camera'] and char['anchor']==prior['anchor'],'fixed native camera/anchor'
        source=[]
        for name in frames:
            assert (ROOT/name).is_file(),'missing native PNG'
            with Image.open(ROOT/name) as image:
                assert image.format=='PNG' and image.n_frames==1 and image.mode=='RGBA' and image.size==(120,120),'source PNG contract'
                frame=image.copy()
            for size,margin in ((120,8),(60,4)):
                box=frame.resize((size,size),Image.Resampling.LANCZOS).getchannel('A').getbbox()
                assert box and min(box[:2])>=margin and max(box[2:])<=size-margin,f'unsafe native {kind} {name} {size}px {box}'
            source.append(frame)
        assert len({im.tobytes() for im in source})>=6,'frozen native motion'
        assert Image.open(ROOT/char['static']).convert('RGBA').tobytes()==source[0].tobytes(),'real static substitute'
        total=baseline(kind);assert char['sixStateHypotheticalBytes']==total
        assert set(char['candidates'])==set(PLANS),'candidate inventory'
        own={char['source'],*frames,char['static']}
        for plan,(_,step) in PLANS.items():
            item=char['candidates'][plan];path=ROOT/item['path']
            assert item['path']==f'previews/{kind}/{motion}-{plan}.webp'
            assert path.is_file(),'missing candidate image'
            assert item['indices']==list(range(0,8,step)),'held phase indices'
            assert item['bytes']==path.stat().st_size and item['sha256']==sha(path),'candidate bytes/hash'
            decoded=decode(path)
            assert all(start%(100*step)==0 and duration%(100*step)==0 for start,duration,_ in decoded),'held phase boundaries'
            metrics=measure(path,source)
            assert metrics==item['measurement'],'actual decoded timeline measurement'
            assert item['qualityEligible'] is quality_ok(metrics),'quality eligibility'
            assert metrics['maxMatchedFrameAlphaError']==0,'matched source phase/alpha changed'
            if plan!='q75-held':assert item['qualityEligible'],'full-sample motion must pass quality'
            package=total+path.stat().st_size
            assert item['hypotheticalPackageBytes']==package and item['remainingBytes']==LIMIT-package,'hypothetical package accounting'
            assert item['packageEligible'] is (package<=LIMIT),'package eligibility'
            expected.add(item['path'])
        assert set(char['sha256'])==own and all(sha(ROOT/name)==digest for name,digest in char['sha256'].items()),'source artifacts/hash'
        expected|=own
        print('MOTION PASS',kind,motion,{key:(value['bytes'],value['qualityEligible'],value['packageEligible']) for key,value in char['candidates'].items()},flush=True)
    actual={path.relative_to(ROOT).as_posix() for folder in ('frames','previews','source') for path in (ROOT/folder).rglob('*') if path.is_file()}
    assert actual==expected,'complete artifact inventory'


if __name__=='__main__':check()

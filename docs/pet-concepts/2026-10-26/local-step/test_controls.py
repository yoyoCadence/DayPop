"""Real bad clips and false full-sample/budget/provenance claims must fail."""
import copy
import json
import subprocess
import sys
from PIL import Image
from contract import ROOT,LIMIT,sha,measure,quality_ok
from check_local_step import check


def main():
    original=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    paths={ROOT/'manifest.json',*[ROOT/name for name in original['sha256']],*[ROOT/item['path'] for item in original['candidates'].values()]}
    backup={path:path.read_bytes() for path in paths}
    def restore():
        for path,data in backup.items():path.write_bytes(data)
    def source(m):return [Image.open(ROOT/name).convert('RGBA') for name in m['frames']]
    def path(m):return ROOT/m['candidates']['q85']['path']
    def refresh(m,metrics=False):
        item=m['candidates']['q85'];p=path(m);total=m['sixStateHypotheticalBytes']+p.stat().st_size
        item.update(bytes=p.stat().st_size,sha256=sha(p),hypotheticalPackageBytes=total,remainingBytes=LIMIT-total,packageEligible=total<=LIMIT)
        if metrics:item['measurement']=measure(p,source(m));item['qualityEligible']=quality_ok(item['measurement'])
    def encode(m,frames,durations,loop=0):
        frames[0].save(path(m),format='WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=loop,
                       quality=85,alpha_quality=100,method=6,minimize_size=False)
    def missing(m):path(m).unlink()
    def frozen(m):source(m)[0].save(path(m),format='WEBP',quality=85,alpha_quality=100);refresh(m)
    def loop(m):encode(m,source(m),[100]*8,loop=1);refresh(m)
    def duration(m):encode(m,source(m),[200]+[100]*7);refresh(m)
    def held(m):encode(m,source(m)[::2],[200]*4);refresh(m,metrics=True)
    def phase(m):
        frames=source(m);encode(m,frames[1:]+frames[:1],[100]*8);refresh(m,metrics=True)
    def unsafe(m):
        p=ROOT/m['frames'][0];image=Image.open(p).convert('RGBA');image.putpixel((0,60),(0,0,0,1));image.save(p,optimize=True)
        m['sha256'][m['frames'][0]]=sha(p)
    def provenance(m):m['inputSourceSha256']='0'*64
    def excess(m):
        p=path(m);target=LIMIT-m['sixStateHypotheticalBytes']+1;p.write_bytes(p.read_bytes()+b'\0'*(target-p.stat().st_size));refresh(m,metrics=True)
        m['candidates']['q85']['packageEligible']=True
    def policy(m):m['policy']['characterLimitBytes']+=1
    def accepted(m):m['ownerMotionApproved']=True
    def total(m):m['candidates']['q85']['hypotheticalPackageBytes']-=1
    def recommendation(m):m['recommended']='q75'
    controls=[('missing candidate',missing),('frozen static',frozen),('finite loop',loop),('wrong total duration',duration),
              ('held samples instead of eight',held),('shifted native phase',phase),('source border alpha=1',unsafe),
              ('forged published source',provenance),('actual package excess with false acceptance',excess),
              ('relaxed policy',policy),('false owner acceptance',accepted),('forged package total',total),('silent recommendation change',recommendation)]
    try:
        for label,mutate in controls:
            restore();m=copy.deepcopy(original);mutate(m);(ROOT/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf8')
            run=subprocess.run([sys.executable,'-X','utf8',str(ROOT/'check_local_step.py')],capture_output=True,encoding='utf8')
            assert run.returncode and 'AssertionError' in run.stderr,(label,run.stdout,run.stderr)
            print('REJECTED '+label+': '+run.stderr.splitlines()[-1],flush=True)
    finally:
        restore();assert all(path.read_bytes()==data for path,data in backup.items()),'restore mismatch'
        print('All',len(backup),'local-step artifacts restored byte-for-byte',flush=True)
    check()


if __name__=='__main__':main()

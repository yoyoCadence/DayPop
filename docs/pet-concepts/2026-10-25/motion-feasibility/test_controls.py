"""Reject real broken clips, unsafe source pixels and false acceptance claims."""
import copy
import json
import subprocess
import sys
from PIL import Image
from contract import ROOT,PLANS,LIMIT,sha,measure,quality_ok
from check_motion import check


def main():
    original=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    paths={ROOT/'manifest.json'}
    for char in original['characters']:
        paths|={ROOT/name for name in char['sha256']}
        paths|={ROOT/item['path'] for item in char['candidates'].values()}
    backup={path:path.read_bytes() for path in paths}
    def restore():
        for path,data in backup.items():path.write_bytes(data)
    def image_path(m,index=0):return ROOT/m['characters'][index]['candidates']['q75-full']['path']
    def source(m,index=0):return [Image.open(ROOT/name).convert('RGBA') for name in m['characters'][index]['frames']]
    def refresh(m,index=0,metrics=True):
        char=m['characters'][index];item=char['candidates']['q75-full'];path=image_path(m,index)
        item.update(bytes=path.stat().st_size,sha256=sha(path))
        total=char['sixStateHypotheticalBytes']+item['bytes']
        item.update(hypotheticalPackageBytes=total,remainingBytes=LIMIT-total,packageEligible=total<=LIMIT)
        if metrics:
            item['measurement']=measure(path,source(m,index));item['qualityEligible']=quality_ok(item['measurement'])
    def encode(m,frames,durations,loop=0):
        frames[0].save(image_path(m),format='WEBP',save_all=True,append_images=frames[1:],duration=durations,
                       loop=loop,quality=75,alpha_quality=100,method=6,minimize_size=False)
    def missing(m):image_path(m).unlink()
    def frozen(m):
        source(m)[0].save(image_path(m),format='WEBP',quality=75,alpha_quality=100);refresh(m,metrics=False)
    def loop(m):encode(m,source(m),[100]*8,loop=1);refresh(m,metrics=False)
    def duration(m):encode(m,source(m),[200]+[100]*7);refresh(m,metrics=False)
    def phase(m):
        frames=source(m);encode(m,frames[1:]+frames[:1],[100]*8);refresh(m)
    def border(m):
        char=m['characters'][0];path=ROOT/char['frames'][0]
        image=Image.open(path).convert('RGBA');image.putpixel((0,60),(0,0,0,1));image.save(path,optimize=True)
        char['sha256'][char['frames'][0]]=sha(path)
    def budget(m):m['characters'][0]['candidates']['q75-full']['packageEligible']=True
    def quality(m):m['characters'][0]['candidates']['q75-held']['qualityEligible']=True
    def policy(m):m['policy']['characterLimitBytes']+=1
    def provenance(m):m['characters'][0]['inputSourceSha256']='0'*64
    def label(m):m['characters'][0]['motion']='walk'
    def excess(m):
        path=image_path(m,1);target=LIMIT-m['characters'][1]['sixStateHypotheticalBytes']+1
        path.write_bytes(path.read_bytes()+b'\0'*(target-path.stat().st_size));refresh(m,1)
        m['characters'][1]['candidates']['q75-full']['packageEligible']=True
    controls=[('missing candidate',missing),('frozen static WebP',frozen),('finite loop',loop),('wrong duration',duration),
        ('same-duration shifted source phase',phase),('native border alpha=1',border),('false cat budget acceptance',budget),
        ('false held-frame quality acceptance',quality),('weakened trial policy',policy),('forged native provenance',provenance),
        ('paw-step falsely labeled walking',label),('real package excess with false acceptance',excess)]
    try:
        for name,mutate in controls:
            restore();m=copy.deepcopy(original);mutate(m)
            (ROOT/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf8')
            run=subprocess.run([sys.executable,'-X','utf8',str(ROOT/'check_motion.py')],capture_output=True,encoding='utf8')
            assert run.returncode and 'AssertionError' in run.stderr,(name,run.stdout,run.stderr)
            print('REJECTED '+name+': '+run.stderr.splitlines()[-1],flush=True)
    finally:
        restore();assert all(path.read_bytes()==data for path,data in backup.items()),'restore mismatch'
        print('All',len(backup),'motion artifacts restored byte-for-byte',flush=True)
    check()


if __name__=='__main__':main()

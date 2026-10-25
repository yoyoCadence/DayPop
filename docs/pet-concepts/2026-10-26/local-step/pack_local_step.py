"""Full eight samples only, preserving timing and alpha; no held trial."""
import io
import json
from PIL import Image,__version__
from contract import ROOT,LIMIT,QUALITY,baseline,sha,measure,quality_ok

m=json.loads((ROOT/'render-manifest.json').read_text(encoding='utf8'))
frames=[Image.open(ROOT/name).convert('RGBA') for name in m['frames']]
m.update(pillowVersion=__version__,sixStateHypotheticalBytes=baseline(),recommended='q85',
    policy={'characterLimitBytes':LIMIT,'qualityLimit':QUALITY,'indices':list(range(8)),'durationsMs':[100]*8,'alphaQuality':100},candidates={})
for quality in (85,75):
    variants={}
    for minimize in (False,True):
        buffer=io.BytesIO()
        frames[0].save(buffer,format='WEBP',save_all=True,append_images=frames[1:],duration=[100]*8,loop=0,
            quality=quality,alpha_quality=100,method=6,minimize_size=minimize)
        variants[minimize]=buffer.getvalue()
    minimize=min(variants,key=lambda key:len(variants[key]))
    path=ROOT/'previews'/f'paw-step-local-q{quality}.webp';path.parent.mkdir(exist_ok=True);path.write_bytes(variants[minimize])
    metrics=measure(path,frames);total=baseline()+path.stat().st_size
    m['candidates'][f'q{quality}']={'path':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path),
        'minimizeSize':minimize,'measurement':metrics,'qualityEligible':quality_ok(metrics),'packageEligible':total<=LIMIT,
        'hypotheticalPackageBytes':total,'remainingBytes':LIMIT-total}
    print('local step',quality,path.stat().st_size,'hypothetical',total,'remaining',LIMIT-total,'quality',quality_ok(metrics),flush=True)
static=ROOT/'previews/static.png';frames[0].save(static,optimize=True);m['static']='previews/static.png'
m['sha256']={path:sha(ROOT/path) for path in [m['source'],*m['frames'],m['static']]}
(ROOT/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf8')

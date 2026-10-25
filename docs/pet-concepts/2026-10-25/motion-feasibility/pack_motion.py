"""Encode bounded full/held trials and measure all eight original timepoints."""
import io
import json
from PIL import Image, __version__
from contract import ROOT,PLANS,LIMIT,QUALITY,baseline,sha,measure,quality_ok


def main():
    manifest=json.loads((ROOT/'render-manifest.json').read_text(encoding='utf8'))
    manifest.update(pillowVersion=__version__,preparationCommit='dd1004555410a51cf0358086bd26338e4e169522',
        policy={'characterLimitBytes':LIMIT,'qualityLimit':QUALITY,'plans':{k:list(v) for k,v in PLANS.items()},
                'budgetIsHypothetical':True,'catStudyIsNotFullWalking':True})
    for char in manifest['characters']:
        frames=[Image.open(ROOT/path).convert('RGBA') for path in char['frames']]
        char['sixStateHypotheticalBytes']=baseline(char['id'])
        char['candidates']={}
        for name,(quality,step) in PLANS.items():
            selected=frames[::step];variants={}
            for minimize in (False,True):
                buffer=io.BytesIO()
                selected[0].save(buffer,format='WEBP',save_all=True,append_images=selected[1:],duration=[100*step]*len(selected),
                    loop=0,quality=quality,alpha_quality=100,method=6,minimize_size=minimize)
                variants[minimize]=buffer.getvalue()
            minimize=min(variants,key=lambda k:len(variants[k]))
            path=ROOT/'previews'/char['id']/f'{char["motion"]}-{name}.webp'
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(variants[minimize])
            metrics=measure(path,frames);total=char['sixStateHypotheticalBytes']+path.stat().st_size
            char['candidates'][name]={'path':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path),
                'indices':list(range(0,8,step)),'minimizeSize':minimize,'measurement':metrics,
                'qualityEligible':quality_ok(metrics),'packageEligible':total<=LIMIT,'hypotheticalPackageBytes':total,'remainingBytes':LIMIT-total}
            print(char['id'],name,path.stat().st_size,'package',total,'remaining',LIMIT-total,
                  'quality',quality_ok(metrics),flush=True)
        still=ROOT/'previews'/char['id']/'static.png';frames[0].save(still,optimize=True)
        char['static']=still.relative_to(ROOT).as_posix()
        char['sha256']={path:sha(ROOT/path) for path in [char['source'],*char['frames'],char['static']]}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()

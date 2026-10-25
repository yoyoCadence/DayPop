"""Fixed eight-sample feasibility studies; budget is hypothetical, never App policy."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT=Path(__file__).resolve().parent
KINDS=('moon_cat','orbit_ufo')
PLANS={'q85-full':(85,1),'q75-full':(75,1),'q75-held':(75,2)}
LIMIT=196608
QUALITY=.008


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def baseline(kind):
    folder=ROOT.parent/'sit'
    spec=importlib.util.spec_from_file_location('dp202_fixed_budget',folder/'contract.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    char=next(c for c in json.loads((folder/'manifest.json').read_text(encoding='utf8'))['characters'] if c['id']==kind)
    item=char['candidates']['rgb128'];path=folder/item['path']
    assert sha(path)==item['sha256'] and item['eligible'],'sit baseline changed'
    total=module.baseline(kind)+path.stat().st_size
    assert total=={'moon_cat':185848,'orbit_ufo':160369}[kind], 'fixed six-state hypothetical baseline'
    return total


def decode(path):
    frames=[];elapsed=0
    with Image.open(path) as image:
        assert image.format=='WEBP' and image.is_animated and image.n_frames>1,'must be animated WebP'
        assert image.info.get('loop')==0,'must loop continuously'
        for index in range(image.n_frames):
            image.seek(index);frame=image.convert('RGBA');frame.load()
            duration=image.info['duration']
            assert frame.size==(120,120),'wrong canvas'
            assert type(duration) is int and duration>0 and duration%100==0,'invalid sampled duration'
            frames.append((elapsed,duration,frame.copy()));elapsed+=duration
    assert elapsed==800,'wrong loop duration'
    return frames


def at(frames, instant):return next(frame for start,duration,frame in frames if start<=instant<start+duration)


def measure(path, source):
    frames=decode(path)
    result={'decodedFrames':len(frames),'decodedDurationsMs':[d for _,d,_ in frames], 'durationMs':800,
        'maxMatchedFrameAlphaError':max(ImageChops.difference(source[start//100].getchannel('A'),frame.getchannel('A')).getextrema()[1] for start,_,frame in frames)}
    for size,margin in ((120,8),(60,4)):
        originals=[frame.resize((size,size),Image.Resampling.LANCZOS) for frame in source]
        encoded=[at(frames,t).resize((size,size),Image.Resampling.LANCZOS) for t in range(0,800,100)]
        boxes=[frame.getchannel('A').getbbox() for frame in encoded]
        result[f'alphaSafe{size}']=all(box and min(box[:2])>=margin and max(box[2:])<=size-margin for box in boxes)
        result[f'maxTimelineAlphaError{size}']=max(ImageChops.difference(a.getchannel('A'),b.getchannel('A')).getextrema()[1] for a,b in zip(originals,encoded))
        for matte,color in (('light','#f5f3ee'),('dark','#111827')):
            bg=Image.new('RGBA',(size,size),color)
            errors=[]
            for a,b in zip(originals,encoded):
                aa,bb=[Image.alpha_composite(bg,frame).convert('RGB') for frame in (a,b)]
                errors.append(sum(ImageStat.Stat(ImageChops.difference(aa,bb)).sum)/(size*size*3*255))
            result[f'{matte}MaxTimelineMAE{size}']=max(errors)
            result[f'{matte}WorstTimelineMs{size}']=errors.index(max(errors))*100
    return result


def quality_ok(metrics):
    return all(metrics[f'alphaSafe{s}'] for s in (120,60)) and metrics['maxMatchedFrameAlphaError']==0 and all(value<QUALITY for key,value in metrics.items() if 'MaxTimelineMAE' in key)

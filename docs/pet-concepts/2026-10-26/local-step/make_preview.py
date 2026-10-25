"""Show changed motion scope at equal source timepoints, native 120/60 sizes."""
import json
import sys
from PIL import Image,ImageDraw
from contract import ROOT,PREVIOUS,decode,at

sys.path.insert(0,str(ROOT.parents[1]/'2026-10-23'))
from make_board import font

m=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
prior=next(c for c in json.loads((PREVIOUS/'manifest.json').read_text(encoding='utf8'))['characters'] if c['id']=='moon_cat')
for dark in (False,True):
    background,ink=('#111827','#f3f4f6') if dark else ('#f5f3ee','#182037')
    board=Image.new('RGB',(1000,660),background);draw=ImageDraw.Draw(board)
    draw.text((24,16),'DP-204 | same paw trajectory; changed body motion | 120px + 60px',font=font(21),fill=ink)
    for row,instant in enumerate((100,500)):
        y=72+row*280;draw.text((24,y),f'{instant}ms | full response / local source / local encodings',font=font(21),fill=ink)
        samples=[Image.open(PREVIOUS/prior['frames'][instant//100]).convert('RGBA'),Image.open(ROOT/m['frames'][instant//100]).convert('RGBA')]
        samples += [at(decode(ROOT/m['candidates'][key]['path']),instant) for key in ('q85','q75')]
        for col,(frame,label) in enumerate(zip(samples,['DP-203 source','Local source','Local Q85','Local Q75'])):
            x=24+col*245;board.paste(frame,(x,y+36),frame)
            small=frame.resize((60,60),Image.Resampling.LANCZOS);board.paste(small,(x+128,y+88),small)
            draw.text((x,y+175),label,font=font(18),fill=ink)
    board.save(ROOT/('comparison-dark.png' if dark else 'comparison-light.png'),optimize=True)
print('Same-time source scope and local Q85/Q75 comparisons written')

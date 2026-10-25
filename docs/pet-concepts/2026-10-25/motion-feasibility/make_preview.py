"""Native-size source contact sheet and same-timepoint lossy comparisons."""
import json
import sys
from PIL import Image,ImageDraw
from contract import ROOT,PLANS,decode,at

sys.path.insert(0,str(ROOT.parents[1]/'2026-10-23'))
from make_board import font

manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
for dark in (False,True):
    background,ink=('#111827','#f3f4f6') if dark else ('#f5f3ee','#182037')
    board=Image.new('RGB',(1000,1000),background);draw=ImageDraw.Draw(board)
    draw.text((24,16),'DP-203 | actual native PNG frames | 120px + true 60px',font=font(23),fill=ink)
    comparison=Image.new('RGB',(1000,660),background);cdraw=ImageDraw.Draw(comparison)
    cdraw.text((24,16),'Same source instant | 120px + true 60px | held trial rejected',font=font(22),fill=ink)
    for row,char in enumerate(manifest['characters']):
        label='seated step; not full walking' if char['id']=='moon_cat' else 'native root tilt/glide'
        draw.text((24,58+row*460),char['id']+' / '+char['motion']+' / '+label,font=font(19),fill=ink)
        source=[Image.open(ROOT/path).convert('RGBA') for path in char['frames']]
        for index,frame in enumerate(source):
            x=24+(index%4)*245;y=98+row*460+(index//4)*205
            board.paste(frame,(x,y),frame)
            small=frame.resize((60,60),Image.Resampling.LANCZOS);board.paste(small,(x+128,y+52),small)
            draw.text((x,y+137),str(index*100)+'ms',font=font(18),fill=ink)
        instant=char['candidates']['q75-held']['measurement']['darkWorstTimelineMs120']
        y=72+row*280
        cdraw.text((24,y),char['id']+' / '+str(instant)+'ms',font=font(21),fill=ink)
        samples=[source[instant//100]]+[at(decode(ROOT/char['candidates'][plan]['path']),instant) for plan in PLANS]
        for col,(frame,label) in enumerate(zip(samples,['source PNG',*PLANS])):
            x=24+col*245;comparison.paste(frame,(x,y+35),frame)
            small=frame.resize((60,60),Image.Resampling.LANCZOS);comparison.paste(small,(x+128,y+87),small)
            cdraw.text((x,y+175),label,font=font(19),fill=ink)
    suffix='dark' if dark else 'light'
    board.save(ROOT/f'frames-{suffix}.png',optimize=True)
    comparison.save(ROOT/f'comparison-{suffix}.png',optimize=True)
print('Actual source sheets and same-timepoint comparison boards written')

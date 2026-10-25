"""Static native-size comparison of the worst 120px dark-matte interval."""
import json
import sys
from PIL import Image, ImageDraw
from contract import ROOT, KINDS, STATES, sources, decode, at

sys.path.insert(0, str(ROOT.parents[1] / '2026-10-23'))
from make_board import font

manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
for dark in (False, True):
    background, ink = ('#111827', '#f3f4f6') if dark else ('#f5f3ee', '#182037')
    board = Image.new('RGB', (1100, 1240), background)
    draw = ImageDraw.Draw(board)
    draw.text((24, 14), 'DP-200 | same original timeline instant | 120px + native 60px', font=font(24), fill=ink)
    for row, (kind, state) in enumerate((k, s) for k in KINDS for s in STATES):
        char = next(c for c in manifest['characters'] if c['id'] == kind)
        clip = char['clips'][state]
        instant = clip['candidates']['q35a50']['measurement']['darkWorstTimelineMs120']
        frames = [Image.open(path).convert('RGBA') for path in sources(kind, state)[0]]
        images = [frames[instant//100], at(decode(ROOT / clip['reference']['path']), instant)]
        labels = ['Source 10fps', 'Current Q85/A100']
        for name in ('q75a100', 'q55a70', 'q35a50'):
            images.append(at(decode(ROOT / clip['candidates'][name]['path']), instant))
            labels.append(name)
        y = 65+row*285
        draw.text((24, y), f'{kind} / {state} / {instant}ms', font=font(21), fill=ink)
        for column, (frame, label) in enumerate(zip(images, labels)):
            x = 24+column*218
            board.paste(frame, (x, y+42), frame)
            small = frame.resize((60, 60), Image.Resampling.LANCZOS)
            board.paste(small, (x+128, y+88), small)
            draw.text((x, y+175), label, font=font(17), fill=ink)
    draw.text((24, 1210), 'Lossy color / alpha. Whole-canvas MAE is not perceptual equivalence or owner acceptance.', font=font(16), fill=ink)
    board.save(ROOT / ('comparison-dark.png' if dark else 'comparison-light.png'), optimize=True)
print('Wrote light / dark comparisons')

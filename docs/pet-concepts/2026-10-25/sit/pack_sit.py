"""Package true Blender PNGs and a separate exact-alpha RGB128 experiment."""
import json
import shutil
import sys
from PIL import Image, ImageDraw
from contract import ROOT, PREVIOUS, baseline, sha, measure, eligible

sys.path.insert(0, str(PREVIOUS.parent))
from make_board import font

manifest = json.loads((ROOT / 'render-manifest.json').read_text(encoding='utf8'))
for char in manifest['characters']:
    out = ROOT / 'previews' / char['id']
    out.mkdir(parents=True, exist_ok=True)
    frame = Image.open(ROOT / char['frame']).convert('RGBA')
    raw, encoded, small = [out / name for name in ('sit.png', 'sit-rgb128.png', 'sit-60.png')]
    shutil.copyfile(ROOT / char['frame'], raw)
    candidate = frame.convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
    candidate.putalpha(frame.getchannel('A'))
    candidate.save(encoded, optimize=True)
    frame.resize((60, 60), Image.Resampling.LANCZOS).save(small, optimize=True)
    char['candidates'] = {}
    current = baseline(char['id'])
    for name, path in (('originalPng', raw), ('rgb128', encoded)):
        metrics = measure(path, frame)
        total = current+path.stat().st_size
        char['candidates'][name] = {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
            'sha256': sha(path), 'measurement': metrics, 'sixStatePackageBytes': total,
            'eligible': eligible(metrics, path.stat().st_size, total)}
    char['preview60'] = small.relative_to(ROOT).as_posix()
    char['baselinePackageBytes'] = current
    char['characterLimitBytes'] = 196608
    char['remainingWithRgb128'] = 196608-char['candidates']['rgb128']['sixStatePackageBytes']
    paths = [char['source'], char['frame'], char['preview60'], *[item['path'] for item in char['candidates'].values()]]
    char['sha256'] = {path: sha(ROOT / path) for path in paths}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')

for dark in (False, True):
    bg, ink = ('#111827', '#f3f4f6') if dark else ('#f5f3ee', '#182037')
    board = Image.new('RGB', (900, 660), bg)
    draw = ImageDraw.Draw(board)
    draw.text((24, 16), 'sit native study | original / relaxed / RGB128 | 120px + 60px', font=font(23), fill=ink)
    for row, char in enumerate(manifest['characters']):
        y = 80+row*280
        draw.text((24, y), char['id'], font=font(22), fill=ink)
        paths = [ROOT / char['idleReference'], ROOT / char['frame'], ROOT / char['candidates']['rgb128']['path']]
        for column, (label, path) in enumerate(zip(('Original idle', 'Native sit', 'RGB128 / exact alpha'), paths)):
            image = Image.open(path).convert('RGBA')
            x = 24+column*290
            board.paste(image, (x, y+42), image)
            small = image.resize((60, 60), Image.Resampling.LANCZOS)
            board.paste(small, (x+140, y+90), small)
            draw.text((x, y+185), label, font=font(18), fill=ink)
    board.save(ROOT / ('comparison-dark.png' if dark else 'comparison-light.png'), optimize=True)
print(json.dumps({c['id']: {'candidates': {k: {'bytes': v['bytes'], 'sixStatePackageBytes': v['sixStatePackageBytes'], 'eligible': v['eligible']} for k,v in c['candidates'].items()}, 'remaining':c['remainingWithRgb128']} for c in manifest['characters']}))

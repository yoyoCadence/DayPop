"""Encode and inspect actual Blender renders; requires Pillow. Does not draw pets."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
KEYS = {'cat': 'marshmallow-cat', 'bear': 'honey-bear', 'bunny': 'peach-bunny'}
POSES = [('idle', 12, 180), ('walk', 8, 100), ('look', 10, 160),
         ('sit', 1, 100), ('sleep', 8, 300), ('jump', 10, 100), ('grab', 1, 100)]


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(image):
    assert image.size == (120, 120), image.size
    assert image.mode == 'RGBA', image.mode
    bounds = image.getchannel('A').getbbox()
    assert bounds and bounds[0] >= 8 and bounds[1] >= 8 and bounds[2] <= 112 and bounds[3] <= 112, bounds
    assert (bounds[2] - bounds[0]) >= 30 and (bounds[3] - bounds[1]) >= 55, bounds
    return list(bounds)


def main():
    package = ROOT / 'package'; package.mkdir(exist_ok=True)
    entries, sources = [], []
    for kind, key in KEYS.items():
        source = ROOT / 'source' / f'{kind}.blend'
        assert source.stat().st_size > 10000
        sources.append({'path': str(source.relative_to(ROOT)), 'sha256': digest(source)})
        total = 0
        for pose, count, duration in POSES:
            frames = [Image.open(ROOT / 'renders' / kind / f'{pose}-{i:02d}.png').convert('RGBA') for i in range(count)]
            for frame in frames: inspect(frame)
            if count > 1:
                path = package / f'{key}-{pose}.webp'
                frames[0].save(path, save_all=True, append_images=frames[1:], duration=duration,
                               loop=1 if pose in ['look', 'jump'] else 0, quality=85, method=6, minimize_size=True)
                decoded = Image.open(path)
                assert decoded.n_frames > 1
                for i in range(decoded.n_frames):
                    decoded.seek(i); inspect(decoded.convert('RGBA'))
                assert path.stat().st_size <= {'idle': 131072, 'walk': 49152, 'look': 49152, 'sleep': 65536, 'jump': 32768}[pose]
                total += path.stat().st_size
                entries.append({'kind': key, 'pose': pose, 'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                                'sha256': digest(path), 'frames': decoded.n_frames, 'durationMs': count * duration, 'loop': decoded.info.get('loop')})
            if pose in ['idle', 'sit', 'sleep', 'grab']:
                path = package / f'{key}-{pose}.png'
                frames[0].save(path, optimize=True)
                assert path.stat().st_size <= 16384
                total += path.stat().st_size
                entries.append({'kind': key, 'pose': pose, 'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                                'sha256': digest(path), 'frames': 1, 'bounds': inspect(frames[0])})
        assert total <= 196608, (key, total)
        print(key, total, 'bytes')
    manifest = {'blenderVersion': '5.2.3', 'canvas': [120, 120], 'display': [60, 60], 'minimumTransparentMargin': 8,
                'source': sources, 'assets': entries}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    board = Image.new('RGB', (1080, 560), '#f5f0e9')
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 24)
    small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
    for column, (kind, key) in enumerate(KEYS.items()):
        x = column * 360
        draw.rounded_rectangle((x + 12, 16, x + 348, 544), radius=28, fill='#fffcf7')
        beauty = Image.open(ROOT / 'renders' / kind / 'beauty.png').convert('RGBA').resize((350, 350), Image.Resampling.LANCZOS)
        board.paste(beauty, (x + 5, 30), beauty)
        draw.text((x + 30, 370), key.replace('-', ' ').title(), font=font, fill='#342e42')
        draw.text((x + 30, 410), 'Actual Blender render / 7 poses', font=small, fill='#786c7d')
        for i, bg in enumerate(['#ffffff', '#151515', '#e8f4eb', '#fff0ce']):
            draw.rounded_rectangle((x + 28 + i * 77, 452, x + 98 + i * 77, 522), radius=12, fill=bg)
            pet = Image.open(package / f'{key}-idle.png').convert('RGBA').resize((60, 60), Image.Resampling.LANCZOS)
            board.paste(pet, (x + 33 + i * 77, 457), pet)
    board.save(ROOT / 'collection-preview.png', optimize=True)


if __name__ == '__main__': main()

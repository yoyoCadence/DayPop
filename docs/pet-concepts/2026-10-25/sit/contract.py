"""Fixed published inputs and exact-alpha PNG candidate measurements for DP-202."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1] / '2026-10-23/motion'
LOOPS = ROOT.parent / 'loop-encoding'
KINDS = ('moon_cat', 'orbit_ufo')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def published(kind):
    return next(c for c in json.loads((PREVIOUS / 'manifest.json').read_text(encoding='utf8'))['characters'] if c['id'] == kind)


def baseline(kind):
    spec = importlib.util.spec_from_file_location('dp200_fixed_baseline', LOOPS / 'contract.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    char = next(c for c in json.loads((LOOPS / 'manifest.json').read_text(encoding='utf8'))['characters'] if c['id'] == kind)
    total = module.baseline(kind)
    for state in ('idle', 'sleep'):
        item = char['clips'][state]['candidates']['q75a100']
        path = LOOPS / item['path']
        assert sha(path) == item['sha256'] and item['eligible'], 'published loop candidate changed'
        total += path.stat().st_size-module.current(kind, state).stat().st_size
    assert total == {'moon_cat': 174308, 'orbit_ufo': 152194}[kind], 'fixed DP-201 package changed'
    return total


def measure(path, reference):
    with Image.open(path) as encoded:
        assert encoded.format == 'PNG' and encoded.n_frames == 1 and encoded.size == (120, 120), 'must be static 120px PNG'
        assert encoded.mode == 'RGBA', 'must retain RGBA'
        candidate = encoded.copy()
    result = {}
    for size, margin in ((120, 8), (60, 4)):
        a, b = [image.resize((size, size), Image.Resampling.LANCZOS) for image in (reference, candidate)]
        box = b.getchannel('A').getbbox()
        result[f'alphaSafe{size}'] = bool(box and min(box[:2]) >= margin and max(box[2:]) <= size-margin)
        result[f'alphaBox{size}'] = list(box) if box else None
        result[f'maxAlphaError{size}'] = ImageChops.difference(a.getchannel('A'), b.getchannel('A')).getextrema()[1]
        for matte, color in (('light', '#f5f3ee'), ('dark', '#111827')):
            bg = Image.new('RGBA', a.size, color)
            aa, bb = [Image.alpha_composite(bg, image).convert('RGB') for image in (a, b)]
            result[f'{matte}MeanAbsoluteError{size}'] = sum(ImageStat.Stat(ImageChops.difference(aa, bb)).sum)/(size*size*3*255)
    return result


def eligible(metrics, size, total):
    return size <= 16384 and total <= 196608 and all(metrics[f'alphaSafe{s}'] and metrics[f'maxAlphaError{s}'] == 0 for s in (120, 60)) and all(v < .008 for k, v in metrics.items() if 'MeanAbsoluteError' in k)

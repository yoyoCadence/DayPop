"""DP-198: fixed published inputs, independent of later App asset adoption."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent
CONCEPTS = ROOT.parents[1]
MOTION = CONCEPTS / '2026-10-23/motion'
SLEEP = CONCEPTS / '2026-10-24/sleep'
JUMP = CONCEPTS / '2026-10-24/jump'
ENCODING = CONCEPTS / '2026-10-24/jump-encoding'
spec = importlib.util.spec_from_file_location('dp194_package', JUMP / 'trial_contract.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
KINDS = ('moon_cat', 'orbit_ufo')
STATES = ('idle', 'grab', 'sleep')
PLANS = {'indexed256': ('indexed', 256), 'indexed128': ('indexed', 128),
         'rgb256': ('exactAlpha', 256), 'rgb128': ('exactAlpha', 128)}
LIMIT = 196608
STATIC_LIMIT = 16384
QUALITY_LIMIT = .008


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def character(directory, kind):
    data = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
    return next(char for char in data['characters'] if char['id'] == kind)


def inputs(kind):
    motion, sleep = character(MOTION, kind), character(SLEEP, kind)
    paths = {}
    for state in STATES:
        owner, directory = (sleep, SLEEP) if state == 'sleep' else (motion, MOTION)
        relative = owner['static'] if state == 'sleep' else owner['clips'][state]['static']
        path = directory / relative
        assert sha(path) == owner['sha256'][relative], 'changed published PNG input'
        paths[state] = path
    return paths


def baseline_bytes(kind):
    if kind == 'moon_cat':
        entry = character(ENCODING, kind)['candidates']['fullQ55A70']
        jump = ENCODING / entry['path']
        expected = entry['sha256']
    else:
        entry = character(JUMP, kind)
        relative = entry['candidates']['webpQ85']
        jump, expected = JUMP / relative, entry['sha256'][relative]
    assert sha(jump) == expected, 'changed published jump input'
    total = package.package_bytes(kind) + jump.stat().st_size
    assert total == {'moon_cat': 196286, 'orbit_ufo': 173845}[kind], 'changed fixed five-state baseline'
    return total


def measure(path, reference):
    with Image.open(path) as encoded:
        assert encoded.format == 'PNG' and encoded.n_frames == 1, 'must be one PNG frame'
        assert encoded.size == (120, 120), 'wrong size'
        mode = encoded.mode
        candidate = encoded.convert('RGBA')
    metrics = {}
    for size, margin in ((120, 8), (60, 4)):
        original, actual = [frame.resize((size, size), Image.Resampling.LANCZOS) for frame in (reference, candidate)]
        bounds = actual.getchannel('A').getbbox()
        metrics[f'alphaSafe{size}'] = bool(bounds and min(bounds[:2]) >= margin and max(bounds[2:]) <= size - margin)
        metrics[f'alphaBox{size}'] = list(bounds) if bounds else None
        metrics[f'maxAlphaError{size}'] = ImageChops.difference(original.getchannel('A'), actual.getchannel('A')).getextrema()[1]
        for matte, color in (('light', '#f5f3ee'), ('dark', '#111827')):
            background = Image.new('RGBA', (size, size), color)
            a, b = [Image.alpha_composite(background, frame).convert('RGB') for frame in (original, actual)]
            metrics[f'{matte}MeanAbsoluteError{size}'] = sum(ImageStat.Stat(ImageChops.difference(a, b)).sum) / (size * size * 3 * 255)
    metrics['mode'] = mode
    metrics['rgbColors'] = len(set(candidate.convert('RGB').getdata()))
    return metrics


def eligible(metrics):
    # Keep rejected experiments in the report; they must never become eligible.
    return all(value <= QUALITY_LIMIT for key, value in metrics.items() if 'MeanAbsoluteError' in key) and all(
        metrics[f'alphaSafe{size}'] and metrics[f'maxAlphaError{size}'] == 0 for size in (120, 60))


def output_path(kind, state, plan):
    return f'candidates/{kind}/{state}-{plan}.png'

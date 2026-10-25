"""DP-200 uses published frames and fixed DP-199 package inputs, never App state."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent
CONCEPTS = ROOT.parents[1]
OLD = CONCEPTS / '2026-10-23/motion'
SLEEP = CONCEPTS / '2026-10-24/sleep'
PREVIOUS = CONCEPTS / '2026-10-24/encoding'
STATIC = ROOT.parent / 'static-encoding'
KINDS = ('moon_cat', 'orbit_ufo')
STATES = ('idle', 'sleep')
PLANS = {'q75a100': (75, 100), 'q55a100': (55, 100), 'q55a70': (55, 70), 'q35a50': (35, 50)}
LIMIT = 196608
QUALITY = .008
INDICES = list(range(0, 44, 2))
DURATIONS = [200] * 22


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def character(directory, kind):
    return next(c for c in json.loads((directory / 'manifest.json').read_text(encoding='utf8'))['characters'] if c['id'] == kind)


def sources(kind, state):
    directory = SLEEP if state == 'sleep' else OLD
    published = character(directory, kind)
    folder = directory / 'frames' / kind
    if state == 'idle':
        folder /= state
    paths = sorted(folder.glob('*.png'))
    assert len(paths) == 44, 'source frame inventory'
    hashes = {}
    for path in paths:
        relative = path.relative_to(directory).as_posix()
        assert sha(path) == published['sha256'][relative], 'published source frame changed'
        hashes[path.relative_to(CONCEPTS).as_posix()] = sha(path)
    return paths, hashes


def current(kind, state):
    clip = character(PREVIOUS, kind)['clips'][state]
    path = PREVIOUS / clip['path']
    assert sha(path) == clip['sha256'], 'published current clip changed'
    assert clip['selectedIndices'] == INDICES and clip['selectedDurationsMs'] == DURATIONS, 'published sampling changed'
    return path


def baseline(kind):
    spec = importlib.util.spec_from_file_location('dp198_static_contract', STATIC / 'contract.py')
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    total = original.baseline_bytes(kind) - sum(p.stat().st_size for p in original.inputs(kind).values())
    char = character(STATIC, kind)
    for state in ('idle', 'grab', 'sleep'):
        entry = char['states'][state]['candidates']['rgb128']
        path = STATIC / entry['path']
        assert sha(path) == entry['sha256'] and entry['eligible'] is True, 'published static candidate changed'
        total += path.stat().st_size
    assert total == {'moon_cat': 190980, 'orbit_ufo': 167288}[kind], 'fixed five-state baseline changed'
    return total


def decode(path):
    frames = []
    with Image.open(path) as image:
        assert image.format == 'WEBP' and image.is_animated and image.n_frames > 1, 'must be animated WebP'
        assert image.info.get('loop') == 0, 'must loop continuously'
        elapsed = 0
        for index in range(image.n_frames):
            image.seek(index)
            frame = image.convert('RGBA')
            frame.load()
            duration = image.info['duration']
            assert frame.size == (120, 120), 'wrong canvas'
            assert type(duration) is int and duration > 0 and duration % 200 == 0, 'changed held-frame timeline'
            frames.append((elapsed, duration, frame.copy()))
            elapsed += duration
        assert elapsed == 4400, 'wrong loop duration'
    return frames


def at(frames, instant):
    return next(frame for start, duration, frame in frames if start <= instant < start + duration)


def measure(path, source):
    frames = decode(path)
    report = {'decodedFrames': len(frames), 'durationMs': 4400,
              'decodedDurationsMs': [duration for _, duration, _ in frames],
              'maxMatchedFrameAlphaError': max(ImageChops.difference(source[start//100].getchannel('A'), frame.getchannel('A')).getextrema()[1] for start, _, frame in frames)}
    for size, margin in ((120, 8), (60, 4)):
        reference = [image.resize((size, size), Image.Resampling.LANCZOS) for image in source]
        timeline = [at(frames, instant).resize((size, size), Image.Resampling.LANCZOS) for instant in range(0, 4400, 100)]
        bounds = [frame.getchannel('A').getbbox() for frame in timeline]
        report[f'alphaSafe{size}'] = all(box and min(box[:2]) >= margin and max(box[2:]) <= size - margin for box in bounds)
        report[f'maxTimelineAlphaError{size}'] = max(ImageChops.difference(a.getchannel('A'), b.getchannel('A')).getextrema()[1] for a, b in zip(reference, timeline))
        for matte, color in (('light', '#f5f3ee'), ('dark', '#111827')):
            background = Image.new('RGBA', (size, size), color)
            errors = []
            for a, b in zip(reference, timeline):
                aa, bb = [Image.alpha_composite(background, frame).convert('RGB') for frame in (a, b)]
                errors.append(sum(ImageStat.Stat(ImageChops.difference(aa, bb)).sum) / (size * size * 3 * 255))
            report[f'{matte}MaxTimelineMAE{size}'] = max(errors)
            report[f'{matte}MeanTimelineMAE{size}'] = sum(errors) / len(errors)
            report[f'{matte}WorstTimelineMs{size}'] = errors.index(max(errors))*100
    return report


def eligible(metrics, size, state):
    return size <= (131072 if state == 'idle' else 65536) and all(metrics[f'alphaSafe{s}'] for s in (120, 60)) and all(
        value < QUALITY for key, value in metrics.items() if 'MaxTimelineMAE' in key)


def candidate_path(kind, state, plan):
    return f'candidates/{kind}/{state}-{plan}.webp'

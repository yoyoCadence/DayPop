"""Package transparent native frames and check decoded deliverables."""
import argparse
from bisect import bisect_right
from itertools import accumulate
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageSequence, __version__ as pillow_version, features

from motion import POSES, POSTER, SINGLES, TIMING

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
NATIVE_TOOLS = {
    'manga-cat': 'Inkscape',
    'pixel-cat': 'Pillow image drawing',
    'mecha-spirit': 'Blender',
    'red-panda': 'Blender',
}
REFERENCE = {
    'manga-cat': '3822870a3ac41dd761d6821b9b4ad129b9338956fc29fa0f1eb0e9183e7e7464',
    'pixel-cat': '7e32913c1564e93acd7b647fd7f8aa87409548585a23a36cab1a42ea5d6fb511',
    'mecha-spirit': 'a98f7472a7c8097c86b6ecc21018f390e2d536e39c00efd7e4c177b6faa3a3ed',
    'red-panda': '96f14e2f235d0290e61a07531c43c2ec17da37ba7c99957b9e2e73c701457be4',
}


def record(path, folder):
    data = path.read_bytes()
    return {'path': str(path.relative_to(folder)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def alpha_bounds(frame, label):
    alpha = frame.getchannel('A')
    bounds = alpha.getbbox()
    if not bounds or min(bounds[0], bounds[1], 120 - bounds[2], 120 - bounds[3]) < 8:
        raise ValueError(f'{label}: art must have 8px transparent perimeter, got {bounds}')
    if alpha.getextrema() != (0, 255):
        raise ValueError(f'{label}: transparent and opaque pixels are required')
    return bounds


def contact_sheet(stills, dest, kind):
    width, height = 7 * 112 + 24, 246
    sheet = Image.new('RGB', (width, height), '#fcf6ed')
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 122, width, height), fill='#292436')
    font = ImageFont.load_default(size=13)
    for i, (pose, still) in enumerate(stills.items()):
        icon = still.resize((84, 84), Image.Resampling.NEAREST if kind == 'pixel-cat' else Image.Resampling.LANCZOS)
        for row, ink in [(0, '#3c3240'), (122, '#fff2e5')]:
            center = i * 112 + 68
            sheet.paste(icon, (center - 42, row + 9), icon)
            draw.text((center, row + 104), pose.upper(), anchor='mm', fill=ink, font=font)
    sheet.save(dest, optimize=True)


def package(kind, frames_dir, proof, assets, tool_version):
    proof.mkdir(parents=True, exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)
    budget = json.loads((ROOT / 'performance-budget.json').read_text())['pets']
    limits = {
        'idle': 'maxIdleBytes', 'walk': 'maxLookBytes', 'sit': 'maxLookBytes', 'sleep': 'maxSleepBytes',
        'jump': 'maxJumpBytes', 'look': 'maxLookBytes', 'grab': 'maxLookBytes',
    }
    source = HERE / kind
    source_files = [p for p in sorted(source.iterdir()) if p.suffix in {'.py', '.svg', '.blend', '.json'} and p.name not in {'manifest.json'}]
    if kind in {'red-panda', 'mecha-spirit'}:
        source_files += [HERE / 'create_3d.py']
    source_files += [HERE / 'motion.py', HERE / 'package_pets.py']
    stills = {}
    source_frames = {}
    manifest = {
        'key': kind.replace('-', '_'), 'canvas': [120, 120], 'cssPixels': 84, 'transparentMargin': 8,
        'nativeTool': NATIVE_TOOLS[kind], 'nativeToolVersion': tool_version,
        'encoder': f'Pillow {pillow_version}, libwebp {features.version("webp")}',
        'conceptReferenceSha256': REFERENCE[kind], 'source': [record(p, HERE) for p in source_files], 'poses': {},
    }
    for pose, timing in TIMING.items():
        frames = []
        for index in range(len(timing)):
            with Image.open(frames_dir / f'{pose}-{index:02}.png') as source_frame:
                frame = source_frame.convert('RGBA')
            if frame.size != (120, 120):
                raise ValueError(f'{pose}-{index}: expected 120×120, got {frame.size}')
            alpha_bounds(frame, f'{kind}/{pose}-{index}')
            frames.append(frame)
        png_path = assets / f'{kind}-{pose}.png'
        poster = frames[POSTER[pose]]
        if kind != 'pixel-cat':
            rgb = poster.convert('RGB').quantize(colors=128).convert('RGB')
            rgb.putalpha(poster.getchannel('A'))
            poster = rgb
        poster.save(png_path, optimize=True)
        if png_path.stat().st_size > budget['maxStaticBytes']:
            raise ValueError(f'{png_path.name}: PNG exceeds byte budget')
        stills[pose] = frames[POSTER[pose]]
        source_frames[pose] = frames
        manifest['poses'][pose] = {'png': record(png_path, assets)}
    png_bytes = sum(pose['png']['bytes'] for pose in manifest['poses'].values())
    weights = {'idle': 19, 'walk': 17, 'sit': 9, 'sleep': 14, 'jump': 15, 'look': 16, 'grab': 10}
    animation_budget = budget['maxCharacterBytes'] - png_bytes
    for pose, timing in TIMING.items():
        frames = source_frames[pose]
        webp_path = assets / f'{kind}-{pose}.webp'
        target = min(budget[limits[pose]], animation_budget * weights[pose] // 100)
        # Reduce color quality if a pose needs it. Full alpha is always preserved.
        qualities = (100,) if kind == 'pixel-cat' else (85, 75, 65, 55, 45, 35, 27, 20)
        for quality in qualities:
            frames[0].save(
                webp_path, save_all=True, append_images=frames[1:], duration=timing,
                loop=1 if pose in SINGLES else 0, lossless=kind == 'pixel-cat',
                quality=quality, alpha_quality=100, method=6, minimize_size=True,
            )
            if webp_path.stat().st_size <= target:
                break
        else:
            raise ValueError(f'{webp_path.name}: exceeds {target} bytes')
        with Image.open(webp_path) as webp:
            decoded = set()
            duration = 0
            time_starts = [0, *accumulate(timing)]
            for index, decoded_frame in enumerate(ImageSequence.Iterator(webp)):
                rgba = decoded_frame.convert('RGBA')
                source_index = bisect_right(time_starts, duration) - 1
                end = duration + webp.info['duration']
                alpha = rgba.getchannel('A').tobytes()
                for original, start in zip(frames[source_index:], time_starts[source_index:]):
                    if start >= end:
                        break
                    if alpha != original.getchannel('A').tobytes():
                        raise ValueError(f'{webp_path.name}: alpha changed at {start}ms')
                if rgba.size != (120, 120):
                    raise ValueError(f'{webp_path.name}: dimensions or alpha changed at frame {index}')
                alpha_bounds(rgba, f'{webp_path.name} decoded frame {index}')
                decoded.add(hashlib.sha256(rgba.tobytes()).hexdigest())
                duration += webp.info['duration']
            if len(decoded) < 3 or duration != sum(timing) or webp.info['loop'] != (1 if pose in SINGLES else 0):
                raise ValueError(f'{webp_path.name}: unexpected frame count, duration, or loop metadata')
            webp_report = record(webp_path, assets) | {'frames': webp.n_frames, 'distinctFrames': len(decoded), 'durationMs': duration, 'loop': webp.info['loop'], 'quality': quality}
        manifest['poses'][pose]['webp'] = webp_report
    if tuple(stills) != POSES or len({im.tobytes() for im in stills.values()}) != len(POSES):
        raise ValueError(f'{kind}: every pose needs its own still')
    manifest['assetBytes'] = sum(asset['bytes'] for pose in manifest['poses'].values() for asset in pose.values())
    if manifest['assetBytes'] > budget['maxCharacterBytes']:
        raise ValueError(f"{kind}: total {manifest['assetBytes']} exceeds {budget['maxCharacterBytes']}")
    alpha = stills['idle'].getchannel('A').point(lambda x: 255 if x > 24 else 0)
    _, top, right, _ = alpha.getbbox()
    manifest['badgeInset'] = {'top': top, 'right': 120 - right}
    contact_sheet(stills, proof / '84px.png', kind)
    (proof / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    files = [entry for pose in manifest['poses'].values() for entry in pose.values()]
    (proof / 'SHA256SUMS').write_text(''.join(f"{row['sha256']}  {row['path']}\n" for row in files))
    print(f"{kind}: {manifest['assetBytes']} bytes, {manifest['badgeInset']}, all 14 output files verified")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=NATIVE_TOOLS)
    parser.add_argument('--frames', type=Path, required=True)
    parser.add_argument('--proof', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--tool-version', required=True)
    args = parser.parse_args()
    package(args.kind, args.frames, args.proof, args.assets, args.tool_version)

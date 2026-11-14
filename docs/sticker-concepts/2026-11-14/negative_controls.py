"""Negative controls for check_stickers.py: each mutation must fail for its own reason.

Usage, from the repository root (WORK is deleted and recreated):

    python3 -I docs/sticker-concepts/2026-11-14/negative_controls.py "$PWD" ASSETS_DIR WORK_DIR

Copies the checker, manifest, hash list, the SVGs from ASSETS_DIR and the
DP-243 catalogue into a throwaway tree, applies one mutation at a time and
runs the checker there. After an SVG mutation the hash list is rewritten to
the mutated bytes, so the control proves the targeted rule fires rather than
the hash pin; one control mutates without rehashing to prove the pin itself.
The repository and ASSETS_DIR are never written.
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

repo, assets, work = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
concept = repo / 'docs/sticker-concepts/2026-11-14'
SVGS = ['happy.svg', 'gift.svg', 'cake.svg', 'hiking.svg']


def tree():
    if work.exists():
        shutil.rmtree(work)
    target = work / 'docs/sticker-concepts/2026-11-14'
    (target / 'art').mkdir(parents=True)
    for name in ['check_stickers.py', 'manifest.csv', 'asset-hashes.json']:
        shutil.copy(concept / name, target / name)
    for name in SVGS:
        shutil.copy(assets / name, target / 'art' / name)
    (work / 'src/domain').mkdir(parents=True)
    shutil.copy(repo / 'src/domain/stickerGlyphs.ts', work / 'src/domain/stickerGlyphs.ts')
    return target


def edit(path, old, new):
    text = path.read_text(encoding='utf-8')
    assert old in text, (path, old)
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def rehash(target):
    hashes = json.loads((target / 'asset-hashes.json').read_text(encoding='utf-8'))
    for name in SVGS:
        data = (target / 'art' / name).read_bytes()
        hashes[name].update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    (target / 'asset-hashes.json').write_text(json.dumps(hashes), encoding='utf-8')


def svg(name, old, new, pin=True):
    def mutate(target):
        edit(target / 'art' / name, old, new)
        if pin:
            rehash(target)
    return mutate


CASES = [
    ('baseline (no mutation)', lambda t: None, None),
    ('handoff v1 fallback 🏔️', lambda t: edit(t / 'manifest.csv', ',⛰️,', ',🏔️,'), 'not in the DP-243 catalogue'),
    ('fallback in another category', lambda t: edit(t / 'manifest.csv', 'gift,禮物,celebrate', 'gift,禮物,mood'), 'is in celebrate'),
    ('unknown licence value', lambda t: edit(t / 'manifest.csv', ',review-pending,,第一輪 ChatGPT', ',approved,,第一輪 ChatGPT'), 'unknown licence'),
    ('bytes changed after review', svg('gift.svg', '</g>', '<circle cx="1" cy="1" r="1"/></g>', pin=False), 'does not match asset-hashes.json'),
    ('script element', svg('gift.svg', '</g>\n</svg>', '</g>\n<script>alert(1)</script>\n</svg>'), 'element not allowed: script'),
    ('xlink image', svg('gift.svg', '</g>\n</svg>', '</g>\n<image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://example.com/x.png"/>\n</svg>'), 'extra namespace prefix'),
    ('url() paint', svg('cake.svg', 'fill="#FFE6CA"', 'fill="url(#g)"'), 'external or active value'),
    ('foreign namespace element', svg('cake.svg', '</g>\n</svg>', '</g>\n<x:path xmlns:x="urn:x" d="M0 0"/>\n</svg>'), 'extra namespace prefix'),
    ('event handler attribute', svg('hiking.svg', '<svg ', '<svg onload="alert(1)" '), 'attribute not allowed: onload'),
    ('style attribute', svg('hiking.svg', 'stroke-width="3.2"/>', 'stroke-width="3.2" style="fill:red"/>'), 'attribute not allowed: style'),
    ('XML comment', svg('happy.svg', '<g ', '<!-- note --><g '), 'comment not allowed'),
    ('DOCTYPE', svg('happy.svg', '<svg ', '<!DOCTYPE svg>\n<svg '), 'DTD not allowed'),
    ('non-96 viewBox', svg('happy.svg', 'viewBox="0 0 96 96"', 'viewBox="0 0 100 100"'), 'viewBox must be exactly'),
    ('over 4096 bytes', svg('gift.svg', '</g>\n</svg>', '</g>\n' + '<path d="M0 0L1 1"/>\n' * 200 + '</svg>'), '> 4096'),
    ('new colour outside the palette', svg('hiking.svg', 'fill="#65A76B"', 'fill="#123456"'), 'neither a palette colour'),
    ('fourth main colour is still allowed', svg('hiking.svg', 'fill="#65A76B"', 'fill="#72B8E8"'), None),
]
# Adds blue, brown and coral on top of green/yellow/cream: six main colours.
CASES.append(('five or more main colours', svg('hiking.svg', '</g>', '<circle cx="10" cy="10" r="2" fill="#72B8E8"/><circle cx="14" cy="10" r="2" fill="#80554D"/><circle cx="18" cy="10" r="2" fill="#FF747A"/></g>'), 'main colours > 4'))

failures = 0
for label, mutate, expected in CASES:
    target = tree()
    mutate(target)
    proc = subprocess.run([sys.executable, '-I', str(target / 'check_stickers.py'), '--assets', str(target / 'art')],
                          capture_output=True, text=True)
    report = json.loads(proc.stdout)
    errors = report['errors']
    if expected is None:
        ok = proc.returncode == 0 and not errors
    else:
        ok = proc.returncode == 1 and any(expected in e for e in errors)
    failures += not ok
    print(f'{"PASS" if ok else "FAIL"}  exit {proc.returncode}  {label}' + ('' if ok else f'  {errors}'))
shutil.rmtree(work)
print(f'{len(CASES) - failures}/{len(CASES)} controls behaved as expected')
sys.exit(1 if failures else 0)

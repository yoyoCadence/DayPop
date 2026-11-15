"""Compare each DayPop sticker with the same glyph in four open emoji sets.

Usage, from the repository root (after extract_emoji_sets.py and render_svgs.mjs;
copy GLYPHS/noto/*.png to PNG_ROOT/noto/, Noto ships as 64px PNG):
  python3 -I docs/sticker-concepts/2026-11-14/similarity/similarity_check.py \
    PNG_ROOT docs/sticker-concepts/2026-11-14/similarity/similarity-results.json
PNG_ROOT holds ours/ twemoji/ openmoji/ noto/ fluent/, one <id>.png each.
Only scores are written; no image leaves PNG_ROOT.

Each image is cropped to its visible part, centred on a square and scaled to
64px. Four measures, combined as their mean: silhouette overlap (IoU of alpha
> 64), SSIM of the luminance on white, 64-bit dHash distance, and colour
histogram overlap. For every glyph the four independent designs are compared
pairwise: that is how alike two unrelated artists' drawings of the same
subject get. A sticker is flagged when it is closer to any set than that
baseline, or than the 95th percentile of all same-subject baselines. A flag
means "look at it", not "copied"; the measures are crude for simple shapes.
"""
import json
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
from PIL import Image

root, out = Path(sys.argv[1]), Path(sys.argv[2])
SETS = ['twemoji', 'openmoji', 'noto', 'fluent']
SIZE = 64
ids = sorted(p.stem for p in (root / 'ours').glob('*.png'))


def load(path):
    im = Image.open(path).convert('RGBA')
    alpha = np.asarray(im)[:, :, 3]
    ys, xs = np.nonzero(alpha > 64)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = max(im.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    rgba = np.asarray(canvas).astype(np.float64)
    a = rgba[:, :, 3:4] / 255
    rgb = rgba[:, :, :3] * a + 255 * (1 - a)
    return {'mask': rgba[:, :, 3] > 64, 'rgb': rgb, 'gray': rgb @ [0.299, 0.587, 0.114]}


def ssim(x, y, win=7):
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    def box(z):
        c = np.pad(z, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        return (c[win:, win:] - c[:-win, win:] - c[win:, :-win] + c[:-win, :-win]) / win ** 2
    mx, my = box(x), box(y)
    vx, vy, cxy = box(x * x) - mx ** 2, box(y * y) - my ** 2, box(x * y) - mx * my
    return float(np.mean(((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))))


def dhash(gray):
    small = np.asarray(Image.fromarray(gray.astype(np.uint8)).resize((9, 8), Image.LANCZOS)).astype(int)
    return (small[:, 1:] > small[:, :-1]).flatten()


def colour_hist(img):
    q = (img['rgb'][img['mask']] // 64).astype(int)
    h = np.bincount(q[:, 0] * 16 + q[:, 1] * 4 + q[:, 2], minlength=64).astype(float)
    return h / max(h.sum(), 1)


def compare(a, b):
    iou = float((a['mask'] & b['mask']).sum() / max((a['mask'] | b['mask']).sum(), 1))
    s = ssim(a['gray'], b['gray'])
    d = int((dhash(a['gray']) != dhash(b['gray'])).sum())
    c = float(np.minimum(colour_hist(a), colour_hist(b)).sum())
    return {'silhouette_iou': round(iou, 3), 'ssim': round(s, 3), 'dhash_distance': d, 'colour_overlap': round(c, 3),
            'score': round((iou + max(s, 0) + (1 - d / 64) + c) / 4, 3)}


images = {s: {i: load(root / s / f'{i}.png') for i in ids} for s in ['ours'] + SETS}
result = {'method': 'similarity_check.py: mean of silhouette IoU, SSIM, 1 - dHash/64, colour overlap at 64px', 'size': SIZE, 'sets': SETS,
          'set_versions': {'twemoji': '@twemoji/svg 15.0.0', 'openmoji': 'openmoji 17.0.0', 'noto': 'emoji-datasource-google 16.0.0 (64px PNG)', 'fluent': '@lobehub/fluent-emoji-flat 1.1.0'}, 'glyphs': {}}
baseline_all = []
for i in ids:
    base = {f'{a}~{b}': compare(images[a][i], images[b][i]) for a, b in combinations(SETS, 2)}
    ours = {s: compare(images['ours'][i], images[s][i]) for s in SETS}
    baseline_all += [v['score'] for v in base.values()]
    result['glyphs'][i] = {'ours_vs_set': ours, 'independent_pairs': base,
                           'ours_max': max(v['score'] for v in ours.values()),
                           'independent_max': max(v['score'] for v in base.values()),
                           'independent_median': float(np.median([v['score'] for v in base.values()]))}
p95 = float(np.percentile(baseline_all, 95))
unrelated = [compare(images['ours'][i], images[s][j])['score'] for i in ids for j in ids if i != j for s in SETS[:1]]
result['independent_p95'] = round(p95, 3)
result['unrelated_median'] = round(float(np.median(unrelated)), 3)
for i, g in result['glyphs'].items():
    g['flag'] = g['ours_max'] > g['independent_max'] or g['ours_max'] > p95
out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f"independent same-subject p95 {p95:.3f}; unrelated-subject median {result['unrelated_median']}")
print(f"{'id':10s} ours_max  indep_max  indep_med  flag   (closest set)")
for i, g in result['glyphs'].items():
    closest = max(g['ours_vs_set'], key=lambda s: g['ours_vs_set'][s]['score'])
    print(f"{i:10s} {g['ours_max']:.3f}    {g['independent_max']:.3f}      {g['independent_median']:.3f}      {'FLAG' if g['flag'] else '-':5s}  {closest} {g['ours_vs_set'][closest]}")

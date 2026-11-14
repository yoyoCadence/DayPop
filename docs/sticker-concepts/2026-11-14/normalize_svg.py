"""Scale and centre one sticker SVG so its opaque box has a given long side.

Usage: python3 -I normalize_svg.py IN.svg OUT.svg minX minY maxX maxY [target=0.92]

The box is the measured opaque bounding box (white die-cut included) in
viewBox units. The drawing is wrapped in one <g transform> so the viewBox stays
"0 0 96 96" as the style guide asks, and strokes scale with the shapes. XML
comments are dropped; nothing else in the drawing changes.
"""
import re
import sys
from pathlib import Path

src, dst, *nums = sys.argv[1:]
min_x, min_y, max_x, max_y = map(float, nums[:4])
target = float(nums[4]) if len(nums) > 4 else 0.92

text = Path(src).read_text(encoding='utf-8')
text = re.sub(r'<!--.*?-->\n?', '', text, flags=re.S)
open_end = re.search(r'<svg\b[^>]*>', text)
close = text.rindex('</svg>')
if 'viewBox="0 0 96 96"' not in open_end.group(0):
    raise SystemExit('expected viewBox="0 0 96 96"')

long_side = max(max_x - min_x, max_y - min_y)
k = target * 96 / long_side
cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2
tx, ty = 48 - k * cx, 48 - k * cy
fmt = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')
inner = text[open_end.end():close].strip('\n')
out = (text[:open_end.end()] + f'\n<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(k)})">\n'
       + inner + '\n</g>\n' + text[close:])
Path(dst).write_text(out, encoding='utf-8')
print(f'{Path(dst).name}: scale {fmt(k)}, translate {fmt(tx)} {fmt(ty)}, {len(out.encode())} bytes')

#!/usr/bin/env python3
"""DP-244 Phase 1 sticker check (standard library only).

Usage, from the repository root:

    python3 -I docs/sticker-concepts/2026-11-14/check_stickers.py [--assets DIR]

The SVG files are not in the repository while their licence is
`review-pending` (OWNER-DECISIONS 2026-11-14, item 6). Without --assets only
the manifest is checked; with it, every file is checked and its SHA-256 must
match asset-hashes.json, so the reviewed bytes are the ones later committed.

Stricter than the handoff's audit_assets.py, and tied to this repository:

* the fallback emoji and category are read from src/domain/stickerGlyphs.ts
  (the real DP-243 catalogue), not searched for as text in a Markdown file;
* SVG markup is an allowlist over the SVG namespace only: no foreign
  namespaces, comments, DTDs, CDATA, processing instructions, stray text,
  namespaced attributes, url()/data:/javascript:, or paint other than hex;
* viewBox must be exactly "0 0 96 96" (STYLE-GUIDE v0.1).

Style-guide observations (palette, number of fills) are reported as notes,
not failures: they are the owner's call. A clean run here is a static check
only. It is not a visual, phone, rights or licence approval.
"""
import argparse
import csv
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CATALOGUE = REPO / 'src' / 'domain' / 'stickerGlyphs.ts'
SVG_NS = 'http://www.w3.org/2000/svg'
PER_FILE_LIMIT = 4096
BATCH_LIMIT = 24 * 4096
COLUMNS = ['id', 'name', 'category', 'fallback', 'file', 'author', 'source_url', 'license',
           'license_url', 'modified']
PUBLISHABLE = {'owner-original', 'CC0', 'CC BY 4.0', 'MIT', 'Apache 2.0', 'SIL OFL 1.1'}
TAGS = {'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'title', 'desc'}
ATTRS = {'viewBox', 'width', 'height', 'role', 'aria-label', 'id', 'fill', 'stroke', 'stroke-width',
         'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity',
         'fill-opacity', 'stroke-opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
         'd', 'points', 'transform'}
PAINT = re.compile(r'none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}')
TRANSFORM = re.compile(r'(\s*(translate|scale|rotate)\(\s*-?[\d.]+(\s*[ ,]\s*-?[\d.]+){0,2}\s*\))+\s*')
INK, WHITE = '#261c22', {'#fff', '#ffffff'}
# STYLE-GUIDE v0.1 palette, lower-cased.
PALETTE = {'#ff747a', '#ffd44f', '#76ba79', '#72b8e8', '#ffe6ca', '#80554d'}
# OWNER-DECISIONS item 4: at most four main colours; a small light/dark step of
# a main colour counts as that colour. "Small" = RGB distance <= 40.
MAX_MAIN_COLOURS = 4
SHADE_DISTANCE = 40


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def main_colour(fill):
    """The palette colour a fill belongs to, or None when it is a new colour."""
    best = min(PALETTE, key=lambda p: sum((a - b) ** 2 for a, b in zip(rgb(fill), rgb(p))))
    distance = sum((a - b) ** 2 for a, b in zip(rgb(fill), rgb(best))) ** 0.5
    return best if distance <= SHADE_DISTANCE else None


def catalogue():
    """{category id: [glyph, ...]} parsed from the TypeScript source."""
    text = CATALOGUE.read_text(encoding='utf-8')
    result = {}
    for match in re.finditer(r"id:\s*'([a-z]+)',\s*label:\s*'[^']+',\s*glyphs:\s*\[([^\]]*)\]", text):
        result[match.group(1)] = re.findall(r"'([^']+)'", match.group(2))
    if len(result) != 11 or sum(len(v) for v in result.values()) != 240:
        raise SystemExit(f'Could not read the DP-243 catalogue from {CATALOGUE}')
    return result


def local(name):
    return name.rsplit('}', 1)[-1]


def check_svg(path, errors, notes):
    raw = path.read_bytes()
    name = path.name
    if raw.startswith(b'\xef\xbb\xbf'):
        errors.append(f'{name}: UTF-8 BOM')
    text = raw.decode('utf-8')
    for token, label in (('<!--', 'comment'), ('<!DOCTYPE', 'DTD'), ('<!ENTITY', 'entity'),
                         ('<![CDATA[', 'CDATA')):
        if token.lower() in text.lower():
            errors.append(f'{name}: {label} not allowed in a deployable file')
    if re.search(r'<\?(?!xml\s)', text) or text.count('<?') > (1 if text.lstrip().startswith('<?xml') else 0):
        errors.append(f'{name}: processing instruction not allowed')
    if re.search(r'\sxmlns:', text):
        errors.append(f'{name}: extra namespace prefix declared')
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        errors.append(f'{name}: invalid XML: {exc}')
        return
    if root.tag != f'{{{SVG_NS}}}svg':
        errors.append(f'{name}: root is not an SVG-namespace <svg>')
    if root.attrib.get('viewBox') != '0 0 96 96':
        errors.append(f'{name}: viewBox must be exactly "0 0 96 96"')
    for size in ('width', 'height'):
        if size in root.attrib and root.attrib[size] != '96':
            errors.append(f'{name}: {size} must be 96 when present')
    fills = set()
    for element in root.iter():
        if not element.tag.startswith(f'{{{SVG_NS}}}'):
            errors.append(f'{name}: element outside the SVG namespace: {element.tag}')
            continue
        tag = local(element.tag)
        if tag not in TAGS:
            errors.append(f'{name}: element not allowed: {tag}')
        if tag not in ('title', 'desc') and (element.text or '').strip():
            errors.append(f'{name}: text content inside <{tag}>')
        if (element.tail or '').strip():
            errors.append(f'{name}: text after <{tag}>')
        for key, value in element.attrib.items():
            if key.startswith('{'):
                errors.append(f'{name}: namespaced attribute {key}')
                continue
            if key not in ATTRS:
                errors.append(f'{name}: attribute not allowed: {key}')
            lowered = value.lower()
            if any(bad in lowered for bad in ('url(', 'javascript:', 'data:', '&', '<')):
                errors.append(f'{name}: external or active value in {key}')
            if key in ('fill', 'stroke') and not PAINT.fullmatch(value):
                errors.append(f'{name}: {key}="{value}" is not none or a hex colour')
            if key == 'transform' and not TRANSFORM.fullmatch(value):
                errors.append(f'{name}: transform "{value}" is not plain translate/scale/rotate')
            if key == 'fill' and PAINT.fullmatch(value) and value.lower() not in ({'none', INK} | WHITE):
                fills.add(value.lower())
    mains = set()
    for fill in fills:
        main = main_colour(fill)
        if main is None:
            errors.append(f'{name}: fill {fill} is neither a palette colour nor a small shade of one')
        else:
            mains.add(main)
    if len(mains) > MAX_MAIN_COLOURS:
        errors.append(f'{name}: {len(mains)} main colours > {MAX_MAIN_COLOURS}')
    notes[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                   'fills_besides_ink_and_white': sorted(fills),
                   'shades': sorted(fills - PALETTE), 'main_colours': sorted(mains)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', type=Path, help='folder holding the SVG files named in manifest.csv')
    args = parser.parse_args()
    hashes = json.loads((HERE / 'asset-hashes.json').read_text(encoding='utf-8'))
    cat = catalogue()
    glyph_category = {g: c for c, gs in cat.items() for g in gs}
    errors, notes, ids = [], {}, set()
    with (HERE / 'manifest.csv').open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != COLUMNS:
            errors.append(f'manifest columns must be exactly {COLUMNS}')
        rows = list(reader)
    licences = {}
    total = 0
    for row in rows:
        ident = row['id']
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', ident):
            errors.append(f'{ident}: id is not lower-case kebab')
        if ident in ids:
            errors.append(f'{ident}: duplicate id')
        ids.add(ident)
        if row['category'] not in cat:
            errors.append(f'{ident}: category {row["category"]} is not a DP-243 category')
        fallback = row['fallback']
        if fallback not in glyph_category:
            errors.append(f'{ident}: fallback {fallback} is not in the DP-243 catalogue')
        elif glyph_category[fallback] != row['category']:
            errors.append(f'{ident}: fallback {fallback} is in {glyph_category[fallback]}, not {row["category"]}')
        licences[ident] = row['license']
        if row['license'] not in PUBLISHABLE | {'review-pending'}:
            errors.append(f'{ident}: unknown licence value {row["license"]}')
        file_name = row['file']
        if Path(file_name).name != file_name or not file_name.endswith('.svg'):
            errors.append(f'{ident}: unsafe file name {file_name}')
            continue
        if file_name not in hashes:
            errors.append(f'{ident}: {file_name} has no entry in asset-hashes.json')
        if args.assets is None:
            continue
        path = args.assets / file_name
        if not path.is_file():
            errors.append(f'{ident}: missing {file_name}')
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != hashes.get(file_name, {}).get('sha256'):
            errors.append(f'{ident}: {file_name} does not match asset-hashes.json')
        size = path.stat().st_size
        total += size
        if size > PER_FILE_LIMIT:
            errors.append(f'{file_name}: {size} bytes > {PER_FILE_LIMIT}')
        check_svg(path, errors, notes)
    if total > BATCH_LIMIT:
        errors.append(f'total {total} bytes > {BATCH_LIMIT}')
    pending = sorted(i for i, value in licences.items() if value not in PUBLISHABLE)
    report = {
        'errors': errors,
        'files': notes,
        'svg_checked': args.assets is not None,
        'bytes_total': total if args.assets is not None else None,
        'catalogue': f'{len(glyph_category)} glyphs in {len(cat)} categories from src/domain/stickerGlyphs.ts',
        'licence_pending': pending,
        'publishable': not errors and not pending,
        'not_checked_here': ['phone visual review', 'rights and AI-tool terms', 'App integration (Phase 3)'],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())

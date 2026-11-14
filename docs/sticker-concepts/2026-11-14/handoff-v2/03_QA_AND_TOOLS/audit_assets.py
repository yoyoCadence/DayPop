#!/usr/bin/env python3
"""Basic offline Phase 1 checks. Not a production SVG sanitizer or license review.
Usage: python 03_QA_AND_TOOLS/audit_assets.py [--catalog /path/to/sticker-catalog.md]
"""
from pathlib import Path
import argparse, csv, json, re, sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / '02_ASSETS'
PER_FILE_LIMIT = 4096
BATCH_LIMIT = 24 * 4096
REQUIRED = {'id','name','category','fallback','file','author','source_url','license','license_url','modified'}
CATEGORIES = {'mark','mood','celebrate','work','money','health','travel','food','home','fun','weather'}
# This allowlist only supports small static vector assets (purposefully conservative).
TAGS = {'svg','g','path','circle','ellipse','rect','line','polyline','polygon','title','desc'}
ATTRS = {'xmlns','viewBox','width','height','role','aria-label','id','fill','stroke','stroke-width',
         'stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule','clip-rule',
         'opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','y1',
         'x2','y2','d','points','transform'}
VALID_LICENSE = {'owner-original','CC0','CC BY 4.0','MIT','Apache 2.0','SIL OFL 1.1'}

p = argparse.ArgumentParser()
p.add_argument('--catalog', type=Path, help='Optional textual first-pass fallback search; not schema verification')
a = p.parse_args()
errors, warnings, sizes = [], [], {}
with (ASSETS/'manifest.csv').open('r', encoding='utf-8-sig', newline='') as handle:
    r = csv.DictReader(handle)
    if not r.fieldnames or set(r.fieldnames) != REQUIRED:
        errors.append('Manifest columns are missing or unexpected')
    records = list(r)
if len(records) != 4:
    warnings.append(f'Expected four Phase 1 files, got {len(records)}')
seen = set()
for item in records:
    id_ = item.get('id','')
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', id_):
        errors.append(f'Invalid id: {id_}')
    if id_ in seen: errors.append(f'Duplicate id: {id_}')
    seen.add(id_)
    if item.get('category') not in CATEGORIES: errors.append(f'Invalid category: {id_}')
    if not item.get('name') or not item.get('fallback') or not item.get('author'):
        errors.append(f'Missing required descriptive field: {id_}')
    license_ = item.get('license','')
    if license_ not in VALID_LICENSE:
        warnings.append(f'{id_}: license is {license_ or "empty"}; NOT READY TO PUBLISH')
    if license_ in VALID_LICENSE - {'owner-original'} and (not item.get('source_url') or not item.get('license_url')):
        errors.append(f'{id_}: missing source URL or license URL')
    fname = item.get('file','')
    if Path(fname).name != fname or not fname.endswith('.svg'):
        errors.append(f'Unsafe or non-SVG file path: {id_}/{fname}')
        continue
    fp = ASSETS/fname
    if not fp.is_file():
        errors.append(f'Missing file: {fname}')
        continue
    sz = fp.stat().st_size
    sizes[fname] = sz
    if sz > PER_FILE_LIMIT: errors.append(f'{fname}: {sz} > {PER_FILE_LIMIT}')
    data = fp.read_text(encoding='utf-8')
    if '<!DOCTYPE' in data.upper() or '<!ENTITY' in data.upper():
        errors.append(f'{fname}: DTD/entity not allowed')
    try: node = ET.fromstring(data)
    except ET.ParseError as exc:
        errors.append(f'{fname}: invalid XML: {exc}'); continue
    tag = lambda name: name.rsplit('}',1)[-1]
    if tag(node.tag) != 'svg': errors.append(f'{fname}: root must be svg')
    vb = node.attrib.get('viewBox','')
    if vb:
        try:
            nums=[float(x) for x in re.split(r'[\s,]+',vb.strip())]
            if len(nums)!=4 or nums[2]<=0 or nums[2] != nums[3]:
                errors.append(f'{fname}: viewBox is not square')
        except ValueError: errors.append(f'{fname}: invalid viewBox')
    else: errors.append(f'{fname}: missing viewBox')
    for el in node.iter():
        if tag(el.tag) not in TAGS:
            errors.append(f'{fname}: element not allowed {tag(el.tag)}')
        for key,value in el.attrib.items():
            k=tag(key)
            if k not in ATTRS: errors.append(f'{fname}: attr not allowed {k}')
            if k.startswith('on') or 'javascript:' in value.lower() or 'url(' in value.lower() or 'data:' in value.lower():
                errors.append(f'{fname}: dynamic/external content found in {k}')
if sum(sizes.values()) > BATCH_LIMIT:
    errors.append('Total asset bytes exceed 24x4KB cap')
if a.catalog:
    content=a.catalog.read_text(encoding='utf-8')
    for item in records:
        if item.get('fallback') and item['fallback'] not in content:
            errors.append(f'{item.get("id")}: fallback not found in catalog text')
    warnings.append('Catalog check is text presence only; inspect actual list/IDs separately')
else:
    warnings.append('No --catalog supplied; fallback catalog compatibility NOT verified')
report={'phase':'1','assets':sizes,'bytes_total':sum(sizes.values()),'errors':errors,'warnings':warnings,
        'visual_check':'PENDING owner phone review','license_approval':'PENDING owner review',
        'repo_integration':'NOT STARTED','publish_ready': not errors and not warnings}
print(json.dumps(report,ensure_ascii=False,indent=2))
if errors: sys.exit(1)

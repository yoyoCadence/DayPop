"""Pull each sticker's fallback glyph out of four open emoji packages.

Usage, from the repository root:
  npm pack @twemoji/svg@15.0.0 openmoji@17.0.0 emoji-datasource-google@16.0.0 \\
    @lobehub/fluent-emoji-flat@1.1.0   # in an empty directory outside the repo
  python3 -I docs/sticker-concepts/2026-11-14/similarity/extract_emoji_sets.py \\
    docs/sticker-concepts/2026-11-14/manifest.csv TGZ_DIR OUT_DIR

`npm pack` only downloads; it runs no install scripts. The glyphs are other
people's artwork, used here for a local comparison only (Twemoji CC BY 4.0,
OpenMoji CC BY-SA 4.0, Noto Apache 2.0, Fluent MIT), so OUT_DIR must be
outside the repository. Apple's emoji are not openly licensed and are not
fetched: the owner compares them on an iPhone, which draws them natively.
"""
import csv
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
manifest, tgz_dir, out = (Path(a).resolve() for a in sys.argv[1:4])
if out.is_relative_to(REPO):
    sys.exit('OUT_DIR is inside the repository; third-party emoji must stay outside it')
rows = list(csv.DictReader(manifest.open(encoding='utf-8')))
SETS = {
    'twemoji': ('twemoji-svg-15.0.0.tgz', lambda cps: f"package/{'-'.join(cps)}.svg", '.svg'),
    'openmoji': ('openmoji-17.0.0.tgz', lambda cps: f"package/color/svg/{'-'.join(c.upper() for c in cps)}.svg", '.svg'),
    'noto': ('emoji-datasource-google-16.0.0.tgz', lambda cps: f"package/img/google/64/{'-'.join(cps)}.png", '.png'),
    'fluent': ('lobehub-fluent-emoji-flat-1.1.0.tgz', lambda cps: f"package/assets/{'-'.join(cps)}.svg", '.svg'),
}
missing = []
for name, (tgz, path_for, ext) in SETS.items():
    target = out / name
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz_dir / tgz) as tar:
        names = set(tar.getnames())
        for row in rows:
            full = [f'{ord(c):x}' for c in row['fallback']]
            for cps in (full, [c for c in full if c != 'fe0f']):
                member = path_for(cps)
                if member in names and tar.getmember(member).isfile():
                    (target / f"{row['id']}{ext}").write_bytes(tar.extractfile(member).read())
                    break
            else:
                missing.append((name, row['id'], row['fallback']))
if missing:
    sys.exit(f'missing glyphs: {missing}')
print({name: len(list((out / name).iterdir())) for name in SETS})

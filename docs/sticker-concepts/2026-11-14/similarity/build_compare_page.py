"""One HTML page for the owner: each sticker beside the same glyph in four open sets
and the device's own emoji (Apple's on an iPhone), with the similarity scores.

Usage, from the repository root:
  python3 -I docs/sticker-concepts/2026-11-14/similarity/build_compare_page.py \\
    PNG_ROOT docs/sticker-concepts/2026-11-14/similarity/similarity-results.json \\
    docs/sticker-concepts/2026-11-14/manifest.csv OUT_FILE
The page embeds review-pending stickers and third-party emoji, so OUT_FILE must
be outside the repository. It is for private review only.
"""
import base64
import csv
import html
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
root, results, manifest, out = (Path(a).resolve() for a in sys.argv[1:5])
if out.is_relative_to(REPO):
    sys.exit('OUT_FILE is inside the repository; review-pending and third-party art must stay outside it')
data = json.loads(results.read_text(encoding='utf-8'))
rows = {r['id']: r for r in csv.DictReader(manifest.open(encoding='utf-8'))}
SETS = ['twemoji', 'openmoji', 'noto', 'fluent']


def img(name, sid):
    raw = (root / name / f'{sid}.png').read_bytes()
    return f'<img src="data:image/png;base64,{base64.b64encode(raw).decode()}" width="64" height="64" alt="">'


body = []
for sid, g in data['glyphs'].items():
    r = rows[sid]
    cells = [f'<td class="id"><b>{html.escape(r["name"])}</b><br>{sid}<br><span class="{"flag" if g["flag"] else ""}">'
             f'最高 {g["ours_max"]:.2f}／同題基準 {g["independent_max"]:.2f}</span></td>',
             f'<td>{img("ours", sid)}</td>', f'<td class="native">{html.escape(r["fallback"])}</td>']
    cells += [f'<td>{img(s, sid)}<br><small>{g["ours_vs_set"][s]["score"]:.2f}</small></td>' for s in SETS]
    body.append('<tr>' + ''.join(cells) + '</tr>')
page = f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>DayPop 貼圖相似性比對</title>
<style>body{{font:14px -apple-system,system-ui,sans-serif;margin:12px;background:#fff;color:#111}}
table{{border-collapse:collapse}}td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:center;vertical-align:middle}}
td.id{{text-align:left;font-size:12px}}td.native{{font-size:56px;line-height:64px}}.flag{{color:#b00020;font-weight:700}}
small{{color:#666}}.wrap{{overflow-x:auto}}</style></head><body>
<h1>DayPop 貼圖相似性比對（私下審閱用，勿散布）</h1>
<p>第三欄是這台裝置自己的 emoji：在 iPhone 上就是 Apple 的設計。請看有沒有「看起來就是同一張」的組合；
題材相同造成的相像（例如都是五角星）不算。分數是四項量測的平均，0–1，越高越像；
紅字代表比該題材的四套獨立設計彼此之間還像，只是「請多看一眼」。</p>
<div class="wrap"><table><thead><tr><th>貼圖</th><th>DayPop</th><th>本機 emoji</th><th>Twemoji</th><th>OpenMoji</th><th>Noto</th><th>Fluent</th></tr></thead>
<tbody>{''.join(body)}</tbody></table></div>
<p><small>比對用素材：Twemoji（CC BY 4.0，@twemoji/svg 15.0.0）、OpenMoji（CC BY-SA 4.0，openmoji 17.0.0）、
Noto Color Emoji（Apache 2.0，emoji-datasource-google 16.0.0）、Fluent Emoji（MIT，@lobehub/fluent-emoji-flat 1.1.0）。
DayPop 貼圖授權仍為 review-pending。</small></p></body></html>'''
out.write_text(page, encoding='utf-8')
print(out, len(page))

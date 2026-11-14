#!/usr/bin/env python3
"""Build a single-file preview: the DP-244 stickers at real CSS pixel sizes.

Usage, from the repository root:

    python3 -I docs/sticker-concepts/2026-11-14/build_preview.py ASSETS_DIR OUT_FILE

Reads manifest.csv beside this script and the SVGs in ASSETS_DIR. The SVGs and
the preview stay outside the repository while their licence is review-pending
(OWNER-DECISIONS 2026-11-14, item 6), so OUT_FILE must not be under the repo.
Every SVG is embedded as a data: URI on an <img>, the element an App would use,
so the file opens anywhere (a phone, the Claude app's file viewer) without
relative paths or a network. Open it at 100% zoom; do not judge 10px from a
zoomed screenshot.
"""
import base64
import csv
import html
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS, OUT = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if OUT.is_relative_to(HERE.parents[2]):
    sys.exit('OUT_FILE is inside the repository; review-pending art must stay outside it')
SIZES = [10, 12, 15, 16, 19, 20, 22, 23]
# Where the App draws stickers today (DP-055/243): month cell by count, day
# detail row, picker, overview.
WHERE = '月格 19／15／12／10px・日詳情 20px・選擇器 22px・綜覽 23px'


def uri(path):
    return 'data:image/svg+xml;base64,' + base64.b64encode(path.read_bytes()).decode()


rows = list(csv.DictReader((HERE / 'manifest.csv').open(encoding='utf-8-sig', newline='')))
items = [{'id': r['id'], 'name': r['name'], 'fallback': r['fallback'],
          'now': uri(ASSETS / r['file']), 'now_bytes': (ASSETS / r['file']).stat().st_size}
         for r in rows]


def img(src, px, alt):
    return f'<img src="{src}" width="{px}" height="{px}" alt="{html.escape(alt)}">'


def size_table(theme, key, caption):
    head = ''.join(f'<th>{s}</th>' for s in SIZES)
    body = []
    for it in items:
        art = ''.join(f'<td>{img(it[key], s, it["name"])}</td>' for s in SIZES)
        emo = ''.join(f'<td><span class="emo" style="font-size:{s}px">{it["fallback"]}</span></td>' for s in SIZES)
        body.append(f'<tr><th class="l">{it["name"]}<small>{it[key + "_bytes"]} B</small></th>{art}</tr>'
                    f'<tr class="fb"><th class="l">{it["fallback"]}<small>emoji</small></th>{emo}</tr>')
    return (f'<section class="{theme}"><h2>{caption}・{"#FFFFFF" if theme == "light" else "#111111"}</h2>'
            f'<div class="scroll"><table><thead><tr><th class="l">CSS px</th>{head}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table></div></section>')


def cells(theme):
    out = []
    for count, px in ((1, 19), (2, 15), (3, 12), (4, 10)):
        picks = [items[i % len(items)] for i in range(count)]
        art = ''.join(img(it['now'], px, it['name']) for it in picks)
        emo = ''.join(f'<span style="font-size:{px}px">{it["fallback"]}</span>' for it in picks)
        out.append(f'<div class="cell"><b>{10 + count}</b><div class="stk">{art}</div><small>{count}張 {px}px</small></div>'
                   f'<div class="cell"><b>{10 + count}</b><div class="stk">{emo}</div><small>emoji</small></div>')
    return (f'<section class="{theme}"><h2>月格情境（模擬，不是 App 畫面）・'
            f'{"#FFFFFF" if theme == "light" else "#111111"}</h2><div class="cells">{"".join(out)}</div></section>')


page = f'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DP-244 貼圖實寸</title>
<style>
body{{margin:0;background:#f3f0ed;color:#261c22;font:14px/1.5 system-ui,-apple-system,"Noto Sans TC",sans-serif;padding:16px}}
main{{max-width:960px;margin:auto}} h1{{font-size:20px;margin:0 0 4px}} p{{margin:4px 0 12px;color:#5c5257}}
section{{border-radius:14px;padding:12px;margin:12px 0}} .light{{background:#fff}} .dark{{background:#111;color:#f2f2f2}}
h2{{font-size:14px;margin:0 0 8px}} .scroll{{overflow-x:auto}} table{{border-collapse:collapse}}
th,td{{padding:5px 6px;text-align:center;vertical-align:middle}} th{{font-size:11px;font-weight:600}}
th.l{{text-align:left;white-space:nowrap;font-size:12px;width:48px}} th.l small{{display:block;font-weight:400;opacity:.65}}
tr.fb th,tr.fb td{{padding-top:0}} img{{display:block;margin:auto}} .emo{{line-height:1}}
.cells{{display:flex;flex-wrap:wrap}} .cell{{width:54px;height:96px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;display:flex;flex-direction:column;align-items:center;padding:3px 0}}
.dark .cell{{border-color:#5a5a5a}} .cell b{{font-size:12px}} .stk{{margin-top:auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-end;gap:2px;line-height:1}}
.cell small{{font-size:8px;opacity:.6}}
</style></head><body><main>
<h1>DP-244 Phase 1｜貼圖實寸預覽</h1>
<p>手機瀏覽器縮放保持 100%，不要放大判讀。每張下一列是同尺寸的系統 emoji（也就是 fallback）。App 目前的尺寸：{WHERE}。</p>
<p>判準：16px 認得出是什麼；10px 至少認得出輪廓與主色；深淺背景邊緣都看得到。授權仍是 review-pending，這頁只給擁有者審閱。</p>
{size_table("light", "now", "目前版本")}{size_table("dark", "now", "目前版本")}
{cells("light")}{cells("dark")}
</main></body></html>
'''
OUT.write_text(page, encoding='utf-8')
print(f'{OUT.name} {len(page.encode())} bytes, {len(items)} stickers')

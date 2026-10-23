"""Compose before/after evidence using original Git blobs and actual new renders."""
import io
import json
import subprocess
from PIL import Image, ImageDraw
from make_board import ROOT, font, paste


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    repo = ROOT.parents[2]
    baseline = manifest["conceptBaseline"]
    board = Image.new("RGB", (1200, 1050), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((30, 24), "DAYPOP / SELECTED CHARACTER REFINEMENT", fill="#46536b", font=font(16))
    draw.text((30, 58), "月光貓 ＋ 軌道噗 · 選款後細修", fill="#182037", font=font(32))
    draw.text((30, 108), "同樣 60px 控制項，更完整利用畫布；維持固定配色與透明安全區。", fill="#596172", font=font(17))
    for row, (kind, title, note) in enumerate([("moon_cat", "月光貓", "融合頭耳、柔化材質、收細捲尾並補上鬍鬚"), ("orbit_ufo", "軌道噗", "分開環帶層次、露出舷窗，整理觸腳與材質")]):
        y = 163 + row * 423
        draw.rounded_rectangle((24, y, 1176, y + 401), radius=18, fill="white")
        draw.text((45, y + 12), f"{title}  /  {note}", fill="#182037", font=font(20))
        draw.text((45, y + 54), "概念稿", fill="#596172", font=font(15))
        draw.text((406, y + 54), "細修後", fill="#596172", font=font(15))
        for size, x, top in [(768, 30, y + 78), (60, 835, y + 125)]:
            relative = f"docs/pet-concepts/2026-10-23/renders/{kind}-{size}.png"
            raw = subprocess.run(["git", "show", f"{baseline}:{relative}"], cwd=repo, capture_output=True, check=True).stdout
            image = Image.open(io.BytesIO(raw)).convert("RGBA")
            if size == 768:
                image = image.resize((320, 320), Image.Resampling.LANCZOS)
            board.paste(image, (x, top), image)
        paste(board, ROOT / f"renders/{kind}-768.png", (391, y + 78), 320)
        draw.text((816, y + 80), "60px 原尺寸", fill="#182037", font=font(17))
        draw.text((816, y + 205), "之前", fill="#596172", font=font(14))
        draw.text((956, y + 205), "之後", fill="#596172", font=font(14))
        paste(board, ROOT / f"renders/{kind}-60.png", (975, y + 125))
        draw.text((816, y + 260), "可見長邊：44px → 50px", fill="#182037", font=font(17))
        draw.text((816, y + 296), "四周至少 4px 全透明", fill="#596172", font=font(15))
        draw.text((816, y + 328), "僅 idle，尚未接入 App", fill="#596172", font=font(15))
    draw.text((30, 1018), "造型待擁有者確認後才擴充動作；比較取自真正 Blender 渲染，不是示意重畫。", fill="#596172", font=font(15))
    board.save(ROOT / "selected-refinement.png", optimize=True)


if __name__ == "__main__":
    main()

"""Compose review boards from actual Blender renders; requires Pillow.

Does not paint, generate, retouch or replace the character artwork.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONT = Path("C:/Windows/Fonts/msjh.ttc")
LABELS = {
    "moon_cat": ("月光貓", "奶油白 × 月光紫", "圓潤貓咪、月牙額飾與星星項圈"),
    "orbit_ufo": ("軌道噗", "珊瑚橘 × 冰川薄荷", "會眨眼的飛碟生物、柔軟觸腳"),
    "cloud_teapot": ("星茶壺", "薰衣草紫 × 蜂蜜金", "雲朵瓷壺，把小星星泡成蒸氣"),
    "sprout_rover": ("芽芽車", "奶油白 × 翡翠綠", "載著幼苗旅行的迷你陪伴機器人"),
}


def font(size):
    return ImageFont.truetype(str(FONT), size)


def paste(board, path, xy, size=None):
    image = Image.open(path).convert("RGBA")
    if size:
        image = image.resize((size, size), Image.Resampling.LANCZOS)
    board.paste(image, xy, image)


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    board = Image.new("RGB", (1200, 1040), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((36, 24), "DAYPOP  /  CHARACTER STUDIES 01", fill="#46536b", font=font(16))
    draw.text((36, 54), "四款創意夥伴 · Blender 概念試作", fill="#182037", font=font(32))
    status = "月光貓＋軌道噗已選細修；其餘保留探索紀錄" if manifest.get("selectedForRefinement") else "造型待選定"
    draw.text((36, 101), f"精緻卡通 3D ＋ 漫畫描邊　／　固定配色　／　{status}", fill="#596172", font=font(17))
    for index, item in enumerate(manifest["concepts"]):
        x, y = 30 + (index % 2) * 585, 148 + (index // 2) * 420
        draw.rounded_rectangle((x, y, x + 555, y + 397), radius=20, fill="white", outline="#dededc", width=1)
        title, palette, description = LABELS[item["id"]]
        selected = " · 已選細修" if item["id"] in manifest.get("selectedForRefinement", []) else ""
        draw.text((x + 22, y + 16), f"0{index + 1}  {title}{selected}", fill="#182037", font=font(25))
        draw.text((x + 22, y + 53), description, fill="#596172", font=font(14))
        paste(board, ROOT / item["renders"]["768"], (x + 4, y + 88), 300)
        draw.text((x + 317, y + 93), palette, fill="#596172", font=font(13))
        draw.text((x + 317, y + 128), "120px 素材", fill="#182037", font=font(14))
        paste(board, ROOT / item["renders"]["120"], (x + 317, y + 153))
        draw.text((x + 317, y + 290), "60px 實際顯示", fill="#182037", font=font(14))
        paste(board, ROOT / item["renders"]["60"], (x + 317, y + 320))
        kb = item["measurements"]["120"]["bytes"] / 1024
        draw.text((x + 405, y + 338), f"{kb:.2f} KiB", fill="#596172", font=font(13))
    draw.text((36, 1003), "原創 Blender 建模與透明渲染；不是 App 已上線畫面。名稱、品種與動作仍待定案。", fill="#596172", font=font(15))
    board.save(ROOT / "concept-board.png", optimize=True)
    themes = json.loads((ROOT / "theme-backgrounds.json").read_text(encoding="utf8"))
    board = Image.new("RGB", (1200, 680), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((30, 20), "60px 原尺寸 · 十二組主題背景", fill="#182037", font=font(26))
    draw.text((30, 62), "背景色取自目前 themes.ts；這是素材辨識檢查，不是 App 整合驗收。", fill="#596172", font=font(15))
    for index, theme in enumerate(themes):
        x, y = 24 + (index % 4) * 294, 112 + (index // 4) * 180
        draw.rounded_rectangle((x, y, x + 276, y + 158), radius=10, fill=theme["bg"])
        draw.text((x + 12, y + 12), theme["label"], fill=theme["fg"], font=font(14))
        for col, item in enumerate(manifest["concepts"]):
            paste(board, ROOT / item["renders"]["60"], (x + 10 + col * 65, y + 55))
    board.save(ROOT / "theme-check.png", optimize=True)


if __name__ == "__main__":
    main()

"""DP-185: compare actual old Git renders with current Blender idle renders."""
import io
import json
import subprocess
from PIL import Image, ImageDraw
from make_board import ROOT, font, paste


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    repo = ROOT.parents[2]
    board = Image.new("RGB", (1200, 1050), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((30, 24), "DAYPOP / SOFTER FACES & NATURAL SILHOUETTES", fill="#46536b", font=font(16))
    draw.text((30, 58), "月光貓 ＋ 軌道噗 · 造型再調整", fill="#182037", font=font(32))
    draw.text((30, 108), "小眼睛、柔霧材質；貓咪自然坐姿，飛碟改為懸浮生物。", fill="#596172", font=font(17))
    for row, (kind, title, note) in enumerate([("moon_cat", "月光貓", "五官貼合臉部、短前爪與連續坐姿輪廓"), ("orbit_ufo", "軌道噗", "移除長腿與鞋形腳墊，簡化表情與光澤")]):
        y = 163 + row * 423
        draw.rounded_rectangle((24, y, 1176, y + 401), radius=18, fill="white")
        draw.text((45, y + 12), f"{title}  /  {note}", fill="#182037", font=font(20))
        draw.text((45, y + 54), "上一版（DP-184）", fill="#596172", font=font(15))
        draw.text((406, y + 54), "本次調整（DP-185）", fill="#596172", font=font(15))
        for size, x, top in [(768, 30, y + 78), (60, 835, y + 125)]:
            relative = f"docs/pet-concepts/2026-10-23/renders/{kind}-{size}.png"
            raw = subprocess.run(["git", "show", f"{manifest['appearanceBaseline']}:{relative}"], cwd=repo, capture_output=True, check=True).stdout
            prior = Image.open(io.BytesIO(raw)).convert("RGBA")
            if size == 768:
                prior = prior.resize((320, 320), Image.Resampling.LANCZOS)
            board.paste(prior, (x, top), prior)
        paste(board, ROOT / f"renders/{kind}-768.png", (391, y + 78), 320)
        draw.text((816, y + 80), "60px 原尺寸", fill="#182037", font=font(17))
        draw.text((816, y + 205), "之前", fill="#596172", font=font(14))
        draw.text((956, y + 205), "之後", fill="#596172", font=font(14))
        paste(board, ROOT / f"renders/{kind}-60.png", (975, y + 125))
        draw.text((816, y + 260), "同樣的 60px 顯示框", fill="#182037", font=font(17))
        draw.text((816, y + 296), "四周至少 4px 全透明", fill="#596172", font=font(15))
        draw.text((816, y + 328), "idle 試作 · 造型待確認", fill="#596172", font=font(15))
    draw.text((30, 1018), "皆為真實 Blender 渲染；本輪尚未接入 App，造型確認後才規劃動作。", fill="#596172", font=font(15))
    board.save(ROOT / "friendly-refinement.png", optimize=True)


if __name__ == "__main__":
    main()

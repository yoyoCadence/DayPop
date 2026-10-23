"""Encode actual Blender PNGs, measure candidates and compose review evidence."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from make_board import font


def main():
    repack = "--review-only" not in sys.argv
    manifest = json.loads((ROOT / ("render-manifest.json" if repack else "manifest.json")).read_text(encoding="utf8"))
    for char in manifest["characters"] if repack else ():
        hashes = {}
        for state, clip in char["clips"].items():
            images = [Image.open(ROOT / p).convert("RGBA") for p in clip["frames"]]
            out = ROOT / "previews" / char["id"]
            out.mkdir(parents=True, exist_ok=True)
            static = out / f"{state}-static.png"
            shutil.copyfile(ROOT / clip["frames"][0], static)
            clip["static"] = static.relative_to(ROOT).as_posix()
            clip["pngBytes"] = sum((ROOT / p).stat().st_size for p in clip["frames"])
            clip["candidateBytes"] = {}
            for fmt, ext in (("webp", "webp"), ("apng", "png"), ("webpQ85", "q85.webp")) if state != "grab" else ():
                path = out / f"{state}.{ext}"
                options = {"lossless": True, "method": 6} if fmt == "webp" else {"lossless": False, "quality": 85, "method": 6, "alpha_quality": 100} if fmt == "webpQ85" else {"optimize": True, "disposal": 0, "blend": 0}
                images[0].save(path, format="PNG" if fmt == "apng" else "WEBP", save_all=True,
                               append_images=images[1:], duration=100, loop=0 if state == "idle" else 1, **options)
                clip["candidates"][fmt] = path.relative_to(ROOT).as_posix()
                clip["candidateBytes"][fmt] = path.stat().st_size
            for rel in [*clip["frames"], clip["static"], *clip["candidates"].values()]:
                hashes[rel] = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
        hashes[char["source"]] = hashlib.sha256((ROOT / char["source"]).read_bytes()).hexdigest()
        char["sha256"] = hashes
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    board = Image.new("RGB", (1260, 930), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((30, 22), "DAYPOP / BLENDER MOTION STUDIES", font=font(16), fill="#46536b")
    draw.text((30, 54), "月光貓 ＋ 軌道噗 · 三態素材試作", font=font(30), fill="#182037")
    draw.text((30, 103), "idle 4.4s  ／  look 1.6s 單次  ／  grab 靜態　·　未接入 App", font=font(18), fill="#596172")
    for row, char in enumerate(manifest["characters"]):
        y = 154 + row * 370
        draw.rounded_rectangle((24, y, 1236, y + 348), radius=16, fill="white")
        draw.text((42, y + 12), "月光貓" if row == 0 else "軌道噗", font=font(23), fill="#182037")
        x = 42
        for state, indices in (("idle", (0, 11, 38)), ("look", (4, 11)), ("grab", (0,))):
            for index in indices:
                image = Image.open(ROOT / char["clips"][state]["frames"][index]).convert("RGBA")
                large = image.resize((180, 180), Image.Resampling.LANCZOS)
                board.paste(large, (x, y + 56), large)
                draw.text((x + 12, y + 238), f"{state} · {index + 1:02}", font=font(14), fill="#596172")
                small = image.resize((60, 60), Image.Resampling.LANCZOS)
                board.paste(small, (x + 60, y + 270), small)
                x += 194
    draw.text((30, 905), "上排 180px 放大、下排 60px 原尺寸；真實 Blender PNG 幀，非示意重畫。", font=font(15), fill="#596172")
    board.save(ROOT / "contact-sheet.png", optimize=True)
    # Review-only composite GIF: solid background and labels, never an App
    # candidate. The per-character transparent outputs remain untouched.
    review = []
    for index in range(44):
        frame = Image.new("RGB", (640, 350), "#f5f3ee")
        draw = ImageDraw.Draw(frame)
        draw.text((24, 12), "Blender idle · 4.4 秒循環 · 素材試作", font=font(20), fill="#182037")
        for col, char in enumerate(manifest["characters"]):
            image = Image.open(ROOT / char["clips"]["idle"]["frames"][index]).convert("RGBA")
            large = image.resize((240, 240), Image.Resampling.LANCZOS)
            frame.paste(large, (30 + col * 310, 58), large)
            draw.text((90 + col * 310, 304), "月光貓" if col == 0 else "軌道噗", font=font(18), fill="#596172")
        review.append(frame)
    review[0].save(ROOT / "idle-review.gif", save_all=True, append_images=review[1:], duration=100, loop=0, optimize=True)
    themes = json.loads((ROOT.parent / "theme-backgrounds.json").read_text(encoding="utf8"))
    board = Image.new("RGB", (1200, 1250), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((30, 20), "三態關鍵姿勢 · 十二背景 · 60px 原尺寸", font=font(26), fill="#182037")
    draw.text((30, 65), "每款 idle 首幀、look 第五幀、grab；其餘幀由逐幀透明／解碼驗收負責。", font=font(15), fill="#596172")
    for index, theme in enumerate(themes):
        x, y = 24 + index % 2 * 586, 108 + index // 2 * 185
        draw.rounded_rectangle((x, y, x + 566, y + 166), radius=12, fill=theme["bg"])
        draw.text((x + 14, y + 12), theme["label"], font=font(15), fill=theme["fg"])
        for col, char in enumerate(manifest["characters"]):
            for offset, (state, frame_index) in enumerate((("idle", 0), ("look", 4), ("grab", 0))):
                left = x + 14 + (col * 3 + offset) * 92
                image = Image.open(ROOT / char["clips"][state]["frames"][frame_index]).convert("RGBA").resize((60, 60), Image.Resampling.LANCZOS)
                board.paste(image, (left + 8, y + 53), image)
                draw.text((left, y + 125), ("貓" if col == 0 else "噗") + "·" + state, font=font(12), fill=theme["fg"])
    board.save(ROOT / "theme-check.png", optimize=True)
    print(json.dumps({c["id"]: {s: {k: v for k, v in p.items() if k in ("pngBytes", "candidateBytes")} for s, p in c["clips"].items()} for c in manifest["characters"]}))


if __name__ == "__main__":
    main()

"""Encode the rendered jump study and compose evidence from actual PNGs."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
from PIL import Image, ImageDraw
from trial_contract import package_bytes

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parents[1] / "2026-10-23"
sys.path.insert(0, str(PREVIOUS))
sys.path.insert(0, str(PREVIOUS / "motion"))
from make_board import font
from check_motion import difference

manifest = json.loads((ROOT / "render-manifest.json").read_text(encoding="utf8"))
for char in manifest["characters"]:
    frames = [Image.open(ROOT / p).convert("RGBA") for p in char["frames"]]
    out = ROOT / "previews" / char["id"]
    out.mkdir(parents=True, exist_ok=True)
    static = out / "jump-static.png"
    shutil.copyfile(ROOT / char["frames"][0], static)
    char["static"] = static.relative_to(ROOT).as_posix()
    char["pngBytes"] = sum((ROOT / p).stat().st_size for p in char["frames"])
    char["candidates"], char["candidateBytes"], char["measurements"] = {}, {}, {}
    for fmt, filename, options in (("webp", "jump.webp", {"lossless": True}),
                                   ("webpQ85", "jump.q85.webp", {"lossless": False, "quality": 85, "alpha_quality": 100})):
        path = out / filename
        frames[0].save(path, format="WEBP", save_all=True, append_images=frames[1:], duration=100, loop=1, method=6, **options)
        char["candidates"][fmt] = path.relative_to(ROOT).as_posix()
        char["candidateBytes"][fmt] = path.stat().st_size
        image = Image.open(path)
        elapsed, errors = 0, []
        for index in range(image.n_frames):
            image.seek(index)
            decoded = image.convert("RGBA")
            errors.append(difference(frames[min(int(elapsed // 100), 9)], decoded))
            elapsed += image.info["duration"]
        char["measurements"][fmt] = {"decodedFrames": image.n_frames, "durationMs": elapsed, "maxCompositedMeanAbsoluteError": max(errors)}
    paths = [char["source"], *char["frames"], char["static"], *char["candidates"].values()]
    char["sha256"] = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}
    current = package_bytes(char["id"])
    char["budgetTrial"] = {"currentAppBytes": current, "characterLimitBytes": 192 * 1024,
        "withJumpSharingIdlePng": current + char["candidateBytes"]["webpQ85"],
        "withJumpAndOwnPng": current + char["candidateBytes"]["webpQ85"] + static.stat().st_size}
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

board = Image.new("RGB", (1050, 720), "#f5f3ee")
draw = ImageDraw.Draw(board)
draw.text((24, 16), "月光貓 ＋ 軌道噗 · jump 素材試作", font=font(28), fill="#182037")
draw.text((24, 61), "1 秒單次 · 蓄力／小幅離地／回到 idle · 未接入 App", font=font(18), fill="#596172")
for row, char in enumerate(manifest["characters"]):
    y = 105 + row * 294
    draw.rounded_rectangle((18, y, 1032, y + 280), radius=14, fill="white")
    draw.text((32, y + 10), "月光貓" if row == 0 else "軌道噗", font=font(22), fill="#182037")
    images = [Image.open(PREVIOUS / "motion/frames" / char["id"] / "idle/000.png").convert("RGBA")]
    samples = (1, 3, 5, 9)
    images += [Image.open(ROOT / char["frames"][index]).convert("RGBA") for index in samples]
    for col, image in enumerate(images):
        x = 32 + col * 200
        large = image.resize((160, 160), Image.Resampling.LANCZOS)
        board.paste(large, (x + 14, y + 42), large)
        small = image.resize((60, 60), Image.Resampling.LANCZOS)
        board.paste(small, (x + 68, y + 210), small)
        draw.text((x + 20, y + 185), "既有 idle" if col == 0 else f"jump · {samples[col-1]+1:02}", font=font(14), fill="#596172")
draw.text((24, 699), "上排放大、下排 60px；同一相機／比例，直接取真實 Blender 幀。", font=font(14), fill="#596172")
board.save(ROOT / "contact-sheet.png", optimize=True)

review = []
for index in range(10):
    frame = Image.new("RGB", (640, 350), "#f5f3ee")
    draw = ImageDraw.Draw(frame)
    draw.text((24, 10), "jump · 1 秒單次（此 GIF 重播供檢視）", font=font(20), fill="#182037")
    for col, char in enumerate(manifest["characters"]):
        image = Image.open(ROOT / char["frames"][index]).convert("RGBA").resize((240, 240), Image.Resampling.LANCZOS)
        frame.paste(image, (30 + col * 310, 52), image)
        draw.text((90 + col * 310, 304), "月光貓" if col == 0 else "軌道噗", font=font(18), fill="#596172")
    review.append(frame)
review[0].save(ROOT / "jump-review.gif", save_all=True, append_images=review[1:], duration=100, loop=0, optimize=True)

themes = json.loads((PREVIOUS / "theme-backgrounds.json").read_text(encoding="utf8"))
board = Image.new("RGB", (1000, 1150), "#f5f3ee")
draw = ImageDraw.Draw(board)
draw.text((24, 18), "jump 首幀 · 十二背景 · 60px 原尺寸", font=font(25), fill="#182037")
for index, theme in enumerate(themes):
    x, y = 20 + index % 2 * 490, 76 + index // 2 * 176
    draw.rounded_rectangle((x, y, x + 470, y + 156), radius=10, fill=theme["bg"])
    draw.text((x + 14, y + 10), theme["label"], font=font(16), fill=theme["fg"])
    for col, char in enumerate(manifest["characters"]):
        image = Image.open(ROOT / char["static"]).convert("RGBA").resize((60, 60), Image.Resampling.LANCZOS)
        board.paste(image, (x + 104 + col * 190, y + 63), image)
board.save(ROOT / "theme-check.png", optimize=True)
print(json.dumps({c["id"]: {"pngBytes": c["pngBytes"], "candidateBytes": c["candidateBytes"], "measurements": c["measurements"]} for c in manifest["characters"]}))

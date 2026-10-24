"""Encode two measured alternatives without changing native art or App assets."""
import hashlib
import io
import json
import sys
from PIL import Image, ImageDraw
from contract import ROOT, SOURCE, PLANS, source_characters, source_frames, decode, at, measure, package_bytes

sys.path.insert(0, str(ROOT.parents[1] / "2026-10-23"))
from make_board import font

manifest = {"task": "DP-195", "appIntegrated": False, "candidateAdopted": False,
    "sourceCommit": "6d5a15eb64a0dadd72c7195dfc93838791371e78", "qualityLimit": .008,
    "characterLimitBytes": 196608, "recommended": {"moon_cat": "fullQ55A70", "orbit_ufo": "reference"}, "characters": []}
for original in source_characters():
    kind = original["id"]
    frames = source_frames(original)
    reference = original["candidates"]["webpQ85"]
    char = {"id": kind, "basePackageBytes": package_bytes(kind),
        "inputSha256": {p: original["sha256"][p] for p in [*original["frames"], reference]},
        "reference": {"path": "../jump/" + reference, "bytes": (SOURCE / reference).stat().st_size,
                      "measurement": measure(SOURCE / reference, frames)}, "candidates": {}}
    for name, plan in PLANS.items():
        selected = [frames[i] for i in plan["indices"]]
        variants = {}
        for minimum in (False, True):
            out = io.BytesIO()
            selected[0].save(out, format="WEBP", save_all=True, append_images=selected[1:],
                duration=plan["durations"], loop=1, quality=plan["quality"], alpha_quality=plan["alphaQuality"], method=6, minimize_size=minimum)
            variants[minimum] = out.getvalue()
        minimum = min(variants, key=lambda option: len(variants[option]))
        path = ROOT / "candidates" / kind / (name + ".webp")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(variants[minimum])
        size = path.stat().st_size
        measurement = measure(path, frames)
        eligible = size + char["basePackageBytes"] <= 196608 and max(measurement["maxTimelineMeanAbsoluteError"], measurement["maxDarkTimelineMeanAbsoluteError"]) < .008
        char["candidates"][name] = {"path": path.relative_to(ROOT).as_posix(), "policy": plan,
            "minimizeSize": minimum, "variantBytes": {str(k): len(v) for k, v in variants.items()},
            "bytes": size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "measurement": measurement, "packageBytes": char["basePackageBytes"] + size, "eligible": eligible}
    manifest["characters"].append(char)
    print(kind, {name: c["bytes"] for name, c in char["candidates"].items()}, flush=True)
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

for ms in (300, 400):
    board = Image.new("RGB", (1100, 760), "#f5f3ee")
    draw = ImageDraw.Draw(board)
    draw.text((24, 16), f"jump 編碼比較 · 同一時間 {ms}ms", font=font(28), fill="#182037")
    draw.text((24, 58), "原十幀 Q85 ／ 六幀 Q85 ／ 七幀 Q75 · 放大及 60px · 候選未接 App", font=font(18), fill="#596172")
    for row, char in enumerate(manifest["characters"]):
        y = 98 + row * 320
        draw.rounded_rectangle((18, y, 1082, y + 306), radius=14, fill="white")
        draw.text((32, y + 8), "月光貓" if row == 0 else "軌道噗", font=font(22), fill="#182037")
        paths = [ROOT / char["reference"]["path"], *[ROOT / char["candidates"][key]["path"] for key in ("sixQ85", "sevenQ75")]]
        labels = ["原十幀 Q85", "六幀 Q85", "七幀 Q75"]
        for col, path in enumerate(paths):
            frame = at(decode(path), ms)
            x = 60 + col * 350
            large = frame.resize((200, 200), Image.Resampling.LANCZOS)
            board.paste(large, (x, y + 40), large)
            small = frame.resize((60, 60), Image.Resampling.LANCZOS)
            board.paste(small, (x + 208, y + 108), small)
            draw.text((x + 38, y + 254), labels[col], font=font(18), fill="#596172")
    draw.text((24, 738), "300ms 可見取樣 hold 的相位差；400ms 保留真正最高點，非宣稱微動完全相同。", font=font(16), fill="#596172")
    board.save(ROOT / f"comparison-{ms}ms.png", optimize=True)

board = Image.new("RGB", (1100, 1400), "#f5f3ee")
draw = ImageDraw.Draw(board)
draw.text((24, 16), "完整十幀 · 400ms · 色彩與 alpha 量化比較", font=font(28), fill="#182037")
draw.text((24, 58), "原 Q85/A100 ／ Q55/A70 ／ Q60/A50 · 上下淺深底、放大及 60px", font=font(18), fill="#596172")
for row, (char, dark) in enumerate((c, d) for c in manifest["characters"] for d in (False, True)):
    y = 98 + row * 320
    color, ink = ("#111827", "#f3f4f6") if dark else ("white", "#182037")
    draw.rounded_rectangle((18, y, 1082, y + 306), radius=14, fill=color)
    draw.text((32, y + 8), ("月光貓" if char["id"] == "moon_cat" else "軌道噗") + (" · 深底" if dark else " · 淺底"), font=font(22), fill=ink)
    paths = [ROOT / char["reference"]["path"], *[ROOT / char["candidates"][key]["path"] for key in ("fullQ55A70", "fullQ60A50")]]
    for col, path in enumerate(paths):
        frame = at(decode(path), 400)
        x = 60 + col * 350
        large = frame.resize((200, 200), Image.Resampling.LANCZOS)
        board.paste(large, (x, y + 40), large)
        small = frame.resize((60, 60), Image.Resampling.LANCZOS)
        board.paste(small, (x + 208, y + 108), small)
        draw.text((x + 38, y + 254), ["原 Q85/A100", "Q55/A70", "Q60/A50"][col], font=font(18), fill=ink)
board.save(ROOT / "full-frame-comparison.png", optimize=True)

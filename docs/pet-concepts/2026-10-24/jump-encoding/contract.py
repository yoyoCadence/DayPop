"""DP-195 trial policies; no product imports or mutable App budget inputs."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "jump"
sys.path.insert(0, str(SOURCE))
sys.path.insert(0, str(ROOT.parents[1] / "2026-10-23/motion"))
from trial_contract import package_bytes
from check_motion import difference

PLANS = {
    "sixQ85": {"indices": [0, 2, 4, 6, 8, 9], "durations": [200, 200, 200, 200, 100, 100], "quality": 85, "alphaQuality": 100},
    "sevenQ75": {"indices": [0, 2, 3, 4, 6, 8, 9], "durations": [200, 100, 100, 200, 200, 100, 100], "quality": 75, "alphaQuality": 100},
    "fullQ55A70": {"indices": list(range(10)), "durations": [100] * 10, "quality": 55, "alphaQuality": 70},
    "fullQ60A50": {"indices": list(range(10)), "durations": [100] * 10, "quality": 60, "alphaQuality": 50},
}


def source_characters():
    return json.loads((SOURCE / "manifest.json").read_text(encoding="utf8"))["characters"]


def source_frames(char):
    for path in [*char["frames"], char["candidates"]["webpQ85"]]:
        assert hashlib.sha256((SOURCE / path).read_bytes()).hexdigest() == char["sha256"][path], "changed jump input"
    return [Image.open(SOURCE / p).convert("RGBA") for p in char["frames"]]


def decode(path):
    image = Image.open(path)
    assert image.is_animated and image.info.get("loop") == 1, "candidate must play once"
    frames, elapsed = [], 0
    for index in range(image.n_frames):
        image.seek(index)
        frame = image.convert("RGBA")
        frame.load()
        duration = image.info["duration"]
        assert duration > 0
        frames.append((elapsed, duration, frame.copy()))
        elapsed += duration
    assert elapsed == 1000, "wrong candidate duration"
    return frames


def at(frames, ms):
    return next(frame for start, duration, frame in frames if start <= ms < start + duration)


def measure(path, reference):
    frames = decode(path)
    errors = [difference(reference[index], at(frames, index * 100)) for index in range(10)]
    def dark_difference(a, b):
        background = Image.new("RGBA", a.size, "#111827")
        aa, bb = [Image.alpha_composite(background, frame).convert("RGB") for frame in (a, b)]
        return sum(ImageStat.Stat(ImageChops.difference(aa, bb)).sum) / (a.width * a.height * 3 * 255)
    dark_errors = [dark_difference(reference[index], at(frames, index * 100)) for index in range(10)]
    alpha_errors = [ImageChops.difference(reference[start // 100].getchannel("A"), frame.getchannel("A")).getextrema()[1]
                    for start, _, frame in frames]
    for _, _, frame in frames:
        assert frame.size == (120, 120)
        for size, margin in ((120, 8), (60, 4)):
            bounds = frame.resize((size, size), Image.Resampling.LANCZOS).getchannel("A").getbbox()
            assert bounds and min(bounds[:2]) >= margin and max(bounds[2:]) <= size - margin, "unsafe candidate alpha"
    return {"decodedFrames": len(frames), "durationMs": 1000,
            "decodedDurationsMs": [duration for _, duration, _ in frames],
            "maxTimelineMeanAbsoluteError": max(errors), "meanTimelineMeanAbsoluteError": sum(errors) / len(errors),
            "maxDarkTimelineMeanAbsoluteError": max(dark_errors), "maxMatchedFrameAlphaError": max(alpha_errors)}

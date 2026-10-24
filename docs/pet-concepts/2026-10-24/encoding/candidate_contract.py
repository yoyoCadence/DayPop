"""Shared source locations and actual decoded-timeline measurements for DP-191."""
import json
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OLD = ROOT.parents[1] / "2026-10-23/motion"
SLEEP = ROOT.parent / "sleep"
KINDS = ("moon_cat", "orbit_ufo")
STATES = ("idle", "look", "sleep")
sys.path.insert(0, str(OLD))
from check_motion import difference


def inputs(kind, state):
    base = SLEEP if state == "sleep" else OLD
    directory = base / "frames" / kind
    if state != "sleep":
        directory /= state
    return sorted(directory.glob("*.png")), base / "previews" / kind / f"{state}.q85.webp"


def static_paths(kind):
    return [OLD / "previews" / kind / f"{state}-static.png" for state in ("idle", "grab")] + [SLEEP / "previews" / kind / "sleep-static.png"]


def published_hashes(kind):
    hashes = {}
    for base in (OLD, SLEEP):
        manifest = json.loads((base / "manifest.json").read_text(encoding="utf8"))
        character = next(item for item in manifest["characters"] if item["id"] == kind)
        hashes.update({base / path: digest for path, digest in character["sha256"].items()})
    return hashes


def selected_indices(state, count):
    selected = list(range(0, count, 2))
    if state == "look" and selected[-1] != count - 1:
        selected.append(count - 1)
    return selected


def limits():
    pets = json.loads((REPO / "performance-budget.json").read_text(encoding="utf8"))["pets"]
    for name in ("maxCharacterBytes", "maxIdleBytes", "maxLookBytes", "maxStaticBytes"):
        assert type(pets.get(name)) is int and pets[name] > 0, "invalid existing pet limit"
    # This historical evaluation records its four original gates; later added
    # pose limits must not invalidate that recorded experiment.
    return {name: pets[name] for name in ("maxCharacterBytes", "maxIdleBytes", "maxLookBytes", "maxStaticBytes")}


def inspect(path, sources, state, held=False):
    duration = 1600 if state == "look" else 4400
    with Image.open(path) as image:
        assert image.is_animated and image.n_frames > 1, "candidate is static"
        assert image.info.get("loop") == (1 if state == "look" else 0), "wrong loop policy"
        segments, elapsed = [], 0
        for index in range(image.n_frames):
            image.seek(index)
            decoded = image.convert("RGBA")
            decoded.load()
            ms = image.info["duration"]
            assert type(ms) in (int, float) and ms > 0 and ms % 100 == 0, "invalid frame duration"
            assert decoded.size == (120, 120), "wrong canvas"
            for size, margin in ((120, 8), (60, 4)):
                frame = decoded if size == 120 else decoded.resize((60, 60), Image.Resampling.LANCZOS)
                bounds = frame.getchannel("A").getbbox()
                assert bounds and min(bounds[:2]) >= margin and max(bounds[2:]) <= size-margin, "unsafe decoded alpha"
            segments.append((int(elapsed), int(ms), decoded.copy()))
            elapsed += ms
        assert elapsed == duration, "wrong total duration"
    errors = []
    for start, ms, decoded in segments:
        for instant in range(start, start + ms, 100):
            errors.append(difference(sources[instant // 100], decoded))
    assert max(errors) < 0.008, "held-frame quality drift"
    if held and state == "look":
        assert segments[-1][2].getchannel("A").tobytes() == sources[-1].getchannel("A").tobytes(), "look final alpha must return to original last pose"
    return {"decodedFrames": len(segments), "durationMs": int(elapsed),
            "maxCompositedMeanAbsoluteError": max(errors),
            "meanCompositedMeanAbsoluteError": sum(errors)/len(errors)}

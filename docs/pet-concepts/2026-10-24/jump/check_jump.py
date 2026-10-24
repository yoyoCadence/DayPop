"""DP-194 checks actual jump pixels, encoded timing, bounds and provenance."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image
from trial_contract import package_bytes

ROOT = Path(__file__).resolve().parent
CONCEPTS = ROOT.parents[1]
sys.path.insert(0, str(CONCEPTS / "2026-10-23"))
sys.path.insert(0, str(CONCEPTS / "2026-10-23/motion"))
from check_assets import validate_sprite
from check_motion import difference


def check(root=ROOT):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf8"))
    assert manifest["task"] == "DP-194" and manifest["productionReady"] is False
    assert manifest["appIntegrated"] is False and manifest["jumpMotionApproved"] is False
    assert {c["id"] for c in manifest["characters"]} == {"moon_cat", "orbit_ufo"}
    published = json.loads((CONCEPTS / "2026-10-23/motion/manifest.json").read_text(encoding="utf8"))
    for char in manifest["characters"]:
        original = next(c for c in published["characters"] if c["id"] == char["id"])
        inputs = [original["source"], original["clips"]["idle"]["frames"][0]]
        assert char["inputSha256"] == {"../../2026-10-23/motion/" + p: original["sha256"][p] for p in inputs}, "unpublished input provenance"
        assert char["camera"] == original["camera"] and char["anchor"] == original["anchor"]
        assert char["durationMs"] == 1000 and char["loop"] is False
        assert set(char["candidates"]) == {"webp", "webpQ85"}
        assert len(char["frames"]) == 10 and char["frameDurationMs"] == 100
        assert {p.name for p in (root / char["frames"][0]).parent.glob("*.png")} == {Path(p).name for p in char["frames"]}
        frames = []
        for relative in char["frames"]:
            path = root / relative
            validate_sprite(path, 120)
            frame = Image.open(path).convert("RGBA")
            bounds = frame.resize((60, 60), Image.Resampling.LANCZOS).getchannel("A").getbbox()
            assert bounds and min(bounds[:2]) >= 4 and max(bounds[2:]) <= 56, "unsafe 60px alpha"
            frames.append(frame.copy())
        assert len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}) >= 6, "frozen jump"
        assert frames[0].tobytes() == frames[-1].tobytes(), "jump must return to neutral"
        assert (root / char["static"]).read_bytes() == (root / char["frames"][0]).read_bytes(), "missing/mismatched static alternative"
        # A single jump starts and ends at the already published idle pose.
        idle = CONCEPTS / "2026-10-23/motion/frames" / char["id"] / "idle/000.png"
        assert frames[0].tobytes() == Image.open(idle).convert("RGBA").tobytes(), "jump must start at original idle"
        for fmt, relative in char["candidates"].items():
            image = Image.open(root / relative)
            assert image.is_animated and image.n_frames > 1, "encoded jump is static"
            assert image.info.get("loop") == 1, "jump must play once"
            elapsed, errors = 0, []
            for index in range(image.n_frames):
                image.seek(index)
                decoded = image.convert("RGBA")
                decoded.load()
                assert decoded.size == (120, 120)
                bounds = decoded.getchannel("A").getbbox()
                assert bounds and min(bounds[:2]) >= 8 and max(bounds[2:]) <= 112, "encoded unsafe alpha"
                small = decoded.resize((60, 60), Image.Resampling.LANCZOS).getchannel("A").getbbox()
                assert small and min(small[:2]) >= 4 and max(small[2:]) <= 56, "encoded unsafe 60px alpha"
                errors.append(difference(frames[min(int(elapsed // 100), 9)], decoded))
                elapsed += image.info["duration"]
            assert elapsed == 1000, "wrong decoded jump duration"
            assert max(errors) < 0.008, "encoded jump quality drift"
            assert (root / relative).stat().st_size == char["candidateBytes"][fmt], "stale encoded bytes"
        for relative, expected in char["sha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, f"changed output: {relative}"
        assert set(char["sha256"]) == {char["source"], *char["frames"], char["static"], *char["candidates"].values()}, "incomplete output hashes"
        assert char["pngBytes"] == sum((root / p).stat().st_size for p in char["frames"])
        for relative, expected in char["inputSha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, f"changed old input: {relative}"
        budget = char["budgetTrial"]
        actual = package_bytes(char["id"])
        assert budget == {"currentAppBytes": actual, "characterLimitBytes": 196608,
            "withJumpSharingIdlePng": actual + char["candidateBytes"]["webpQ85"],
            "withJumpAndOwnPng": actual + char["candidateBytes"]["webpQ85"] + (root / char["static"]).stat().st_size}, "stale budget trial"
        print("JUMP PASS", char["id"], "10 safe frames, neutral endpoints, single-play candidates, original inputs unchanged")


if __name__ == "__main__":
    check()

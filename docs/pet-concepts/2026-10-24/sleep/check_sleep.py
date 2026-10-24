"""DP-190 checks actual sleep pixels, encoded timing, bounds and provenance."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent
CONCEPTS = ROOT.parents[1]
sys.path.insert(0, str(CONCEPTS / "2026-10-23"))
sys.path.insert(0, str(CONCEPTS / "2026-10-23/motion"))
from check_assets import validate_sprite
from check_motion import difference


def check(root=ROOT):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf8"))
    assert manifest["task"] == "DP-190" and manifest["productionReady"] is False
    assert manifest["appIntegrated"] is False and manifest["sleepMotionApproved"] is False
    assert {c["id"] for c in manifest["characters"]} == {"moon_cat", "orbit_ufo"}
    for char in manifest["characters"]:
        assert char["durationMs"] == 4400 and char["loop"] is True
        assert set(char["candidates"]) == {"webp", "webpQ85"}
        assert len(char["frames"]) == 44 and char["frameDurationMs"] == 100
        assert {p.name for p in (root / char["frames"][0]).parent.glob("*.png")} == {Path(p).name for p in char["frames"]}
        frames = []
        for relative in char["frames"]:
            path = root / relative
            validate_sprite(path, 120)
            frame = Image.open(path).convert("RGBA")
            bounds = frame.resize((60, 60), Image.Resampling.LANCZOS).getchannel("A").getbbox()
            assert bounds and min(bounds[:2]) >= 4 and max(bounds[2:]) <= 56, "unsafe 60px alpha"
            frames.append(frame.copy())
        assert len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}) >= 6, "frozen sleep"
        assert difference(frames[0], frames[-1]) < 0.003, "sleep loop seam"
        assert (root / char["static"]).read_bytes() == (root / char["frames"][0]).read_bytes(), "missing/mismatched static alternative"
        # Distinguish a genuine new resting pose from a repack of the old idle.
        idle = CONCEPTS / "2026-10-23/motion/frames" / char["id"] / "idle/000.png"
        assert difference(frames[0], Image.open(idle).convert("RGBA")) > 0.001, "sleep must differ from open-eye idle"
        for fmt, relative in char["candidates"].items():
            image = Image.open(root / relative)
            assert image.is_animated and image.n_frames > 1, "encoded sleep is static"
            assert image.info.get("loop") == 0, "sleep must loop"
            elapsed, errors = 0, []
            for index in range(image.n_frames):
                image.seek(index)
                decoded = image.convert("RGBA")
                decoded.load()
                assert decoded.size == (120, 120)
                bounds = decoded.getchannel("A").getbbox()
                assert bounds and min(bounds[:2]) >= 8 and max(bounds[2:]) <= 112, "encoded unsafe alpha"
                errors.append(difference(frames[min(int(elapsed // 100), 43)], decoded))
                elapsed += image.info["duration"]
            assert elapsed == 4400, "wrong decoded sleep duration"
            assert max(errors) < 0.008, "encoded sleep quality drift"
            assert (root / relative).stat().st_size == char["candidateBytes"][fmt], "stale encoded bytes"
        for relative, expected in char["sha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, f"changed output: {relative}"
        for relative, expected in char["inputSha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, f"changed old input: {relative}"
        print("SLEEP PASS", char["id"], "44 safe frames, genuine pose, looping candidates, original inputs unchanged")


if __name__ == "__main__":
    check()

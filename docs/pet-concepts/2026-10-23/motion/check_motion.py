"""DP-187 actual PNG/timing acceptance; no Blender or App dependency."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from check_assets import validate_sprite


def difference(a, b):
    # Include alpha; composited RGB prevents transparent RGB from counting as
    # movement. Both the PNGs and native encoded candidates are decoded below.
    bg = Image.new("RGBA", a.size, "#f5f3ee")
    aa, bb = Image.alpha_composite(bg, a).convert("RGB"), Image.alpha_composite(bg, b).convert("RGB")
    delta = ImageChops.difference(aa, bb)
    return sum(ImageStat.Stat(delta).sum) / (a.width * a.height * 3 * 255)


def check(root=ROOT):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf8"))
    assert manifest["productionReady"] is False
    assert manifest["appearanceApproved"] is True
    assert {c["id"] for c in manifest["characters"]} == {"moon_cat", "orbit_ufo"}
    for char in manifest["characters"]:
        assert set(char["clips"]) == {"idle", "look", "grab"}
        for state, clip in char["clips"].items():
            expected_ms, expected_count = {"idle": (4400, 44), "look": (1600, 16), "grab": (None, 1)}[state]
            assert clip["durationMs"] == expected_ms
            assert len(clip["frames"]) == expected_count
            assert clip["frameDurationMs"] == (100 if state != "grab" else None)
            assert {p.name for p in (root / clip["frames"][0]).parent.glob("*.png")} == {Path(p).name for p in clip["frames"]}, "unexpected stale frames"
            assert clip["loop"] == (state == "idle")
            frames = []
            for relative in clip["frames"]:
                path = root / relative
                validate_sprite(path, 120)
                frame = Image.open(path).convert("RGBA")
                frames.append(frame.copy())
                # At 60px, check the real resized frame too, not just metadata.
                small = frame.resize((60, 60), Image.Resampling.LANCZOS)
                bounds = small.getchannel("A").getbbox()
                assert bounds and min(bounds[:2]) >= 4 and max(bounds[2:]) <= 56, f"unsafe 60px {path}"
            static = root / clip["static"]
            validate_sprite(static, 120)
            assert static.read_bytes() == (root / clip["frames"][0]).read_bytes(), "reduced-motion image must match first pose"
            if state != "grab":
                assert len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}) >= 6, f"frozen animation: {state}"
                assert difference(frames[0], frames[-1]) < 0.003, f"loop/return seam: {state}"
                for fmt in ("webp", "apng", "webpQ85"):
                    image = Image.open(root / clip["candidates"][fmt])
                    assert (root / clip["candidates"][fmt]).stat().st_size == clip["candidateBytes"][fmt], "stale encoded size"
                    assert image.is_animated
                    assert image.n_frames > 1
                    duration = 0
                    for i in range(image.n_frames):
                        image.seek(i)
                        decoded = image.convert("RGBA")
                        decoded.load()  # Some WebP builds fill duration on load.
                        assert decoded.size == (120, 120)
                        alpha = decoded.getchannel("A")
                        bounds = alpha.getbbox()
                        assert bounds and min(bounds[:2]) >= 8 and max(bounds[2:]) <= 112, "encoded unsafe alpha"
                        assert difference(frames[min(int(duration // 100), len(frames) - 1)], decoded) < 0.008, "encoded visible quality drift"
                        duration += image.info["duration"]
                    assert duration == expected_ms, f"wrong decoded duration {fmt}: {duration}"
                    assert image.info.get("loop") == (0 if state == "idle" else 1)
            else:
                assert not clip["candidates"]
            print("CLIP PASS", char["id"], state, len(frames), expected_ms)
        for relative, digest in char["sha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == digest, f"stale hash: {relative}"
    print("PASS: six clips, actual RGBA frames, static alternatives, encoded duration and hashes")


if __name__ == "__main__":
    check()

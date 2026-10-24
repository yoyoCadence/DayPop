"""Corrupt real jump artifacts; verify refusal and exact finally restoration."""
import contextlib
import io
import json
from PIL import Image
from check_jump import ROOT, check

manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
char = manifest["characters"][0]
frames = [ROOT / p for p in char["frames"]]
static = ROOT / char["static"]
encoded = ROOT / char["candidates"]["webpQ85"]

for case, expected in (("frozen frames", "frozen jump"), ("unsafe edge", "unsafe alpha"),
                       ("missing static", None), ("wrong timing", "wrong decoded jump duration"),
                       ("static WebP", "encoded jump is static"), ("infinite loop", "jump must play once"),
                       ("wrong final pose", "jump must return to neutral")):
    paths = frames if case == "frozen frames" else [frames[0]] if case == "unsafe edge" else [frames[-1]] if case == "wrong final pose" else [static] if case == "missing static" else [encoded]
    originals = {path: path.read_bytes() for path in paths}
    try:
        if case == "frozen frames":
            for path in frames:
                path.write_bytes(originals[frames[0]])
        elif case == "unsafe edge":
            image = Image.open(frames[0]).convert("RGBA")
            image.putpixel((0, 60), (255, 255, 255, 1))
            image.save(frames[0])
        elif case == "missing static":
            static.unlink()
        elif case == "wrong timing":
            images = [Image.open(p).convert("RGBA") for p in frames]
            images[0].save(encoded, format="WEBP", save_all=True, append_images=images[1:], duration=90, loop=1, quality=85)
        elif case == "infinite loop":
            images = [Image.open(p).convert("RGBA") for p in frames]
            images[0].save(encoded, format="WEBP", save_all=True, append_images=images[1:], duration=100, loop=0, quality=85)
        elif case == "wrong final pose":
            frames[-1].write_bytes(frames[4].read_bytes())
        else:
            Image.open(frames[0]).save(encoded, format="WEBP")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                check()
        except (AssertionError, FileNotFoundError) as error:
            if expected is None:
                assert isinstance(error, FileNotFoundError), f"unexpected rejection: {error}"
            else:
                assert expected in str(error), f"unexpected rejection: {error}"
            print("REJECTED JUMP", case, str(error).split(":")[0])
        else:
            raise AssertionError("negative control escaped: " + case)
    finally:
        for path, original in originals.items():
            path.write_bytes(original)
        assert all(path.read_bytes() == original for path, original in originals.items())
check()
print("PASS: seven real artifact negatives, exact bytes restored")

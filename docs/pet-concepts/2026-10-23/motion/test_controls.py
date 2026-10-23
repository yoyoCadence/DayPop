"""Break actual delivered artifacts, assert rejection, restore exact bytes."""
import contextlib
import io
import json
from PIL import Image
from check_motion import ROOT, check


@contextlib.contextmanager
def restore(paths):
    originals = {path: path.read_bytes() for path in paths}
    try:
        yield
    finally:
        for path, data in originals.items():
            path.write_bytes(data)
    assert all(path.read_bytes() == data for path, data in originals.items())


def rejected(label, fragment):
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            check()
    except (AssertionError, FileNotFoundError) as error:
        assert fragment in str(error), (label, str(error))
        print("REJECTED", label)
    else:
        raise AssertionError("negative control escaped: " + label)


def main():
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    clip = manifest["characters"][0]["clips"]["idle"]
    paths = [ROOT / p for p in clip["frames"]]
    with restore(paths):
        # Reverse the motion output to its real neutral render. This must fail
        # on frozen content before hash validation, not just on changed bytes.
        for path in paths:
            path.write_bytes(paths[0].read_bytes())
        rejected("all real idle frames reverted to neutral pose", "frozen animation")
    with restore([paths[4]]):
        image = Image.open(paths[4]).convert("RGBA")
        image.putpixel((0, 0), (0, 0, 0, 1))
        image.save(paths[4])
        rejected("single-alpha clipped edge", "unsafe alpha")
    with restore([manifest_path]):
        bad = json.loads(manifest_path.read_text(encoding="utf8"))
        bad["characters"][0]["clips"]["idle"]["durationMs"] = 4300
        manifest_path.write_text(json.dumps(bad), encoding="utf8")
        rejected("wrong clip duration", "")
    candidate = ROOT / clip["candidates"]["webp"]
    with restore([candidate]):
        image = Image.open(candidate)
        image.seek(0)
        image.convert("RGBA").save(candidate, format="WEBP", lossless=True)
        rejected("encoded package is actually static", "")
    static = ROOT / clip["static"]
    with restore([static]):
        static.unlink()
        rejected("real static alternative missing", static.name)
    # A changed final frame must be caught as a seam, before checking hashes.
    with restore([paths[-1]]):
        image = Image.open(paths[0]).convert("RGBA")
        image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(paths[-1])
        rejected("valid but discontinuous final frame", "loop/return seam")
    check()
    print("PASS: six negative/reversal controls; exact delivered bytes restored")


if __name__ == "__main__":
    main()

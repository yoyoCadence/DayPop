"""Seven real-file controls and one provenance control, restored after each."""
import contextlib
import io
import json
from PIL import Image
from candidate_contract import ROOT, inputs
from check_candidates import check

manifest_path = ROOT / "manifest.json"
manifest_bytes = manifest_path.read_bytes()
baseline = json.loads(manifest_bytes)
for case, expected in (("missing candidate", None), ("static candidate", "candidate is static"),
                       ("wrong duration", "wrong total duration"), ("unsafe alpha", "unsafe decoded alpha"),
                       ("mirrored artwork", "held-frame quality drift"),
                       ("missing final look pose", "look final alpha must return"),
                       ("oversized real package", "actual four-state package exceeds"),
                       ("forged source hash", "published source hash mismatch")):
    state = "look" if case == "missing final look pose" else "idle"
    clip = baseline["characters"][0]["clips"][state]
    candidate = ROOT / clip["path"]
    original = candidate.read_bytes()
    paths, _reference = inputs("moon_cat", state)
    frames = [Image.open(paths[index]).convert("RGBA") for index in clip["selectedIndices"]]
    durations = clip["selectedDurationsMs"][:]
    try:
        if case == "missing candidate":
            candidate.unlink()
        elif case == "static candidate":
            frames[0].save(candidate, format="WEBP")
        elif case == "oversized real package":
            # Valid WebP plus real trailing bytes: decoder still succeeds,
            # while the actual package, not just a table entry, exceeds 192 KiB.
            candidate.write_bytes(original + bytes(40000))
            changed = json.loads(manifest_bytes)
            changed["characters"][0]["clips"]["idle"]["bytes"] += 40000
            changed["characters"][0]["totalBytes"] += 40000
            manifest_path.write_text(json.dumps(changed), encoding="utf8")
        elif case == "forged source hash":
            changed = json.loads(manifest_bytes)
            source = next(iter(changed["characters"][0]["inputSha256"]))
            changed["characters"][0]["inputSha256"][source] = "0" * 64
            manifest_path.write_text(json.dumps(changed), encoding="utf8")
        else:
            if case == "wrong duration":
                durations = [100 for _ in frames]
            elif case == "unsafe alpha":
                frames[0].putpixel((0, 60), (255, 255, 255, 255))
            elif case == "mirrored artwork":
                frames = [frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for frame in frames]
            else:
                frames.pop()
                durations[-2:] = [200]
            frames[0].save(candidate, format="WEBP", save_all=True, append_images=frames[1:], duration=durations,
                           loop=1 if state == "look" else 0, quality=85, alpha_quality=100, method=6)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                check()
        except (AssertionError, FileNotFoundError) as error:
            if expected is None:
                assert isinstance(error, FileNotFoundError), f"unexpected refusal: {error}"
            else:
                assert expected in str(error), f"unexpected refusal: {error}"
            print("REJECTED CANDIDATE", case)
        else:
            raise AssertionError("negative control escaped: " + case)
    finally:
        candidate.write_bytes(original)
        manifest_path.write_bytes(manifest_bytes)
        assert candidate.read_bytes() == original and manifest_path.read_bytes() == manifest_bytes
check()
print("PASS: seven real-file and one provenance negative; exact restoration; all source hashes unchanged")

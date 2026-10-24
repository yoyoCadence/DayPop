"""Break real candidates and metadata one case at a time; restore exact bytes."""
import contextlib
import hashlib
import io
import json
from check_candidates import check
from contract import ROOT, source_characters, source_frames

manifest_path = ROOT / "manifest.json"
manifest_bytes = manifest_path.read_bytes()
base = json.loads(manifest_bytes)
path = ROOT / base["characters"][0]["candidates"]["fullQ55A70"]["path"]
original = path.read_bytes()
frames = source_frames(source_characters()[0])
cases = (("missing candidate", "wrong candidate inventory"), ("static candidate", "candidate must play once"),
         ("infinite loop", "candidate must play once"), ("wrong duration", "wrong candidate duration"),
         ("unsafe alpha", "unsafe candidate alpha"), ("changed phase", "changed phase timing"),
         ("wrong final pose", "timeline quality drift"), ("forged eligibility", "false candidate eligibility"),
         ("missing final index", "changed sampling policy"), ("over budget", "candidate exceeds existing character budget"))
for case, expected in cases:
    try:
        manifest = json.loads(manifest_bytes)
        candidate = manifest["characters"][0]["candidates"]["fullQ55A70"]
        images = [f.copy() for f in frames]
        duration, loop = [100] * 10, 1
        if case == "missing candidate":
            path.unlink()
        elif case == "static candidate":
            images[0].save(path, format="WEBP")
        elif case in {"infinite loop", "wrong duration", "unsafe alpha", "changed phase", "wrong final pose"}:
            if case == "infinite loop":
                loop = 0
            elif case == "wrong duration":
                duration = [90] * 10
            elif case == "unsafe alpha":
                images[0].putpixel((0, 60), (255, 255, 255, 255))
            elif case == "changed phase":
                duration = [150, 50] + [100] * 8
            else:
                images[-1] = images[4].copy()
            images[0].save(path, format="WEBP", save_all=True, append_images=images[1:], duration=duration,
                loop=loop, quality=55, alpha_quality=70, method=6, minimize_size=True)
            if case == "wrong final pose":
                candidate["bytes"] = path.stat().st_size
                candidate["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
                candidate["packageBytes"] = manifest["characters"][0]["basePackageBytes"] + candidate["bytes"]
        elif case == "forged eligibility":
            manifest["characters"][0]["candidates"]["sixQ85"]["eligible"] = True
        elif case == "missing final index":
            candidate["policy"]["indices"] = list(range(9))
        elif case == "over budget":
            path.write_bytes(original + b"\0" * 1024)
            candidate["bytes"] = path.stat().st_size
            candidate["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            candidate["packageBytes"] = manifest["characters"][0]["basePackageBytes"] + candidate["bytes"]
            candidate["eligible"] = False
        if case in {"forged eligibility", "missing final index", "over budget", "wrong final pose"}:
            manifest_path.write_text(json.dumps(manifest), encoding="utf8")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                check()
        except (AssertionError, FileNotFoundError) as error:
            assert isinstance(error, FileNotFoundError) if expected is None else expected in str(error), str(error)
            print("REJECTED ENCODING", case)
        else:
            raise AssertionError("negative escaped: " + case)
    finally:
        path.write_bytes(original)
        manifest_path.write_bytes(manifest_bytes)
        assert path.read_bytes() == original and manifest_path.read_bytes() == manifest_bytes
check()
print("PASS: ten real candidate/metadata negatives; exact bytes restored")

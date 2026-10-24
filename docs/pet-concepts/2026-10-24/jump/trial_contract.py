"""Freeze the DP-192 mixed package for historical trial comparisons."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def package_bytes(kind):
    encoding_root = ROOT.parent / "encoding"
    motion_root = ROOT.parents[1] / "2026-10-23/motion"
    sleep_root = ROOT.parent / "sleep"
    def character(directory):
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf8"))
        return next(c for c in manifest["characters"] if c["id"] == kind)
    encoding, motion, sleep = map(character, (encoding_root, motion_root, sleep_root))
    files = []
    for state in ("idle", "sleep"):
        clip = encoding["clips"][state]
        files.append((encoding_root / clip["path"], clip["sha256"]))
    original = [motion["clips"]["look"]["candidates"]["webpQ85"],
                motion["clips"]["idle"]["static"], motion["clips"]["grab"]["static"]]
    files.extend((motion_root / p, motion["sha256"][p]) for p in original)
    files.append((sleep_root / sleep["static"], sleep["sha256"][sleep["static"]]))
    for path, expected in files:
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, "changed published package input"
    return sum(path.stat().st_size for path, _ in files)

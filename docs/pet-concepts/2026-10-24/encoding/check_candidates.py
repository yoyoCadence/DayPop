"""Verify actual files and held intervals, rather than trusting a byte table."""
import hashlib
import json
import os
from PIL import Image
from candidate_contract import ROOT, KINDS, STATES, inputs, inspect, limits, published_hashes, selected_indices, static_paths
from check_assets import validate_sprite


def check(root=ROOT):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf8"))
    assert manifest["task"] == "DP-191" and manifest["appIntegrated"] is False and manifest["candidateAdopted"] is False
    assert manifest["qualityLimit"] == 0.008
    assert manifest["recommendedPackage"] == "half-idle-sleep-original-look"
    assert manifest["limits"] == limits(), "stale budget"
    assert len(manifest["characters"]) == 2 and {c["id"] for c in manifest["characters"]} == set(KINDS)
    for character in manifest["characters"]:
        kind, total = character["id"], 0
        assert set(character["clips"]) == set(STATES)
        expected_inputs = set(static_paths(kind))
        for state in STATES:
            paths, reference = inputs(kind, state)
            expected_inputs.update([*paths, reference])
        assert set(character["inputSha256"]) == {os.path.relpath(path, root).replace(os.sep, "/") for path in expected_inputs}, "missing input hashes"
        approved = published_hashes(kind)
        for path in expected_inputs:
            relative = os.path.relpath(path, root).replace(os.sep, "/")
            assert character["inputSha256"][relative] == approved[path], "published source hash mismatch"
        for state, clip in character["clips"].items():
            paths, reference = inputs(kind, state)
            assert len(paths) == (16 if state == "look" else 44), "missing sources"
            frames = [Image.open(path).convert("RGBA") for path in paths]
            indices = selected_indices(state, len(frames))
            assert clip["selectedIndices"] == indices, "changed selected frames"
            durations = [((indices[i+1] if i+1 < len(indices) else len(frames))-start)*100 for i, start in enumerate(indices)]
            assert clip["selectedDurationsMs"] == durations, "changed selected timing"
            candidate = root / clip["path"]
            assert clip["path"] == f"candidates/{kind}/{state}.q85-half.webp", "changed candidate path"
            measured = inspect(candidate, frames, state, held=True)
            assert measured == clip["candidate"], "stale decoded measurement"
            assert inspect(reference, frames, state) == clip["reference"], "stale reference measurement"
            assert clip["referencePath"] == os.path.relpath(reference, root).replace(os.sep, "/")
            assert reference.stat().st_size == clip["referenceBytes"]
            size = candidate.stat().st_size
            assert size == clip["bytes"], "stale candidate bytes"
            if state in ("idle", "look"):
                assert size <= limits()["maxIdleBytes" if state == "idle" else "maxLookBytes"], "candidate file exceeds existing limit"
            total += size
        assert character["statics"] == [{"path": os.path.relpath(path, root).replace(os.sep, "/"), "bytes": path.stat().st_size} for path in static_paths(kind)], "changed static list"
        for path in static_paths(kind):
            validate_sprite(path, 120)
            bounds = Image.open(path).convert("RGBA").resize((60, 60), Image.Resampling.LANCZOS).getchannel("A").getbbox()
            assert bounds and min(bounds[:2]) >= 4 and max(bounds[2:]) <= 56, "unsafe static alpha"
            assert path.stat().st_size <= limits()["maxStaticBytes"], "static exceeds existing limit"
            total += path.stat().st_size
        assert total <= limits()["maxCharacterBytes"], "actual four-state package exceeds existing budget"
        assert total == character["totalBytes"], "stale package bytes"
        mixed = total - character["clips"]["look"]["bytes"] + character["clips"]["look"]["referenceBytes"]
        assert mixed <= limits()["maxCharacterBytes"], "actual mixed package exceeds existing budget"
        assert mixed == character["mixedTotalBytes"], "stale mixed package bytes"
        for relative, expected in character["inputSha256"].items():
            assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, "source changed"
        for clip in character["clips"].values():
            assert hashlib.sha256((root / clip["path"]).read_bytes()).hexdigest() == clip["sha256"], "candidate changed"
        print("CANDIDATE PASS", kind, "all-half", total, "mixed", mixed, "bytes; original timeline/alpha/quality/return pose/budget")


if __name__ == "__main__":
    check()

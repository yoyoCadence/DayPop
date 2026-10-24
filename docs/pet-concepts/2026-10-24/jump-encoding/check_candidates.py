"""Check real candidate timing/pixels, published input hashes and fixed package bytes."""
import hashlib
import json
from contract import ROOT, SOURCE, PLANS, source_characters, source_frames, measure, package_bytes


def check():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    assert manifest["task"] == "DP-195" and manifest["appIntegrated"] is False and manifest["candidateAdopted"] is False
    assert manifest["qualityLimit"] == .008 and manifest["characterLimitBytes"] == 196608
    assert manifest["recommended"] == {"moon_cat": "fullQ55A70", "orbit_ufo": "reference"}
    assert len(manifest["characters"]) == 2
    published = {c["id"]: c for c in source_characters()}
    assert {c["id"] for c in manifest["characters"]} == set(published)
    expected_files = {f"candidates/{kind}/{name}.webp" for kind in published for name in PLANS}
    assert {p.relative_to(ROOT).as_posix() for p in (ROOT / "candidates").rglob("*.webp")} == expected_files, "wrong candidate inventory"
    for char in manifest["characters"]:
        original = published[char["id"]]
        reference = source_frames(original)
        assert char["inputSha256"] == {p: original["sha256"][p] for p in [*original["frames"], original["candidates"]["webpQ85"]]}, "wrong published provenance"
        assert set(char["candidates"]) == set(PLANS)
        assert char["basePackageBytes"] == package_bytes(char["id"])
        for name, candidate in char["candidates"].items():
            assert candidate["policy"] == PLANS[name], "changed sampling policy"
            assert candidate["path"] == f"candidates/{char['id']}/{name}.webp", "aliased candidate path"
            path = ROOT / candidate["path"]
            actual = measure(path, reference)
            assert actual["decodedFrames"] == len(PLANS[name]["indices"]), "wrong decoded frame count"
            assert actual["decodedDurationsMs"] == PLANS[name]["durations"], "changed phase timing"
            size = path.stat().st_size
            package = char["basePackageBytes"] + size
            assert candidate["packageBytes"] == package, "stale package bytes"
            eligible = max(actual["maxTimelineMeanAbsoluteError"], actual["maxDarkTimelineMeanAbsoluteError"]) < .008 and package <= 196608
            if name.startswith("full"):
                assert max(actual["maxTimelineMeanAbsoluteError"], actual["maxDarkTimelineMeanAbsoluteError"]) < .008, "timeline quality drift"
                assert package <= 196608, "candidate exceeds existing character budget"
            else:
                assert not eligible, "rejected temporal sampling escaped"
            assert candidate["eligible"] == eligible, "false candidate eligibility"
            assert actual == candidate["measurement"], "stale measurements"
            assert size == candidate["bytes"], "stale candidate bytes"
            assert hashlib.sha256(path.read_bytes()).hexdigest() == candidate["sha256"], "changed encoded candidate"
            assert candidate["packageBytes"] == char["basePackageBytes"] + path.stat().st_size
            assert candidate["packageBytes"] <= 196608, "candidate exceeds existing character budget"
        reference_path = original["candidates"]["webpQ85"]
        assert char["reference"] == {"path": "../jump/" + reference_path,
            "bytes": (SOURCE / reference_path).stat().st_size, "measurement": measure(SOURCE / reference_path, reference)}
        chosen = manifest["recommended"][char["id"]]
        chosen_bytes = char["reference"]["bytes"] if chosen == "reference" else char["candidates"][chosen]["bytes"]
        chosen_measurement = char["reference"]["measurement"] if chosen == "reference" else char["candidates"][chosen]["measurement"]
        assert max(chosen_measurement["maxTimelineMeanAbsoluteError"], chosen_measurement["maxDarkTimelineMeanAbsoluteError"]) < .008, "recommended quality drift"
        assert char["basePackageBytes"] + chosen_bytes <= 196608, "recommended package exceeds budget"
        print("CANDIDATE PASS", char["id"], {name: c["packageBytes"] for name, c in char["candidates"].items()})


if __name__ == "__main__":
    check()

"""Create Q85 held-frame candidates; all Blender and source PNGs stay intact."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import os
from PIL import Image
from candidate_contract import ROOT, KINDS, STATES, inputs, inspect, limits, selected_indices, static_paths

manifest = {"task": "DP-191", "appIntegrated": False, "candidateAdopted": False,
            "recommendedPackage": "half-idle-sleep-original-look",
            "sourceCommit": "23f09c4b2e09291841ffb107478bf255fdacf5a0", "qualityLimit": 0.008,
            "method": "Composite RGB onto #f5f3ee; compare every original 100ms interval including held intervals; whole-canvas mean absolute difference /255. Not perceptual equivalence or decode performance.",
            "limits": limits(), "characters": []}
for kind in KINDS:
    character = {"id": kind, "clips": {}, "statics": [], "inputSha256": {}}
    for state in STATES:
        paths, reference = inputs(kind, state)
        assert len(paths) == (16 if state == "look" else 44), "missing source frames"
        frames = [Image.open(path).convert("RGBA") for path in paths]
        indices = selected_indices(state, len(frames))
        durations = [((indices[i+1] if i+1 < len(indices) else len(frames))-start)*100 for i, start in enumerate(indices)]
        variants = {}
        for minimize in (False, True):
            buffer = BytesIO()
            frames[indices[0]].save(buffer, format="WEBP", save_all=True, append_images=[frames[i] for i in indices[1:]],
                duration=durations, loop=1 if state == "look" else 0, quality=85, alpha_quality=100, method=6, minimize_size=minimize)
            variants[minimize] = buffer.getvalue()
        minimize = min(variants, key=lambda option: len(variants[option]))
        out = ROOT / "candidates" / kind / f"{state}.q85-half.webp"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(variants[minimize])
        character["clips"][state] = {"path": out.relative_to(ROOT).as_posix(), "bytes": out.stat().st_size,
            "selectedIndices": indices, "selectedDurationsMs": durations, "minimizeSize": minimize,
            "variantBytes": {str(key): len(value) for key, value in variants.items()},
            "referencePath": os.path.relpath(reference, ROOT).replace(os.sep, "/"), "referenceBytes": reference.stat().st_size,
            "reference": inspect(reference, frames, state), "candidate": inspect(out, frames, state, held=True),
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
        for path in [*paths, reference]:
            character["inputSha256"][os.path.relpath(path, ROOT).replace(os.sep, "/")] = hashlib.sha256(path.read_bytes()).hexdigest()
    for path in static_paths(kind):
        relative = os.path.relpath(path, ROOT).replace(os.sep, "/")
        character["statics"].append({"path": relative, "bytes": path.stat().st_size})
        character["inputSha256"][relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    character["totalBytes"] = sum(clip["bytes"] for clip in character["clips"].values()) + sum(p["bytes"] for p in character["statics"])
    character["mixedTotalBytes"] = character["totalBytes"] - character["clips"]["look"]["bytes"] + character["clips"]["look"]["referenceBytes"]
    manifest["characters"].append(character)
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
print(json.dumps({c["id"]: {"totalBytes": c["totalBytes"], "mixedTotalBytes": c["mixedTotalBytes"], "clips": {s: {"bytes": p["bytes"], "candidate": p["candidate"]} for s, p in c["clips"].items()}} for c in manifest["characters"]}))

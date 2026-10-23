"""Measure actual decoded candidates without re-encoding or changing artwork."""
import json
from PIL import Image
from check_motion import ROOT, difference

manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
results = []
for char in manifest["characters"]:
    for state, clip in char["clips"].items():
        item = {"character": char["id"], "state": state, "frames": len(clip["frames"]), "durationMs": clip["durationMs"], "pngBytes": clip["pngBytes"], "candidates": {}}
        for fmt, rel in clip["candidates"].items():
            image = Image.open(ROOT / rel)
            elapsed, errors = 0, []
            for index in range(image.n_frames):
                image.seek(index)
                decoded = image.convert("RGBA")
                source = Image.open(ROOT / clip["frames"][min(int(elapsed // 100), len(clip["frames"]) - 1)]).convert("RGBA")
                errors.append(difference(source, decoded))
                elapsed += image.info["duration"]
            item["candidates"][fmt] = {"bytes": (ROOT / rel).stat().st_size, "decodedFrames": image.n_frames,
                "decodedDurationMs": elapsed, "maxCompositedMeanAbsoluteError": max(errors)}
        results.append(item)
output = {"task": "DP-187", "method": "Mean absolute RGB error after RGBA compositing onto #f5f3ee, divided by 255; whole 120x120 canvas, all decoded frames. Not perceptual equivalence or browser decode speed.", "clips": results}
(ROOT / "measurements.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf8")
print(json.dumps(output))

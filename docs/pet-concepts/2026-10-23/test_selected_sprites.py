"""Acceptance: selected characters should remain readable in the 60px control."""
import unittest
import io
import json
import subprocess
import sys
from check_assets import ROOT, validate_sprite


class SelectedSpriteFill(unittest.TestCase):
    def test_selected_characters_use_the_available_canvas(self):
        for kind in ("moon_cat", "orbit_ufo"):
            for size in (120, 60):
                with self.subTest(kind=kind, size=size):
                    result = validate_sprite(ROOT / f"renders/{kind}-{size}.png", size)
                    left, top, right, bottom = result["bounds"]
                    # At 60px, at least 48px along the longer dimension, while
                    # validate_sprite still enforces four transparent pixels.
                    self.assertGreaterEqual(max(right - left + 1, bottom - top + 1), round(size * 0.8))


if __name__ == "__main__":
    if "--reverse-control" in sys.argv:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
        baseline = manifest["conceptBaseline"]
        paths = [ROOT / f"renders/{kind}-{size}.png" for kind in ("moon_cat", "orbit_ufo") for size in (120, 60)]
        originals = {path: path.read_bytes() for path in paths}
        repo = ROOT.parents[2]
        try:
            for path in paths:
                path.write_bytes(subprocess.run(["git", "show", f"{baseline}:{path.relative_to(repo).as_posix()}"], cwd=repo, capture_output=True, check=True).stdout)
            result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(SelectedSpriteFill))
            assert len(result.failures) == 4 and not result.errors, "baseline must fail all four size checks"
            print("REVERSE CONTROL: all four original sprite sizes fail")
        finally:
            for path, data in originals.items():
                path.write_bytes(data)
        assert all(path.read_bytes() == data for path, data in originals.items())
        result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(SelectedSpriteFill))
        assert result.wasSuccessful(), "restored selected sprites must pass"
        print("RESTORED: exact bytes; all four selected sizes pass")
    else:
        unittest.main()

"""Negative controls for the concept acceptance checker; run with Python + Pillow."""
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw
from check_assets import ROOT, check, validate_sprite


class AcceptanceControls(unittest.TestCase):
    def rejected(self, image, expected):
        with tempfile.TemporaryDirectory(prefix="daypop-pet-control-") as directory:
            path = Path(directory) / "control.png"
            image.save(path)
            with self.assertRaisesRegex(AssertionError, expected):
                validate_sprite(path, 120)

    def test_empty_is_rejected(self):
        self.rejected(Image.new("RGBA", (120, 120)), "empty/tiny")

    def test_opaque_background_is_rejected(self):
        self.rejected(Image.new("RGBA", (120, 120), "white"), "unsafe alpha")

    def test_nearly_invisible_clipped_edge_is_rejected(self):
        image = Image.open(ROOT / "renders/moon_cat-120.png").convert("RGBA")
        image.putpixel((0, 60), (10, 20, 30, 1))
        self.rejected(image, "unsafe alpha")

    def test_flat_silhouette_is_rejected(self):
        image = Image.new("RGBA", (120, 120))
        ImageDraw.Draw(image).ellipse((16, 16, 104, 104), fill="white")
        self.rejected(image, "lost material detail")

    def test_wrong_size_is_rejected(self):
        self.rejected(Image.new("RGBA", (60, 60)), "wrong dimensions")

    def test_missing_final_asset_fails_then_exact_bytes_are_restored(self):
        # Counter-check the real delivered file, not a copy of the checker logic.
        path = ROOT / "renders/moon_cat-120.png"
        original = path.read_bytes()
        try:
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                check()
        finally:
            path.write_bytes(original)
        self.assertEqual(path.read_bytes(), original)
        check()


if __name__ == "__main__":
    unittest.main()

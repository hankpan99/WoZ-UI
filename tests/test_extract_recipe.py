"""Image migration must follow steps rather than stale page numbers."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import extract_recipe


class ImageMigrationTests(unittest.TestCase):
    def test_reordered_and_repeated_steps_keep_images_and_backup(self):
        old = [{"step": "1", "actions": [{"name": "拿碗"}, {"name": "擦桌子"}]},
               {"step": "2", "actions": [{"name": "擦桌子"}, {"name": "舊步驟"}]}]
        new = [{"step": "1", "actions": [{"name": "擦桌子"}]},
               {"step": "2", "actions": [{"name": "拿碗"}, {"name": "擦桌子"}]}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "images" / "steps"
            directory.mkdir(parents=True)
            originals = {"01-01.jpeg": b"bowl", "01-02.jpeg": b"clean1",
                         "02-01.jpeg": b"clean2", "02-02.jpeg": b"removed"}
            for name, contents in originals.items():
                (directory / name).write_bytes(contents)
            with patch.object(extract_recipe, "ROOT", root):
                extract_recipe.migrate_step_images(old, new)
            self.assertEqual((directory / "02-01.jpeg").read_bytes(), b"bowl")
            self.assertEqual((directory / "01-01.jpeg").read_bytes(), b"clean1")
            self.assertEqual((directory / "02-02.jpeg").read_bytes(), b"clean2")
            backups = list((root / "images").glob("steps-backup-*"))
            self.assertEqual(len(backups), 1)
            for name, contents in originals.items():
                self.assertEqual((backups[0] / name).read_bytes(), contents)

    def test_ambiguous_new_duplicates_are_not_guessed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "images" / "steps"
            directory.mkdir(parents=True)
            (directory / "01-01.jpeg").write_bytes(b"original")
            old = [{"step": "1", "actions": [{"name": "拿碗"}]}]
            new = [{"step": "1", "actions": [{"name": "拿碗"}, {"name": "拿碗"}]}]
            with patch.object(extract_recipe, "ROOT", root):
                extract_recipe.migrate_step_images(old, new)
            self.assertEqual(list(directory.iterdir()), [])


if __name__ == "__main__":
    unittest.main()

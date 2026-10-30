import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_web', ROOT / 'scripts/package-web.py')
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


class WebPackageTests(unittest.TestCase):
    def test_download_is_complete_repeatable_and_detects_stale_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in web.ASSETS:
                file = root / 'web' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('{"version":1,"release":null,"boards":[]}' if name == "firmware/catalog.json" else name)
            original = web.bundle(root)
            self.assertEqual(original, web.bundle(root))
            with zipfile.ZipFile(io.BytesIO(original)) as archive:
                self.assertIn('README.txt', archive.namelist())
                self.assertIn('web/BUILD.json', archive.namelist())
                self.assertIn('web/dist/updater.mjs', archive.namelist())
                self.assertIn('web/sw.js', archive.namelist())
                self.assertIn('web/manifest.webmanifest', archive.namelist())
                self.assertIn('web/icons/maskable-512.png', archive.namelist())
                self.assertIsNone(archive.testzip())
            # Different ZIP compression must not trigger a stale-source error.
            rewritten = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(rewritten, 'w') as output:
                for name in source.namelist():
                    output.writestr(name, source.read(name))
            self.assertTrue(web.matches(rewritten.getvalue(), original))
            (root / 'web/app.mjs').write_text('updated source')
            self.assertFalse(web.matches(original, web.bundle(root)))
            self.assertFalse(web.matches(b'corrupt ZIP', original))
            (root / 'web/dist/updater.mjs').unlink()
            with self.assertRaises(FileNotFoundError):
                web.bundle(root)

    def test_partial_stable_firmware_catalog_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in web.ASSETS:
                file = root / 'web' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(name)
            (root / 'web/firmware/catalog.json').write_text('{"version":1,"release":{"tag":"v1"},"boards":[{"board":"pico"}]}')
            with self.assertRaisesRegex(ValueError, 'all four'):
                web.bundle(root)

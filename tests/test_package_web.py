import importlib.util
import hashlib
import json
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
                file.write_text('{"version":1,"release":null,"boards":[]}' if name in ("firmware/catalog.json", "firmware/development-catalog.json") else name)
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

    def test_development_catalog_is_packaged_separately_and_detects_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in web.ASSETS:
                file = root / 'web' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('{"version":1,"release":null,"boards":[]}' if name.endswith('catalog.json') else name)
            rows = []
            for board in ('pico', 'esp32', 'esp32c3', 'esp32c3-devkit'):
                name = f'development/rc-limit-{board}.zip'
                file = root / 'web/firmware' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                data = board.encode();file.write_bytes(data)
                rows.append({'board':board,'file':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            (root / 'web/firmware/development-catalog.json').write_text(json.dumps({'version':1,'release':{'tag':'dev-1'},'boards':rows}))
            with zipfile.ZipFile(io.BytesIO(web.bundle(root))) as archive:
                self.assertIn('web/firmware/development/rc-limit-pico.zip', archive.namelist())
                self.assertEqual(json.loads(archive.read('web/firmware/catalog.json'))['release'], None)
            (root / 'web/firmware/development/rc-limit-pico.zip').write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                web.bundle(root)

    def test_partial_stable_firmware_catalog_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in web.ASSETS:
                file = root / 'web' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('{"version":1,"release":null,"boards":[]}' if name.endswith('catalog.json') else name)
            (root / 'web/firmware/catalog.json').write_text('{"version":1,"release":{"tag":"v1"},"boards":[{"board":"pico"}]}')
            with self.assertRaisesRegex(ValueError, 'all four'):
                web.bundle(root)

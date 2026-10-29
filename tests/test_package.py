"""Check published board bundles, including first-flash offsets and integrity."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('packager', ROOT / 'scripts/package-firmware.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def test_every_board_contains_matching_binaries_instructions_and_checksums(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'docs').mkdir()
            for name in ('wiring.md', 'commissioning.md', 'board-layouts.md', 'protocol.md'):
                (root / 'docs' / name).write_text(name)
            for board in packager.BOARDS:
                source = root / 'build/pio' / board
                source.mkdir(parents=True)
                names = ['firmware.uf2'] if board == 'pico' else ['bootloader.bin', 'partitions.bin', 'firmware.bin']
                for name in names:
                    (source / name).write_bytes((board + name).encode())
                with patch.object(packager, 'ROOT', root), patch.object(packager.subprocess, 'check_output', return_value='abc123\n'):
                    packager.package(board)
                with zipfile.ZipFile(root / 'build/releases' / f'rc-limit-{board}.zip') as archive:
                    readme = archive.read('README.txt').decode()
                    self.assertIn(board, readme)
                    self.assertIn('abc123', readme)
                    for name in names:
                        self.assertEqual(archive.read(name), (board + name).encode())
                    if board != 'pico':
                        offset = '0x1000' if board == 'esp32' else '0x0'
                        self.assertIn(f'{offset} bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin', readme)
                    for line in archive.read('SHA256SUMS').decode().splitlines():
                        digest, name = line.split('  ', 1)
                        self.assertEqual(digest, hashlib.sha256(archive.read(name)).hexdigest())
                (source / names[0]).unlink()
                with patch.object(packager, 'ROOT', root), self.assertRaises(FileNotFoundError):
                    packager.package(board)

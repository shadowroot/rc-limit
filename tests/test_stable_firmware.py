import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stable', ROOT / 'scripts/fetch-stable-firmware.py')
stable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stable)


def fixture(manifests=False):
    data = {}
    for board in stable.BOARDS:
        content = io.BytesIO()
        with zipfile.ZipFile(content, 'w') as archive:
            names = ['firmware.uf2'] if board == 'pico' else ['bootloader.bin', 'partitions.bin', 'firmware.bin']
            for name in names:
                archive.writestr(name, board.encode())
            if manifests:
                addresses = [None] if board == 'pico' else [0x1000 if board == 'esp32' else 0, 0x8000, 0x10000]
                manifest = {'project': 'rc-limit', 'version': 1, 'board': board, 'commit': 'a'*40,
                            'images': [{'file': name, 'address': address, 'size': len(board.encode()), 'sha256': hashlib.sha256(board.encode()).hexdigest()} for name, address in zip(names, addresses)]}
                archive.writestr('update-manifest.json', json.dumps(manifest))
        data[f'rc-limit-{board}.zip'] = content.getvalue()
    data['SHA256SUMS'] = ''.join(f'{hashlib.sha256(value).hexdigest()}  {name}\n' for name, value in data.items()).encode()
    release = {'draft': False, 'prerelease': False, 'tag_name': 'v1.2.3', 'published_at': '2026-10-30T00:00:00Z',
               'html_url': 'https://github.com/shadowroot/rc-limit/releases/tag/v1.2.3',
               'assets': [{'name': name, 'url': name} for name in data]}
    return release, data


class StableFirmwareTests(unittest.TestCase):
    def test_all_four_packages_are_included_and_legacy_packages_download_only(self):
        release, data = fixture()
        catalog, files = stable.collect(release, lambda url, **kwargs: data[url])
        self.assertEqual(catalog['release']['tag'], 'v1.2.3')
        self.assertEqual(len(files), 4)
        self.assertEqual([row['board'] for row in catalog['boards']], list(stable.BOARDS))
        self.assertTrue(all(not row['updater_supported'] for row in catalog['boards']))

    def test_updater_manifests_preserve_zip_names_and_component_integrity(self):
        release, data = fixture(manifests=True)
        catalog, files = stable.collect(release, lambda url, **kwargs: data[url])
        self.assertEqual(set(files), {f'stable/rc-limit-{board}.zip' for board in stable.BOARDS})
        self.assertTrue(all(row['updater_supported'] for row in catalog['boards']))
        self.assertTrue(all(row['commit'] == 'a'*40 for row in catalog['boards']))

    def test_drafts_prereleases_and_incomplete_releases_are_not_stable(self):
        for key, value in [('draft', True), ('prerelease', True), ('published_at', None)]:
            release, data = fixture();release[key] = value
            with self.assertRaises(ValueError): stable.collect(release, lambda url, **kwargs: data[url])
        release, data = fixture();release['assets'].pop()
        with self.assertRaises(ValueError): stable.collect(release, lambda url, **kwargs: data[url])

    def test_corrupt_and_missing_board_assets_are_rejected(self):
        release, data = fixture();data['rc-limit-pico.zip'] += b'corruption'
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            stable.collect(release, lambda url, **kwargs: data[url])
        release, data = fixture();release['assets'] = [item for item in release['assets'] if item['name'] != 'rc-limit-esp32.zip']
        with self.assertRaisesRegex(ValueError, 'missing'):
            stable.collect(release, lambda url, **kwargs: data[url])

    def test_github_token_is_not_forwarded_to_asset_redirect_host(self):
        request = urllib.request.Request('https://api.github.com/releases/asset', headers={'Authorization': 'Bearer secret'})
        redirected = stable.SafeRedirect().redirect_request(request, None, 302, '', {}, 'https://release-assets.githubusercontent.com/file')
        self.assertIsNone(redirected.get_header('Authorization'))

#!/usr/bin/env python3
"""Bundle firmware from GitHub's latest published stable release (never main artifacts)."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BOARDS = ('pico', 'esp32', 'esp32c3', 'esp32c3-devkit')


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlparse(newurl).scheme != 'https':
            raise ValueError('Refusing an insecure asset redirect.')
        result = super().redirect_request(req, fp, code, msg, headers, newurl)
        if urllib.parse.urlparse(req.full_url).netloc != urllib.parse.urlparse(newurl).netloc:
            result.remove_header('Authorization')
        return result


def reader(token):
    opener = urllib.request.build_opener(SafeRedirect())

    def fetch(url, limit=8 * 1024 * 1024, binary=False):
        headers = {'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json',
                   'User-Agent': 'rc-limit-stable-bundler', 'X-GitHub-Api-Version': '2022-11-28'}
        if token and urllib.parse.urlparse(url).netloc == 'api.github.com':
            headers['Authorization'] = 'Bearer ' + token
        with opener.open(urllib.request.Request(url, headers=headers), timeout=60) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Release response exceeds its size limit.')
        return data
    return fetch


def collect(release, fetch, channel='stable'):
    if channel not in ('stable', 'development'):
        raise ValueError('Invalid firmware channel.')
    if release.get('draft') or bool(release.get('prerelease')) != (channel == 'development') or not release.get('published_at'):
        raise ValueError('Firmware release does not match its published channel.')
    tag = release.get('tag_name')
    if not isinstance(tag, str) or not tag:
        raise ValueError('Release tag is missing.')
    assets = {}
    for asset in release.get('assets', []):
        if asset['name'] in assets:
            raise ValueError('Duplicate release asset name.')
        assets[asset['name']] = asset
    if 'SHA256SUMS' not in assets:
        raise ValueError('Stable release must include SHA256SUMS.')
    checksums = {}
    for line in fetch(assets['SHA256SUMS']['url'], limit=65536, binary=True).decode().splitlines():
        parts = line.split(None, 1)
        if len(parts) != 2 or not re.fullmatch('[a-fA-F0-9]{64}', parts[0]):
            raise ValueError('Malformed SHA256SUMS.')
        name = parts[1].lstrip('*')
        if name in checksums:
            raise ValueError('Duplicate release checksum.')
        checksums[name] = parts[0].lower()
    files, boards = {}, []
    for board in BOARDS:
        name = f'rc-limit-{board}.zip'
        if name not in assets or name not in checksums:
            raise ValueError(f'Stable release {tag} is missing {name} or its checksum.')
        data = fetch(assets[name]['url'], limit=6 * 1024 * 1024, binary=True)
        digest = hashlib.sha256(data).hexdigest()
        if digest != checksums[name]:
            raise ValueError(f'Stable release checksum mismatch: {name}')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            required = ['firmware.uf2'] if board == 'pico' else ['bootloader.bin', 'partitions.bin', 'firmware.bin']
            if any(item not in archive.namelist() for item in required):
                raise ValueError(f'Incomplete firmware ZIP: {name}')
            supported, commit = False, None
            if 'update-manifest.json' in archive.namelist():
                info = archive.getinfo('update-manifest.json')
                if info.file_size > 65536:
                    raise ValueError('Oversized firmware manifest.')
                manifest = json.loads(archive.read(info))
                if manifest.get('project') != 'rc-limit' or manifest.get('version') != 1 or manifest.get('board') != board:
                    raise ValueError(f'Firmware manifest does not match {board}.')
                images = manifest.get('images', [])
                addresses = [None] if board == 'pico' else [0x1000 if board == 'esp32' else 0, 0x8000, 0x10000]
                if len(images) != len(required):
                    raise ValueError('Incomplete update manifest.')
                for item, component_name, address in zip(images, required, addresses):
                    info = archive.getinfo(component_name)
                    if info.file_size > 4 * 1024 * 1024:
                        raise ValueError('Oversized firmware component.')
                    content = archive.read(info)
                    if item.get('file') != component_name or item.get('address') != address or item.get('size') != len(content) or item.get('sha256') != hashlib.sha256(content).hexdigest():
                        raise ValueError('Invalid component checksum/offset in update manifest.')
                supported = True
                commit = manifest.get('commit')
        files[channel + '/' + name] = data
        boards.append({'board': board, 'file': channel + '/' + name, 'sha256': digest,
                       'size': len(data), 'updater_supported': supported, 'commit': commit})
    catalog = {'version': 1, 'release': {'tag': tag, 'url': release['html_url'],
               'published_at': release['published_at']}, 'boards': boards}
    return catalog, files


def write(output, catalog, files, channel='stable'):
    output.mkdir(parents=True, exist_ok=True)
    if channel not in ('stable', 'development'):
        raise ValueError('Invalid firmware channel.')
    target = output / channel
    target.mkdir(exist_ok=True)
    for old in target.glob('rc-limit-*.zip'):
        old.unlink()
    for name, data in files.items():
        (output / name).write_bytes(data)
    (output / ('catalog.json' if channel == 'stable' else 'development-catalog.json')).write_text(json.dumps(catalog, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'shadowroot/rc-limit'))
    parser.add_argument('--output', type=Path, default=ROOT / 'web/firmware')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('Expected owner/repo.')
    fetch = reader(os.environ.get('GITHUB_TOKEN', ''))
    try:
        data = fetch(f'https://api.github.com/repos/{args.repo}/releases/latest')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        write(args.output, {'version': 1, 'release': None, 'boards': []}, {})
        print('No published stable release is available (or the repository is inaccessible). No development firmware substituted.')
        return
    catalog, files = collect(json.loads(data), fetch)
    write(args.output, catalog, files)
    print(f"Bundled stable {catalog['release']['tag']} for all four boards.")


if __name__ == '__main__':
    main()

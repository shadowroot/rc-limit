#!/usr/bin/env python3
"""Build a deterministic, ready-to-serve web ZIP linked from the GitHub README."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ('index.html', 'style.css', 'app.mjs', 'protocol.mjs', 'ble.mjs', 'boards.mjs',
          'hardware/boards.json', 'dist/updater.mjs', 'dist/updater.mjs.LEGAL.txt',
          'dist/third-party-licenses.txt', 'firmware/catalog.json')
README = '''RC Limit static web UI

No Node.js installation or build step is needed for this download.
Extract the entire ZIP, then run from the extracted directory:

  python3 -m http.server 8080 --bind 127.0.0.1 --directory web

On Windows, use: py -m http.server 8080 --bind 127.0.0.1 --directory web
Open http://localhost:8080 in desktop Chrome or Edge.

Keep the server running while configuring boards. Do not double-click index.html:
JavaScript modules/device APIs require localhost or HTTPS.
You may also upload web/ to a static HTTPS host of your choice.

USB/Bluetooth availability depends on the browser and OS. Connect devices only
through the explicit device chooser. Firmware flashing requires disconnected
motor power. Read the project's wiring and commissioning instructions first:
https://github.com/shadowroot/rc-limit

This package includes the firmware updater and third-party licenses.
The firmware catalog shows the stable release bundled into this download.
An empty catalog means no stable release was available when it was built.
web/BUILD.json identifies the exact asset contents via SHA-256 checksums.
'''


def bundle(root=ROOT):
    files = {'web/' + name: (root / 'web' / name).read_bytes() for name in ASSETS}
    catalog = json.loads(files['web/firmware/catalog.json'])
    boards = catalog.get('boards')
    expected = {'pico', 'esp32', 'esp32c3', 'esp32c3-devkit'}
    if catalog.get('version') != 1 or not isinstance(boards, list):
        raise ValueError('Invalid stable firmware catalog.')
    if catalog.get('release') is None:
        if boards:
            raise ValueError('Firmware packages need a stable release identity.')
    elif len(boards) != 4 or {item.get('board') for item in boards} != expected:
        raise ValueError('Stable distributions must contain all four board packages.')
    for board in boards:
        name = board['file']
        if name != f"stable/rc-limit-{board['board']}.zip" or board['board'] not in ('pico', 'esp32', 'esp32c3', 'esp32c3-devkit'):
            raise ValueError('Invalid bundled firmware path/board.')
        data = (root / 'web/firmware' / name).read_bytes()
        if len(data) != board['size'] or hashlib.sha256(data).hexdigest() != board['sha256']:
            raise ValueError('Bundled firmware checksum mismatch.')
        files['web/firmware/' + name] = data
    manifest = {'format': 1, 'project': 'rc-limit-web',
                'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
    files['web/BUILD.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    files['README.txt'] = README.encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)
    return output.getvalue()


def matches(download, expected):
    # Compare file contents, not DEFLATE bytes, which can vary across zlib versions.
    try:
        with zipfile.ZipFile(io.BytesIO(download)) as actual, zipfile.ZipFile(io.BytesIO(expected)) as wanted:
            if sorted(actual.namelist()) != sorted(wanted.namelist()):
                return False
            return all(actual.read(name) == wanted.read(name) for name in wanted.namelist())
    except (zipfile.BadZipFile, RuntimeError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the README download is stale.')
    args = parser.parse_args()
    data = bundle()
    download = ROOT / 'downloads' / 'rc-limit-web.zip'
    if args.check:
        if not download.is_file() or not matches(download.read_bytes(), data):
            parser.exit(1, 'Static download is stale. Run npm run package:web and commit downloads/rc-limit-web.zip.\n')
        data = download.read_bytes()
        print('README static web download matches the built assets.')
    else:
        download.parent.mkdir(parents=True, exist_ok=True)
        download.write_bytes(data)
        print(download)
    artifact = ROOT / 'build' / 'releases' / download.name
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_bytes(data)
    print(artifact)


if __name__ == '__main__':
    main()

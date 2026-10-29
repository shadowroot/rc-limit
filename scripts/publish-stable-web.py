#!/usr/bin/env python3
"""Update the latest stable release's standalone web ZIP and its checksum."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile


def main():
    artifact = Path('build/releases/rc-limit-web.zip')
    with zipfile.ZipFile(artifact) as archive:
        catalog = json.loads(archive.read('web/firmware/catalog.json'))
    if not catalog.get('release'):
        print('No stable release; skipping stable web asset publication.')
        return
    tag = catalog['release']['tag']
    release = json.loads(subprocess.check_output(['gh', 'api', 'repos/{owner}/{repo}/releases/latest'], text=True))
    if release.get('immutable'):
        print('Stable release is immutable; the current standalone ZIP is available on Pages and in app-web artifacts.')
        return
    if tag != release['tag_name']:
        print('A newer stable release appeared; skipping an outdated web artifact.')
        return
    folder = Path('build/stable-web-checksums')
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.run(['gh', 'release', 'download', tag, '--pattern', 'SHA256SUMS', '--dir', str(folder), '--clobber'], check=True)
    checksum = folder / 'SHA256SUMS'
    existing = checksum.read_text().splitlines()
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    if any(asset.get('name') == artifact.name for asset in release.get('assets', [])) and any(line.split() == [digest, artifact.name] for line in existing):
        print('Stable web archive is already current.')
        return
    lines = [line for line in existing if line.strip() and line.split()[-1].lstrip('*') != artifact.name]
    lines.append(digest + '  ' + artifact.name)
    checksum.write_text('\n'.join(lines) + '\n')
    subprocess.run(['gh', 'release', 'upload', tag, str(artifact), str(checksum), '--clobber'], check=True)
    print(f'Updated stable web ZIP and checksum on {tag}.')


if __name__ == '__main__':
    main()

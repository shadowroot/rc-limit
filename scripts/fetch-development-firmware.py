#!/usr/bin/env python3
"""Bundle the newest published prerelease, separately from stable firmware."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stable_firmware', ROOT / 'scripts/fetch-stable-firmware.py')
firmware = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firmware)


def latest_development(releases):
    candidates = [item for item in releases if not item.get('draft') and item.get('prerelease') and item.get('published_at')]
    return max(candidates, key=lambda item: item['published_at']) if candidates else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'shadowroot/rc-limit'))
    parser.add_argument('--output', type=Path, default=ROOT / 'web/firmware')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('Expected owner/repo.')
    fetch = firmware.reader(os.environ.get('GITHUB_TOKEN', ''))
    try:
        releases = json.loads(fetch(f'https://api.github.com/repos/{args.repo}/releases?per_page=100'))
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        releases = []
    release = latest_development(releases)
    if not release:
        firmware.write(args.output, {'version': 1, 'release': None, 'boards': []}, {}, 'development')
        print('No published development firmware is available.')
        return
    catalog, files = firmware.collect(release, fetch, 'development')
    firmware.write(args.output, catalog, files, 'development')
    print(f"Bundled development prerelease {catalog['release']['tag']} for all four boards.")


if __name__ == '__main__':
    main()

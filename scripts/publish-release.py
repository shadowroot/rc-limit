#!/usr/bin/env python3
"""Publish complete main-build prereleases, or stage version-tag release drafts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def release_identity(env):
    event, ref = env.get('GITHUB_EVENT_NAME'), env.get('GITHUB_REF', '')
    sha = env.get('GITHUB_SHA', '')
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('A full source commit SHA is required.')
    if event == 'push' and ref.startswith('refs/tags/v'):
        tag = ref.removeprefix('refs/tags/')
        return tag, False, sha
    if event in ('push', 'workflow_dispatch') and ref == 'refs/heads/main':
        number = env.get('GITHUB_RUN_NUMBER', '')
        if not re.fullmatch(r'[1-9][0-9]*', number):
            raise ValueError('A positive workflow run number is required.')
        return f'dev-{number}-{sha[:12]}', True, sha
    raise ValueError('Releases require a main build or an explicit v* tag push.')


def collect_assets(directory):
    names = {f'rc-limit-{board}.zip' for board in ('pico', 'esp32', 'esp32c3', 'esp32c3-devkit')}
    names |= {'rc-limit-web.zip', 'rc-limit-desktop-linux-x64.tar.gz'}
    for kind in ('setup', 'portable'):
        matches = list(directory.glob(f'rc-limit-desktop-*-windows-x64-{kind}.exe'))
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one Windows {kind} EXE.')
        names.add(matches[0].name)
    assets = sorted(directory / name for name in names)
    if any(not path.is_file() or path.stat().st_size == 0 for path in assets):
        raise ValueError('Missing or empty release asset; all four firmware ZIPs, web, Linux and Windows builds are required.')
    extra = {path.name for path in directory.iterdir()} - names - {'SHA256SUMS'}
    if extra:
        raise ValueError('Unexpected release assets: ' + ', '.join(sorted(extra)))
    checksum = directory / 'SHA256SUMS'
    checksum.write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in assets))
    return assets + [checksum]


def gh(*args, check=True):
    return subprocess.run(['gh', *args], check=check, text=True, capture_output=True)


def publish(directory, env):
    tag, development, sha = release_identity(env)
    assets = collect_assets(directory)
    # A list request distinguishes an absent release from an auth/network failure.
    result = gh('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases?per_page=100')
    # Slurp yields an array of pages, including repositories with >100 releases.
    pages = json.loads(result.stdout)
    releases = [release for page in pages for release in page]
    existing = next((release for release in releases if release['tag_name'] == tag), None)
    if existing:
        if development and (existing['target_commitish'] != sha or not existing['prerelease']):
            raise ValueError('Existing development release does not match the source commit/prerelease policy.')
        if not existing['draft']:
            expected = {path.name for path in assets}
            uploaded = {item['name'] for item in existing.get('assets', [])}
            if not expected <= uploaded:
                raise ValueError('Published release is incomplete. Use a new build/version; published assets are never overwritten.')
            print(f'{tag} is already published with all assets; leaving it unchanged.')
            return tag
    else:
        args = ['release', 'create', tag, '--draft', '--generate-notes']
        if development:
            args += ['--target', sha, '--title', f'Development build {env["GITHUB_RUN_NUMBER"]} ({sha[:12]})', '--prerelease', '--latest=false',
                     '--notes', f'Automatic main build of {sha}. Development firmware; physical commissioning is required. This prerelease is excluded from stable firmware bundles.']
        else:
            args += ['--verify-tag']
        gh(*args)
    gh('release', 'upload', tag, *[str(path) for path in assets], '--clobber')
    if development:
        gh('release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false')
        print(f'Published development prerelease {tag}.')
    else:
        print(f'Version release {tag} is a complete draft; review and publish it to make it stable.')
    return tag


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path('release-assets'))
    args = parser.parse_args()
    try:
        tag = publish(args.directory, os.environ)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        parser.exit(1, detail + '\n')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as output:
            output.write(f'### Release downloads\n\nhttps://github.com/{os.environ["GITHUB_REPOSITORY"]}/releases/tag/{tag}\n')


if __name__ == '__main__':
    main()

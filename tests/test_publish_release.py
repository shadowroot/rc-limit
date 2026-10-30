"""Release gating, completeness and publication order without contacting GitHub."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('publish_release', ROOT / 'scripts/publish-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = 'a' * 40
ENV = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': SHA, 'GITHUB_RUN_NUMBER': '42'}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for name in ['pico', 'esp32', 'esp32c3', 'esp32c3-devkit', 'web']:
            (self.directory / f'rc-limit-{name}.zip').write_bytes(name.encode())
        for name in ['rc-limit-desktop-linux-x64.tar.gz', 'rc-limit-desktop-0.1.0-windows-x64-setup.exe', 'rc-limit-desktop-0.1.0-windows-x64-portable.exe']:
            (self.directory / name).write_bytes(name.encode())
        self.commands = []

    def run_gh(self, *args, **kwargs):
        self.commands.append(args)
        return subprocess.CompletedProcess(args, 0, '[[]]' if args[0] == 'api' else '', '')

    def existing(self, draft=False, complete=True):
        names = [path.name for path in release.collect_assets(self.directory)] if complete else []
        return {'tag_name': 'dev-42-' + SHA[:12], 'target_commitish': SHA, 'prerelease': True, 'draft': draft, 'assets': [{'name': name} for name in names]}

    def test_main_publishes_only_after_complete_upload(self):
        with patch.object(release, 'gh', side_effect=self.run_gh):
            self.assertEqual(release.publish(self.directory, ENV), 'dev-42-' + SHA[:12])
        api, create, upload, publish = self.commands
        self.assertIn('--slurp', api)
        self.assertIn('--draft', create)
        self.assertIn('--prerelease', create)
        self.assertIn('--latest=false', create)
        self.assertEqual(create[create.index('--target') + 1], SHA)
        self.assertEqual(upload[:2], ('release', 'upload'))
        self.assertEqual(len(upload[3:-1]), 9)  # eight binaries/ZIPs and checksum list
        checksums = (self.directory / 'SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(checksums), 8)
        self.assertIn('--draft=false', publish)
        self.assertIn('--latest=false', publish)

    def test_version_tag_stays_draft_and_requires_tag(self):
        with patch.object(release, 'gh', side_effect=self.run_gh):
            release.publish(self.directory, {**ENV, 'GITHUB_REF': 'refs/tags/v0.2.0'})
        self.assertIn('--verify-tag', self.commands[1])
        self.assertFalse(any(args[:2] == ('release', 'edit') for args in self.commands))

    def test_feature_branches_pull_requests_and_bad_sha_never_contact_github(self):
        with patch.object(release, 'gh') as gh:
            for env in [{**ENV, 'GITHUB_REF': 'refs/heads/feature/test'}, {**ENV, 'GITHUB_EVENT_NAME': 'pull_request'}, {**ENV, 'GITHUB_SHA': 'main'}]:
                with self.assertRaises(ValueError):
                    release.publish(self.directory, env)
            gh.assert_not_called()
        self.assertEqual(release.release_identity({**ENV, 'GITHUB_EVENT_NAME': 'workflow_dispatch'})[0], 'dev-42-' + SHA[:12])

    def test_missing_board_never_creates_release(self):
        (self.directory / 'rc-limit-pico.zip').unlink()
        with patch.object(release, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, 'Missing or empty'):
                release.publish(self.directory, ENV)
            gh.assert_not_called()

    def test_failed_upload_never_publishes(self):
        def gh(*args, **kwargs):
            if args[:2] == ('release', 'upload'):
                raise subprocess.CalledProcessError(1, args, stderr='Upload failed')
            return self.run_gh(*args, **kwargs)
        with patch.object(release, 'gh', side_effect=gh):
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish(self.directory, ENV)
        self.assertFalse(any(args[:2] == ('release', 'edit') for args in self.commands))

    def test_api_failure_is_not_treated_as_absent_release(self):
        with patch.object(release, 'gh', side_effect=subprocess.CalledProcessError(1, 'gh', stderr='Forbidden')) as gh:
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish(self.directory, ENV)
        self.assertEqual(gh.call_count, 1)

    def test_published_release_is_unchanged_and_draft_can_resume(self):
        for draft in (False, True):
            existing = self.existing(draft=draft)
            def gh(*args, **kwargs):
                if args[0] == 'api':
                    return subprocess.CompletedProcess(args, 0, json.dumps([[], [existing]]), '')
                return self.run_gh(*args, **kwargs)
            self.commands.clear()
            with patch.object(release, 'gh', side_effect=gh):
                release.publish(self.directory, ENV)
            self.assertFalse(any(args[:2] == ('release', 'create') for args in self.commands))
            self.assertEqual(bool(self.commands), draft)

    def test_incomplete_published_release_fails_without_overwriting(self):
        with patch.object(release, 'gh', return_value=subprocess.CompletedProcess([], 0, json.dumps([[self.existing(complete=False)]]), '')) as gh:
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                release.publish(self.directory, ENV)
            self.assertEqual(gh.call_count, 1)


if __name__ == '__main__':
    unittest.main()

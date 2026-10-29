import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('publisher', ROOT/'scripts/publish-stable-web.py')
publisher = importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)


class PublishTests(unittest.TestCase):
    def test_refresh_preserves_firmware_checksums_and_replaces_only_web_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path.cwd()
            try:
                os.chdir(tmp);Path('build/releases').mkdir(parents=True)
                with zipfile.ZipFile('build/releases/rc-limit-web.zip','w') as archive:
                    archive.writestr('web/firmware/catalog.json',json.dumps({'release':{'tag':'v1'}}))
                calls = []
                def run(args, **kwargs):
                    calls.append(args)
                    if args[2] == 'download':
                        folder=Path(args[args.index('--dir')+1]);folder.mkdir(exist_ok=True)
                        (folder/'SHA256SUMS').write_text('a'*64+'  rc-limit-pico.zip\n'+'b'*64+'  rc-limit-web.zip\n\n')
                with patch.object(publisher.subprocess,'check_output',return_value=json.dumps({'tag_name':'v1'})), patch.object(publisher.subprocess,'run',side_effect=run):
                    publisher.main()
                text=Path('build/stable-web-checksums/SHA256SUMS').read_text()
                self.assertIn('a'*64+'  rc-limit-pico.zip',text)
                self.assertNotIn('b'*64,text)
                self.assertEqual(len(calls),2)
                with patch.object(publisher.subprocess,'check_output',return_value=json.dumps({'tag_name':'v1','immutable':True})), patch.object(publisher.subprocess,'run') as upload:
                    publisher.main();upload.assert_not_called()
            finally:
                os.chdir(old)

"""Exercise the actual publisher against a failing, stateful GitHub boundary."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'bin').mkdir()
        shutil.copy(ROOT / 'scripts/publish-sparkle-feed.sh', self.root / 'scripts')
        (self.root / 'scripts/sparkle-appcast.py').write_text('''
import os, pathlib, sys
if os.environ.get('FAIL_SIGNING'): sys.exit(2)
previous = pathlib.Path(sys.argv[4]).read_text() if len(sys.argv) > 4 else ''
pathlib.Path(sys.argv[3]).write_text(previous + '+next')
''')
        gh = self.root / 'bin/gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['PUBLISH_TEST_ROOT'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
args = sys.argv[1:]
command = args[1]
if command == 'view':
    if not state['exists'] or os.environ.get('FAIL_READ'): sys.exit(1)
    print(json.dumps({'assets': [{'name': name} for name in state['assets']]}))
elif command == 'create':
    if state['exists']: sys.exit(1)
    state['exists'] = True
elif command == 'download':
    if os.environ.get('FAIL_READ') or os.environ.get('FAIL_DOWNLOAD'): sys.exit(1)
    name = args[args.index('--pattern') + 1]
    destination = pathlib.Path(args[args.index('--dir') + 1]) / name
    destination.write_text(state['assets'][name])
elif command == 'upload':
    path = pathlib.Path(args[3])
    state['assets'].pop(path.name, None)
    if ((path.name == 'appcast.xml' and os.environ.get('FAIL_UPLOAD')) or
        (path.name == 'appcast.previous.xml' and os.environ.get('FAIL_BACKUP'))):
        state_path.write_text(json.dumps(state))
        sys.exit(1)
    state['assets'][path.name] = path.read_text()
else:
    raise ValueError(args)
state_path.write_text(json.dumps(state))
''')
        gh.chmod(0o755)

    def run_publisher(self, **flags):
        return subprocess.run(['bash', str(self.root / 'scripts/publish-sparkle-feed.sh'), '2.3.19'],
                              env={**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'],
                                   'PUBLISH_TEST_ROOT': str(self.root), **flags}, capture_output=True)

    def seed(self, exists, assets):
        (self.root / 'state.json').write_text(json.dumps({'exists': exists, 'assets': assets}))

    def state(self):
        return json.loads((self.root / 'state.json').read_text())

    def test_first_upload_failure_can_retry_empty_release(self):
        self.seed(False, {})
        self.assertNotEqual(self.run_publisher(FAIL_UPLOAD='1').returncode, 0)
        self.assertEqual(self.state(), {'exists': True, 'assets': {}})
        self.assertEqual(self.run_publisher().returncode, 0)
        self.assertEqual(self.state()['assets'], {'appcast.xml': '+next'})

    def test_failed_replacement_recovers_history_from_backup(self):
        self.seed(True, {'appcast.xml': 'stable+beta'})
        self.assertNotEqual(self.run_publisher(FAIL_UPLOAD='1').returncode, 0)
        self.assertEqual(self.state()['assets'], {'appcast.previous.xml': 'stable+beta'})
        self.assertEqual(self.run_publisher(FAIL_BACKUP='1').returncode, 0)
        self.assertEqual(self.state()['assets'], {
            'appcast.previous.xml': 'stable+beta', 'appcast.xml': 'stable+beta+next'})

    def test_signing_failure_does_not_create_release(self):
        self.seed(False, {})
        self.assertNotEqual(self.run_publisher(FAIL_SIGNING='1').returncode, 0)
        self.assertEqual(self.state(), {'exists': False, 'assets': {}})

    def test_read_failure_does_not_replace_existing_feed(self):
        self.seed(True, {'appcast.xml': 'stable+beta'})
        self.assertNotEqual(self.run_publisher(FAIL_READ='1').returncode, 0)
        self.assertEqual(self.state(), {'exists': True, 'assets': {'appcast.xml': 'stable+beta'}})

    def test_listed_asset_download_failure_preserves_feed(self):
        self.seed(True, {'appcast.xml': 'stable+beta'})
        self.assertNotEqual(self.run_publisher(FAIL_DOWNLOAD='1').returncode, 0)
        self.assertEqual(self.state(), {'exists': True, 'assets': {'appcast.xml': 'stable+beta'}})


if __name__ == '__main__':
    unittest.main()

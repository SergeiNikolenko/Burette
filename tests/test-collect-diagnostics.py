import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('diagnostics', Path(__file__).parents[1] / 'scripts/collect-diagnostics.py')
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


class DiagnosticsTests(unittest.TestCase):
    def test_redaction(self):
        result = diag.redact('https://private.example/?token=secret /Users/alice/private.xyz %252FUsers%252Falice%252Fsecret api_key=secret Bearer secret 10.2.3.4')
        for private in ('private.example', 'alice', 'secret', '10.2.3.4'):
            self.assertNotIn(private, result)

    def test_capture_bounds_missing_and_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            source.mkdir()
            output = Path(root) / 'capture'
            entry = {'at': '2026-10-24T12:00:00Z', 'kind': 'error', 'action': 'compute-failed',
                     'detail': {'molblock': 'PRIVATE_MOLECULE', 'id': 'job-123',
                                'durableJobId': 'durable-456', 'operation': 'optimize',
                                'status': 'failed', 'error': 'Cannot read /Users/alice/a.sdf',
                                'contents': 'PRIVATE_MOLECULE'}, 'target': '/Users/alice/a.sdf'}
            (source / 'ActionJournal.jsonl').write_text((json.dumps(entry) + '\n') * 2000)
            (source / 'BuretteApp.log').write_text('1792795865006 error frontend none compute 0 /Users/alice/private.sdf token=secret\n' + '[error] ' + 'x' * 10000 + '\nPRIVATE_MOLECULE\n')
            summary = diag.capture(source, output)
            self.assertEqual(summary['sources'][0]['status'], 'missing')
            self.assertTrue(summary['sources'][1]['truncated'])
            self.assertEqual(summary['sources'][1]['outputLines'], 500)
            retained = json.loads((output / 'ActionJournal.jsonl').read_text().splitlines()[0])
            self.assertEqual(retained['detail'], {'id': 'job-123', 'durableJobId': 'durable-456',
                             'operation': 'optimize', 'status': 'failed',
                             'error': 'Cannot read [PATH]'})
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for path in output.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertNotIn('PRIVATE_MOLECULE', path.read_text())
                self.assertNotIn('alice', path.read_text())
                self.assertNotIn('secret', path.read_text())
            self.assertLess(len(summary['recentErrors']), 21)
            with self.assertRaises(FileExistsError):
                diag.capture(source, output)

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root)
            (source / 'BuretteApp.log').symlink_to('/etc/passwd')
            result = diag.capture(source, source / 'capture')
            self.assertEqual(result['sources'][2]['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()

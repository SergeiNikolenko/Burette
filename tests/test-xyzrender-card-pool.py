"""Exercise the embedded worker protocol; --live also compares installed API/CLI SVGs.

Run --live with the bundled Python and PYTHONPATH used by Burette's worker launch.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'apps/desktop/src-tauri/src/preview/xyzrender_pool.rs').read_text()
HELPER = SOURCE.split('const XYZRENDER_GRID_WORKER_HELPER: &str = r#"', 1)[1].split('"#;', 1)[0]
LIVE = '--live' in sys.argv
if LIVE:
    sys.argv.remove('--live')


class CardPoolTest(unittest.TestCase):
    def test_protocol_preserves_modes_and_recovers_after_error(self):
        with tempfile.TemporaryDirectory(prefix='burette-card-pool-') as directory:
            root = Path(directory)
            # Assert the real embedded helper's API calls, without scientific dependencies.
            (root / 'xyzrender.py').write_text('''
import json
def load(value, **kwargs):
    if value == 'invalid': raise ValueError('invalid molecule')
    return value
def render(mol, **kwargs): return json.dumps(kwargs, sort_keys=True)
''')
            jobs = [dict(id=str(i), smiles='CO', config='default', outputPath=str(root / f'{i}.svg'), displayHydrogens=mode)
                    for i, mode in enumerate(['none', 'all', 'auto', None, 'none'])]
            jobs.insert(2, dict(id='bad', smiles='invalid', outputPath=str(root / 'bad.svg')))
            result = subprocess.run([sys.executable, '-u', '-c', HELPER],
                                    input=''.join(json.dumps(job) + '\n' for job in jobs),
                                    text=True, capture_output=True, timeout=15,
                                    env={**os.environ, 'PYTHONPATH': str(root), 'PYTHONDONTWRITEBYTECODE': '1'})
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in responses], [job['id'] for job in jobs])
            self.assertEqual(responses[2]['error'], 'invalid molecule')
            actual = [json.loads((root / f'{i}.svg').read_text()) for i in range(5)]
            self.assertEqual(actual, [
                {'config': 'default', 'no_hy': True}, {'config': 'default', 'hy': True},
                {'config': 'default'}, {'config': 'default'}, {'config': 'default', 'no_hy': True},
            ])

    @unittest.skipUnless(LIVE, 'Use --live with the bundled xyzrender Python for API/CLI equivalence')
    def test_live_api_cli_hydrogen_geometry(self):
        from importlib.metadata import version
        self.assertEqual(version('xyzrender'), '0.3.8', 'Verify against the bundled dependency pin')
        with tempfile.TemporaryDirectory(prefix='burette-card-live-') as directory:
            root = Path(directory)
            molecule = ROOT / 'apps/burette-public-plugin/public/demo-library/Quantum/caffeine.xyz'
            modes = [('none', ['--no-hy']), ('all', ['--hy']), ('auto', []), ('none', ['--no-hy'])]
            jobs = [dict(id=str(i), inputPath=str(molecule), config='default',
                         outputPath=str(root / f'pool-{i}.svg'), displayHydrogens=mode)
                    for i, (mode, _) in enumerate(modes)]
            result = subprocess.run([sys.executable, '-u', '-c', HELPER],
                                    input=''.join(json.dumps(job) + '\n' for job in jobs),
                                    text=True, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(all('error' not in json.loads(line) for line in result.stdout.splitlines()), result.stdout)
            geometries = []
            for i, (_, flags) in enumerate(modes):
                output = root / f'cli-{i}.svg'
                subprocess.run([sys.executable, '-c', 'from xyzrender.cli import main; main()',
                                str(molecule), '-o', str(output), '--config', 'default', *flags],
                               check=True, capture_output=True, timeout=30)
                def geometry(text):
                    # Each SVG namespaces gradient references with a fresh UUID.
                    text = re.sub(r'\bx[0-9a-f]{32}', 'xUUID', text)
                    return re.findall(r'<(?:circle|ellipse|line|path|polygon|polyline)\b[^>]*>', text)
                pooled = geometry((root / f'pool-{i}.svg').read_text())
                self.assertTrue(pooled)
                self.assertEqual(pooled, geometry(output.read_text()), f'API/CLI geometry differs for {modes[i][0]}')
                geometries.append(pooled)
            self.assertNotEqual(geometries[0], geometries[1], 'H must actually change the molecular drawing')
            self.assertEqual(geometries[0], geometries[3], 'H settings must not leak between pooled jobs')


if __name__ == '__main__':
    unittest.main()

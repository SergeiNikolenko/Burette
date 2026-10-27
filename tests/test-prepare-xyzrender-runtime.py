#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).resolve().parents[1] / 'scripts/prepare-xyzrender-runtime.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RuntimePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.locks = self.root / 'config/xyzrender'
        self.locks.mkdir(parents=True)
        payload = self.root / 'archive.tar.gz'
        payload.write_bytes(b'fixture archive')
        self.metadata = {name: {'url': payload.as_uri(), 'sha256': hashlib.sha256(payload.read_bytes()).hexdigest(),
                                'executable': f'{name}/bin/{name}'} for name in ('python', 'uv')}
        (self.locks / 'bootstrap.json').write_text(json.dumps(self.metadata))
        (self.locks / 'requirements.txt').write_text('fixture==1 --hash=sha256:123\n')
        for target, value in [('ROOT', self.root), ('LOCKS', self.locks)]:
            patcher = patch.object(prepare, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_wrong_bootstrap_hash_prevents_extraction_and_execution(self):
        self.metadata['python']['sha256'] = '0' * 64
        (self.locks / 'bootstrap.json').write_text(json.dumps(self.metadata))
        with patch.object(prepare.sys, 'platform', 'darwin'), patch.object(prepare.platform, 'machine', return_value='arm64'), patch.object(prepare.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                prepare.prepare()
            run.assert_not_called()
        self.assertEqual(list((self.root / 'build').iterdir()), [])

    def test_wrong_platform_does_not_download_or_create_runtime(self):
        with patch.object(prepare.sys, 'platform', 'linux'), patch.object(prepare.urllib.request, 'urlopen') as download:
            with self.assertRaisesRegex(RuntimeError, 'macOS arm64'):
                prepare.prepare()
            download.assert_not_called()
        self.assertFalse((self.root / 'build').exists())

    def test_fresh_runtime_ignores_untrusted_installer_environment(self):
        calls = []
        def record(command, **kwargs):
            calls.append((command, kwargs))
        with patch.object(prepare.sys, 'platform', 'darwin'), patch.object(prepare.platform, 'machine', return_value='arm64'), patch.object(prepare.subprocess, 'run', side_effect=record), patch.dict(os.environ, {
            'UV_NO_VERIFY_HASHES': '1', 'UV_EXTRA_INDEX_URL': 'https://untrusted.invalid',
            'PIP_CONFIG_FILE': '/untrusted', 'PYTHONPATH': '/untrusted', 'VIRTUAL_ENV': '/untrusted',
        }):
            first = prepare.prepare()
            second = prepare.prepare()
        self.assertNotEqual(first, second)
        self.assertTrue(first.parent.is_dir() and second.parent.is_dir())
        installs = [(cmd, options) for cmd, options in calls if 'sync' in cmd]
        self.assertEqual(len(installs), 2)
        for command, options in installs:
            self.assertIn('--require-hashes', command)
            self.assertIn('--no-python-downloads', command)
            self.assertIn('--no-config', command)
            self.assertIn('--no-cache', command)
            self.assertEqual(command[command.index('--only-binary') + 1], ':all:')
            self.assertEqual(options['cwd'], self.root, 'Resolve the vendored wheel from the repository root')
            self.assertEqual(options['env']['MACOSX_DEPLOYMENT_TARGET'], '12.0')
            self.assertFalse(any(key.startswith(('UV_', 'PIP_', 'PYTHON')) or key == 'VIRTUAL_ENV' for key in options['env']))

    def test_build_exit_cleans_owned_runtime_and_preserves_exit_status(self):
        source = Path(__file__).resolve().parents[1] / 'scripts/build.sh'
        prefix = source.read_text().split('cat <<HDR', 1)[0]
        scripts = self.root / 'scripts'
        scripts.mkdir()
        script = scripts / 'build.sh'
        script.write_text(prefix + '\nOWNED_XYZRENDER_SOURCE="$ROOT/owned-runtime"\n'
                          'mkdir "$OWNED_XYZRENDER_SOURCE"\n'
                          'printf "%s\\n" "$SAFE_ROOT"\nexit "$TEST_EXIT_CODE"\n')
        for status, keep in ((0, '0'), (17, '0'), (17, '1')):
            with self.subTest(status=status, keep=keep):
                env = {key: value for key, value in os.environ.items() if not key.startswith('BURETTE_')}
                env.update(TMPDIR=str(self.root), TEST_EXIT_CODE=str(status), BURETTE_KEEP_FAILED_BUILD=keep)
                result = subprocess.run(['bash', str(script)], env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertFalse((self.root / 'owned-runtime').exists())
                safe = Path(result.stdout.strip())
                self.assertEqual(safe.exists(), status != 0 and keep == '1')

    def test_quicklook_bundles_standalone_python_rpath_library(self):
        runtime = self.root / 'python'
        (runtime / 'bin').mkdir(parents=True)
        (runtime / 'lib').mkdir()
        python = runtime / 'bin/python3'
        python.write_bytes(b'python fixture')
        python.chmod(0o700)
        library = runtime / 'lib/libpython3.13.dylib'
        library.write_bytes(b'library fixture')
        venv = self.root / 'venv'
        venv.mkdir()
        (venv / 'pyvenv.cfg').write_text(f'home = {runtime}/bin\n')
        commands = self.root / 'commands'
        commands.mkdir()
        for name, body in {
            'otool': 'printf "%s\\n" "@rpath/libpython3.13.dylib (compatibility version 3.13.0)"',
            'ditto': 'cp "$3" "$4"',
            'install_name_tool': 'printf "%s\\n" "$@" > "$TEST_LINK_ARGS"',
        }.items():
            executable = commands / name
            executable.write_text('#!/bin/sh\n' + body + '\n')
            executable.chmod(0o700)
        bundle = self.root / 'Preview.appex'
        args = self.root / 'link-args'
        env = {**os.environ, 'PATH': str(commands) + os.pathsep + os.environ['PATH'],
               'BURETTE_XYZRENDER_ENV': str(venv), 'CODESIGNING_FOLDER_PATH': str(bundle),
               'CODE_SIGNING_ALLOWED': 'NO', 'TEST_LINK_ARGS': str(args)}
        script = Path(__file__).resolve().parents[1] / 'scripts/bundle-quicklook-xyzrender-launcher.sh'
        subprocess.run(['bash', str(script)], env=env, check=True)
        self.assertEqual((bundle / 'Contents/lib/libpython3.13.dylib').read_bytes(), library.read_bytes())
        self.assertEqual((bundle / 'Contents/Resources/xyzrender-python3').read_bytes(), python.read_bytes())
        self.assertIn('@executable_path/../lib/libpython3.13.dylib', args.read_text())
        library.unlink()
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'could not resolve xyzrender Python shared library', result.stderr)

    def test_failed_wheel_install_is_not_returned_or_retained(self):
        def run(command, **kwargs):
            if 'sync' in command:
                raise subprocess.CalledProcessError(1, command, stderr='Missing or incorrect requirement hash')
        with patch.object(prepare.sys, 'platform', 'darwin'), patch.object(prepare.platform, 'machine', return_value='arm64'), patch.object(prepare.subprocess, 'run', side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError):
                prepare.prepare()
        self.assertEqual(list((self.root / 'build').iterdir()), [])

    def test_native_build_rejects_stale_renderer_and_accepts_snapshot(self):
        source = (Path(__file__).resolve().parents[1] / 'scripts/build.sh').read_text()
        guard = 'ensure_xyzrender_rdkit() {' + source.split('ensure_xyzrender_rdkit() {', 1)[1].split('relocate_bundled_python_runtime() {', 1)[0]
        expected = '9.9.9+fixture.1'
        (self.locks / 'source.json').write_text(json.dumps({'version': expected}))
        environment = self.root / 'venv'
        (environment / 'bin').mkdir(parents=True)
        (environment / 'bin/python3').symlink_to(sys.executable)
        site = self.root / 'site'
        (site / 'rdkit').mkdir(parents=True)
        (site / 'rdkit/__init__.py').write_text('class Chem:\n    MolFromSmiles = staticmethod(lambda value: object())\n')
        metadata = site / 'xyzrender-fixture.dist-info'
        metadata.mkdir()
        script = guard + '\nROOT="$1"\nLOCAL_XYZRENDER_ENV="$2"\nensure_xyzrender_rdkit\n'
        for installed, success in [('0.3.8', False), (expected, True)]:
            with self.subTest(installed=installed):
                (metadata / 'METADATA').write_text(f'Name: xyzrender\nVersion: {installed}\n')
                result = subprocess.run(['bash', '-c', script, 'guard', str(self.root), str(environment)],
                                        env={**os.environ, 'PYTHONPATH': str(site)}, text=True, capture_output=True)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                if not success:
                    self.assertIn('BURETTE_BUILD_LOCKED_XYZRENDER=1', result.stderr)


if __name__ == '__main__':
    unittest.main()

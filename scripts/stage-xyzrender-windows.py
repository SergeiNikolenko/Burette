#!/usr/bin/env python3
"""Stage the locked xyzrender runtime as Windows x86_64 Tauri resources.

Writes <out>/xyzrender-runtime (site-packages and the bin\\xyzrender.cmd
wrapper), <out>/xyzrender-python (python-build-standalone CPython) and
<out>/tauri.xyzrender.conf.json, and prints the overlay's path. Wheels are
installed for the Windows platform with uv, so a Linux or macOS host can stage
the same tree with --cross for inspection; only a Windows host runs it
(startup bytecode and a smoke test).
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCKS = ROOT / 'config/xyzrender'
BOOTSTRAP = 'bootstrap-windows-x86_64.json'
REQUIREMENTS = 'requirements-windows-x86_64.txt'
PYTHON_PLATFORM = 'x86_64-pc-windows-msvc'
# Interpreter parts nothing runs: headers and import libraries, the windowed
# launcher and empty Scripts, and Tcl/Tk with tkinter (xyzrender renders headless).
DROPPED_PYTHON_PATHS = (
    'include', 'libs', 'Scripts', 'pythonw.exe', 'tcl', 'DLLs/_tkinter.pyd', 'DLLs/tcl*.dll',
    'DLLs/tk*.dll', 'Lib/tkinter', 'Lib/turtledemo', 'Lib/turtle.py',
)
# CRLF line endings: cmd.exe misparses labels in LF-only batch files.
WRAPPER = '\r\n'.join([
    '@echo off',
    'setlocal',
    'set "PYTHON=%~dp0..\\..\\xyzrender-python\\python.exe"',
    'set "SITE_PACKAGES=%~dp0..\\lib\\{python}\\site-packages"',
    'if not exist "%PYTHON%" goto missing_python',
    'if not exist "%SITE_PACKAGES%\\xyzrender\\" goto missing_site_packages',
    'set "PYTHONNOUSERSITE=1"',
    'set "PYTHONDONTWRITEBYTECODE=1"',
    'set "PYTHONPATH=%SITE_PACKAGES%"',
    # Piped output would otherwise use the ANSI code page, which cannot encode
    # the help text.
    'set "PYTHONUTF8=1"',
    '"%PYTHON%" -m xyzrender.cli %*',
    'exit /b %ERRORLEVEL%',
    ':missing_python',
    '>&2 echo missing bundled python runtime: "%PYTHON%"',
    'exit /b 1',
    ':missing_site_packages',
    '>&2 echo missing bundled site-packages: "%SITE_PACKAGES%"',
    'exit /b 1',
    '',
])

spec = importlib.util.spec_from_file_location('prepare_xyzrender_runtime', ROOT / 'scripts/prepare-xyzrender-runtime.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def clean_environment():
    # Ambient pip/uv/Python configuration must not weaken hash checks or inject packages.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('UV_', 'PIP_', 'PYTHON')) and key != 'VIRTUAL_ENV'}
    env.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1')
    return env


def host_uv(work, windows_lock, native):
    """A verified uv that runs on this host; the Windows build on Windows."""
    if native:
        artifact = windows_lock['uv']
        archive = work / 'uv.zip'
        prepare.download_verified(artifact, archive)
        with zipfile.ZipFile(archive) as bundle:
            return Path(bundle.extract(artifact['executable'], work / 'uv'))
    target = prepare.TARGETS.get((sys.platform, platform.machine()))
    if target is None:
        raise RuntimeError('Cross-staging needs a host with a pinned uv: macOS arm64 or Linux x86_64')
    artifact = json.loads((LOCKS / target['bootstrap']).read_text())['uv']
    archive = work / 'uv.tar.gz'
    prepare.download_verified(artifact, archive)
    with tarfile.open(archive) as bundle:
        bundle.extractall(work / 'uv', filter='data')
    return work / 'uv' / artifact['executable']


def python_tag(python_root):
    # python313.dll names the interpreter's version, as Lib\site-packages does not.
    versions = [match.group(1) for path in python_root.glob('python3*.dll')
                if (match := re.fullmatch(r'python3(\d+)\.dll', path.name, re.IGNORECASE))]
    if len(versions) != 1:
        raise ValueError('Expected exactly one python3XY.dll in the Windows interpreter')
    return f'3.{versions[0]}'


def tree_summary(root):
    files = [path for path in root.rglob('*') if path.is_file()]
    return {
        'files': len(files),
        'bytes': sum(path.stat().st_size for path in files),
        'longest_relative_path': max((len(str(path.relative_to(root))) for path in files), default=0),
    }


def stage(out, cross=False):
    native = (sys.platform, platform.machine()) == ('win32', 'AMD64')
    if not native and not cross:
        raise RuntimeError('Staging the Windows renderer runs it only on Windows x86_64; pass --cross to stage it unexecuted')
    out = out.resolve()
    runtime, python_root = out / 'xyzrender-runtime', out / 'xyzrender-python'
    overlay = out / 'tauri.xyzrender.conf.json'
    (ROOT / 'build').mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='xyzrender-windows-', dir=ROOT / 'build'))
    try:
        lock = json.loads((LOCKS / BOOTSTRAP).read_text())
        archive = work / 'python.tar.gz'
        prepare.download_verified(lock['python'], archive)
        # No downloaded bytes are extracted or executed until their hash matches.
        with tarfile.open(archive) as bundle:
            bundle.extractall(work / 'python-dist', filter='data')
        uv = host_uv(work, lock, native)
        for path in (runtime, python_root):
            shutil.rmtree(path, ignore_errors=True)
        overlay.unlink(missing_ok=True)
        out.mkdir(parents=True, exist_ok=True)
        shutil.move(str((work / 'python-dist' / lock['python']['executable']).parent), str(python_root))
        for pattern in DROPPED_PYTHON_PATHS:
            for path in python_root.glob(pattern):
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
        version = python_tag(python_root)
        site = runtime / 'lib' / f'python{version}' / 'site-packages'
        env = clean_environment()
        # uv resolves markers and wheel tags for the target, not this host;
        # cached extracted wheels are mutable and are not rehashed by uv.
        subprocess.run([str(uv), '--no-config', '--no-progress', '--no-cache', 'pip', 'sync',
                        '--no-python-downloads', '--python', str(python_root / 'python.exe') if native else sys.executable,
                        '--target', str(site), '--python-platform', PYTHON_PLATFORM, '--python-version', version,
                        '--default-index', 'https://pypi.org/simple', '--require-hashes', '--only-binary', ':all:',
                        str(LOCKS / REQUIREMENTS)], cwd=ROOT, env=env, check=True, stdout=sys.stderr)
        # Console-script launchers point at the installing interpreter, and
        # uv's install lock is not part of any distribution.
        for name in ('bin', 'Scripts'):
            shutil.rmtree(site / name, ignore_errors=True)
        (site / '.lock').unlink(missing_ok=True)
        if os.environ.get('BURETTE_KEEP_FULL_XYZRENDER_RUNTIME', '0') != '1':
            # Pruning reads installed metadata only, so the host interpreter
            # can do it with the staged pure-Python packaging distribution.
            subprocess.run([sys.executable, str(ROOT / 'scripts/prune-xyzrender-runtime.py'), str(runtime), str(python_root)],
                           env={**env, 'PYTHONPATH': str(site)}, check=True, stdout=sys.stderr)
        for root in (runtime, python_root):
            for cache in list(root.rglob('__pycache__')):
                shutil.rmtree(cache)
            for path in [*root.rglob('*.pyc'), *root.rglob('*.pyo')]:
                path.unlink()
        wrapper = runtime / 'bin' / 'xyzrender.cmd'
        wrapper.parent.mkdir()
        wrapper.write_bytes(WRAPPER.replace('{python}', f'python{version}').encode())
        if native:
            # Installed packages are read-only, so ship hash-checked startup
            # bytecode built by the staged interpreter itself.
            subprocess.run([str(python_root / 'python.exe'), str(ROOT / 'scripts/prepare-xyzrender-bytecode.py'), str(out)],
                           env=env, check=True, stdout=sys.stderr)
            subprocess.run([str(wrapper), '--help'], env=env, check=True, stdout=subprocess.DEVNULL)
        else:
            print('warning: cross-staged Windows renderer was not executed; it has no startup bytecode', file=sys.stderr)
        resources = {runtime.as_posix(): 'xyzrender-runtime', python_root.as_posix(): 'xyzrender-python'}
        overlay.write_text(json.dumps({'bundle': {'resources': resources}}, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'xyzrender-runtime': tree_summary(runtime), 'xyzrender-python': tree_summary(python_root)}),
              file=sys.stderr)
        return overlay
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, required=True, help='directory that receives the staged resources')
    parser.add_argument('--cross', action='store_true', help='stage on a non-Windows host without executing the runtime')
    args = parser.parse_args()
    print(stage(args.out, cross=args.cross))

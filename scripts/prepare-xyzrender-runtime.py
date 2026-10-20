#!/usr/bin/env python3
"""Create a fresh, authenticated macOS arm64 renderer environment; print its path."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCKS = ROOT / 'config/xyzrender'
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024


def download_verified(artifact, destination):
    digest = hashlib.sha256()
    count = 0
    with urllib.request.urlopen(artifact['url'], timeout=60) as response, destination.open('xb') as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            count += len(block)
            if count > MAX_DOWNLOAD_BYTES:
                raise ValueError('Runtime bootstrap archive exceeds its size limit')
            digest.update(block)
            output.write(block)
    if digest.hexdigest() != artifact['sha256']:
        raise ValueError('Runtime bootstrap SHA-256 mismatch')


def prepare():
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Bundled renderer preparation requires macOS arm64')
    (ROOT / 'build').mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='xyzrender-source-', dir=ROOT / 'build'))
    try:
        metadata = json.loads((LOCKS / 'bootstrap.json').read_text())
        for name in ('python', 'uv'):
            archive = directory / (name + '.tar.gz')
            download_verified(metadata[name], archive)
            # No downloaded bytes are extracted or executed until their hash matches.
            subprocess.run(['/usr/bin/tar', '-xzf', str(archive), '-C', str(directory)], check=True)
            archive.unlink()
        python = directory / metadata['python']['executable']
        uv = directory / metadata['uv']['executable']
        environment = directory / 'venv'
        # Ambient pip/uv configuration must not weaken hash checks or inject packages.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('UV_', 'PIP_', 'PYTHON')) and key != 'VIRTUAL_ENV'}
        env['MACOSX_DEPLOYMENT_TARGET'] = '12.0'
        # Cached extracted wheels are mutable and are not rehashed by uv.
        command = [str(uv), '--no-config', '--no-progress', '--no-cache']
        subprocess.run(command + ['venv', '--no-python-downloads', '--python', str(python), str(environment)],
                       env=env, check=True, stdout=sys.stderr)
        subprocess.run(command + ['pip', 'sync', '--no-python-downloads', '--python', str(environment / 'bin/python3'),
                                 '--default-index', 'https://pypi.org/simple', '--python-platform', 'aarch64-apple-darwin',
                                 '--require-hashes', '--only-binary', ':all:', str(LOCKS / 'requirements.txt')],
                       env=env, check=True, stdout=sys.stderr)
        subprocess.run(command + ['pip', 'check', '--python', str(environment / 'bin/python3')],
                       env=env, check=True, stdout=sys.stderr)
        subprocess.run([str(environment / 'bin/python3'), '-c',
                        'import xyzrender; from rdkit import Chem; assert Chem.MolFromSmiles("CCO") is not None'],
                       env=env, check=True, stdout=sys.stderr)
        return environment
    except BaseException:
        shutil.rmtree(directory)
        raise


if __name__ == '__main__':
    print(prepare())

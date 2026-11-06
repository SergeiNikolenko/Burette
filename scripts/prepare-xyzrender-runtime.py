#!/usr/bin/env python3
"""Create a fresh, authenticated renderer environment for this host; print its path."""
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
# Each supported host has its own pinned interpreter, uv build and hash lock.
TARGETS = {
    ('darwin', 'arm64'): {
        'bootstrap': 'bootstrap.json', 'requirements': 'requirements.txt',
        'python_platform': 'aarch64-apple-darwin', 'tar': ['/usr/bin/tar'],
        'env': {'MACOSX_DEPLOYMENT_TARGET': '12.0'},
    },
    # manylinux_2_28 keeps the shipped wheels loadable on glibc 2.28 and newer,
    # independent of the build container's glibc. Root in a build container
    # would otherwise keep the archives' foreign uids on the extracted files.
    ('linux', 'x86_64'): {
        'bootstrap': 'bootstrap-linux-x86_64.json', 'requirements': 'requirements-linux-x86_64.txt',
        'python_platform': 'x86_64-manylinux_2_28', 'tar': ['tar', '--no-same-owner'], 'env': {},
    },
}


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
    target = TARGETS.get((sys.platform, platform.machine()))
    if target is None:
        raise RuntimeError('Bundled renderer preparation requires macOS arm64 or Linux x86_64')
    (ROOT / 'build').mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='xyzrender-source-', dir=ROOT / 'build'))
    try:
        metadata = json.loads((LOCKS / target['bootstrap']).read_text())
        for name in ('python', 'uv'):
            archive = directory / (name + '.tar.gz')
            download_verified(metadata[name], archive)
            # No downloaded bytes are extracted or executed until their hash matches.
            subprocess.run([*target['tar'], '-xzf', str(archive), '-C', str(directory)], check=True)
            archive.unlink()
        python = directory / metadata['python']['executable']
        uv = directory / metadata['uv']['executable']
        environment = directory / 'venv'
        # Ambient pip/uv configuration must not weaken hash checks or inject packages.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('UV_', 'PIP_', 'PYTHON')) and key != 'VIRTUAL_ENV'}
        env.update(target['env'])
        # Cached extracted wheels are mutable and are not rehashed by uv.
        command = [str(uv), '--no-config', '--no-progress', '--no-cache']
        subprocess.run(command + ['venv', '--no-python-downloads', '--python', str(python), str(environment)],
                       env=env, check=True, stdout=sys.stderr)
        subprocess.run(command + ['pip', 'sync', '--no-python-downloads', '--python', str(environment / 'bin/python3'),
                                 '--default-index', 'https://pypi.org/simple', '--python-platform', target['python_platform'],
                                 '--require-hashes', '--only-binary', ':all:', str(LOCKS / target['requirements'])],
                       cwd=ROOT, env=env, check=True, stdout=sys.stderr)
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

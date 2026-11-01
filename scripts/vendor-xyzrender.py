#!/usr/bin/env python3
"""Build the hash-locked xyzrender upstream snapshot wheel without networked builds."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'config/xyzrender'


def build(archive=None, uv='uv'):
    metadata = json.loads((CONFIG / 'source.json').read_text())
    if metadata.get('buildPython') and platform.python_version() != metadata['buildPython']:
        raise RuntimeError(f"Use pinned CPython {metadata['buildPython']} from config/xyzrender/bootstrap.json")
    with tempfile.TemporaryDirectory(prefix='burette-xyzrender-') as temporary:
        work = Path(temporary)
        source = work / 'source.tar.gz'
        if archive:
            shutil.copyfile(archive, source)
        else:
            with urllib.request.urlopen(metadata['url'], timeout=60) as response, source.open('xb') as output:
                count = 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > 160 * 1024 * 1024:
                        raise ValueError('xyzrender source archive exceeds its size limit')
                    output.write(chunk)
        with source.open('rb') as content:
            digest = hashlib.file_digest(content, 'sha256').hexdigest()
        if digest != metadata['sha256']:
            raise ValueError('xyzrender source SHA-256 mismatch')
        tree = work / 'source'
        tree.mkdir()
        prefix = f"xyzrender-{metadata['commit']}/"
        # Exclude large upstream examples, documentation and tests from wheel input.
        with tarfile.open(source) as bundle:
            for member in bundle:
                if member.name == prefix.rstrip('/') and member.isdir():
                    continue
                if not member.name.startswith(prefix):
                    raise ValueError('Unexpected xyzrender source archive root')
                relative = Path(member.name[len(prefix):])
                if relative.parts and (relative.parts[0] == 'src' or str(relative) in ('pyproject.toml', 'README.md', 'LICENSE')):
                    if member.isfile():
                        if '..' in relative.parts or relative.is_absolute() or member.size > 4 * 1024 * 1024:
                            raise ValueError('Unsafe xyzrender source member')
                        target = tree / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with bundle.extractfile(member) as content, target.open('xb') as output:
                            shutil.copyfileobj(content, output)
        for patch in metadata.get('patches', []):
            path = CONFIG / patch['path']
            if hashlib.sha256(path.read_bytes()).hexdigest() != patch['sha256']:
                raise ValueError('xyzrender build patch SHA-256 mismatch')
            subprocess.run(['/usr/bin/patch', '--batch', '--fuzz=0', '-p1', '-i', str(path)], cwd=tree, check=True)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('UV_', 'PIP_', 'PYTHON')) and key != 'VIRTUAL_ENV'}
        env['SOURCE_DATE_EPOCH'] = str(metadata['sourceDateEpoch'])
        command = [uv, '--no-config', '--no-cache', '--no-progress']
        venv = work / 'build-env'
        subprocess.run(command + ['venv', '--no-python-downloads', '--python', sys.executable, str(venv)], env=env, check=True)
        python = venv / 'bin/python3'
        subprocess.run(command + ['pip', 'sync', '--python', str(python), '--require-hashes', '--only-binary', ':all:',
                                 '--default-index', 'https://pypi.org/simple', str(CONFIG / 'build-requirements.txt')], env=env, check=True)
        wheels = work / 'wheels'
        wheels.mkdir()
        subprocess.run([str(python), '-c', 'import sys; from setuptools.build_meta import build_wheel; build_wheel(sys.argv[1])', str(wheels)],
                       cwd=tree, env=env, check=True, stdout=subprocess.DEVNULL)
        wheel = wheels / metadata['wheel']
        with wheel.open('rb') as content:
            digest = hashlib.file_digest(content, 'sha256').hexdigest()
        if metadata.get('wheelSha256') and digest != metadata['wheelSha256']:
            raise ValueError(f'xyzrender wheel SHA-256 mismatch: {digest}')
        destination = CONFIG / 'vendor' / wheel.name
        destination.parent.mkdir(exist_ok=True)
        shutil.copyfile(wheel, destination)
        shutil.copyfile(tree / 'LICENSE', destination.parent / 'LICENSE')
        print(f'{destination.relative_to(ROOT)} sha256:{digest}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Previously downloaded source archive (hash verified before use)')
    parser.add_argument('--uv', default='uv')
    args = parser.parse_args()
    build(args.archive, args.uv)

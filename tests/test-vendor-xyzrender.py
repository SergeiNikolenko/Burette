#!/usr/bin/env python3
"""Check that snapshot or patch tampering cannot run the wheel build backend."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('vendor', Path(__file__).resolve().parents[1] / 'scripts/vendor-xyzrender.py')
vendor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vendor)


class SnapshotAuthenticationTests(unittest.TestCase):
    def test_tampered_source_does_not_extract_or_execute_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.tar.gz'
            archive.write_bytes(b'changed source')
            (root / 'source.json').write_text(json.dumps({'sha256': '0' * 64}))
            with patch.object(vendor, 'CONFIG', root), patch.object(vendor.tarfile, 'open') as extract, patch.object(vendor.subprocess, 'run') as execute:
                with self.assertRaisesRegex(ValueError, 'source SHA-256 mismatch'):
                    vendor.build(archive)
                extract.assert_not_called()
                execute.assert_not_called()

    def test_tampered_patch_does_not_execute_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.tar.gz'
            with tarfile.open(archive, 'w:gz') as bundle:
                member = tarfile.TarInfo('xyzrender-fixture/LICENSE')
                member.size = 7
                bundle.addfile(member, io.BytesIO(b'license'))
            (root / 'fix.patch').write_text('changed patch')
            (root / 'source.json').write_text(json.dumps({
                'commit': 'fixture', 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                'patches': [{'path': 'fix.patch', 'sha256': '0' * 64}],
            }))
            with patch.object(vendor, 'CONFIG', root), patch.object(vendor.subprocess, 'run') as execute:
                with self.assertRaisesRegex(ValueError, 'patch SHA-256 mismatch'):
                    vendor.build(archive)
                execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()

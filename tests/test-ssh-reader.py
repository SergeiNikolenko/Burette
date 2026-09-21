import json, pathlib, subprocess, tempfile, unittest
WORKER = pathlib.Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/src/commands/ssh/reader.py'

class RemoteReader(unittest.TestCase):
    def request(self, root, operation, path='.'):
        return subprocess.run(['python3', str(WORKER)], input=json.dumps(dict(root=str(root), operation=operation, path=path)).encode(), capture_output=True, timeout=5)

    def test_roundtrip_and_unsafe_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / 'root'
            root.mkdir()
            (root / 'nested').mkdir()
            name = "nested/ligand ' $(echo secret) молекула.sdf"
            (root / name).write_bytes(b'example\x00structure')
            (root / 'escape').symlink_to('/etc')
            listing = self.request(root, 'list')
            self.assertEqual(listing.returncode, 0, listing.stderr)
            self.assertEqual([e['name'] for e in json.loads(listing.stdout)['entries']], ['nested'])
            content = self.request(root, 'read', name)
            self.assertEqual(content.stdout, b'example\x00structure')
            self.assertEqual(content.returncode, 0)
            for path in ('../outside', '/etc/passwd', 'escape/passwd'):
                response = self.request(root, 'read', path)
                self.assertNotEqual(response.returncode, 0)
                self.assertEqual(response.stdout, b'')

    def test_large_file_and_directory_are_not_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            with (root / 'large.pdb').open('wb') as file: file.truncate(64 * 1024 * 1024 + 1)
            for path in ('large.pdb', '.'):
                response = self.request(root, 'read', path)
                self.assertNotEqual(response.returncode, 0)
                self.assertEqual(response.stdout, b'')

    def test_directory_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            for i in range(2001): (root / str(i)).touch()
            result = json.loads(self.request(root, 'list').stdout)
            self.assertTrue(result['truncated'])
            self.assertEqual(len(result['entries']), 2000)

if __name__ == '__main__': unittest.main()

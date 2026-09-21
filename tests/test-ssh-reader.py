import json, pathlib, subprocess, tempfile, unittest
WORKER = pathlib.Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/src/commands/ssh/reader.py'

class RemoteReader(unittest.TestCase):
    def request(self, root, operation, path='.', **options):
        return subprocess.run(['python3', str(WORKER)], input=json.dumps(dict(root=str(root), operation=operation, path=path, **options)).encode(), capture_output=True, timeout=5)

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

    def test_delete_folder_is_confined_and_preserves_symlink_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / 'root'
            root.mkdir()
            outside = pathlib.Path(temporary) / 'outside'
            outside.mkdir()
            (outside / 'keep.txt').write_text('keep')
            (root / 'escape').symlink_to(outside)
            for path in ('.', './', '/', '../outside', 'escape', 'escape/subfolder'):
                result = self.request(root, 'delete-folder', path)
                self.assertNotEqual(result.returncode, 0, path)
            folder = root / "nested folder ' quoted"
            (folder / 'inner').mkdir(parents=True)
            (folder / 'inner/file.xyz').write_text('example')
            (folder / 'external').symlink_to(outside)
            result = self.request(root, 'delete-folder', folder.name)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {'deleted': folder.name})
            self.assertFalse(folder.exists())
            self.assertEqual((outside / 'keep.txt').read_text(), 'keep')
            self.assertTrue(root.exists())

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

    def test_chemical_discovery_and_auto_expansion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            for folder in ('science/deep', 'config', '.agents', 'node_modules'):
                (root / folder).mkdir(parents=True)
            (root / 'science/deep/water.xyz').write_text('3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0')
            (root / 'config/settings.json').write_text('{}')
            (root / 'config/table.csv').write_text('name,value\nfoo,1')
            (root / 'config/build.log').write_text('ordinary build log')
            (root / '.agents/fake.pdb').write_text('ATOM')
            (root / 'node_modules/fake.pdb').write_text('ATOM')
            extensions = ['xyz', 'pdb', 'csv', 'log']
            result = json.loads(self.request(root, 'discover', extensions=extensions).stdout)
            self.assertEqual([entry['name'] for entry in result['entries']], ['science'])
            self.assertEqual(result['expanded'], ['.', 'science', 'science/deep'])
            self.assertFalse(result['partial'])
            self.assertEqual(result['discovered'][-1]['entries'][0]['name'], 'water.xyz')
            (root / 'config/compounds.csv').write_text('smiles,name\nCCO,ethanol')
            result = json.loads(self.request(root, 'discover', 'config', extensions=extensions).stdout)
            self.assertEqual([entry['name'] for entry in result['entries']], ['compounds.csv'])

    def test_session_recovers_after_bad_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'water.xyz').write_bytes(b'3\nwater\n')
            requests = [dict(root=temporary, operation='read', path=path) for path in ('water.xyz', '../escape', 'water.xyz')]
            result = subprocess.run(['python3', str(WORKER), '--session'], input=('\n'.join(json.dumps(request) for request in requests) + '\n').encode(), capture_output=True, timeout=5)
            stream = result.stdout
            responses = []
            while stream:
                header, stream = stream.split(b'\n', 1)
                metadata = json.loads(header)
                payload, stream = stream[:metadata['length']], stream[metadata['length']:]
                responses.append((metadata['ok'], payload))
            self.assertEqual([ok for ok, _ in responses], [True, False, True])
            self.assertEqual(responses[0], responses[2])

if __name__ == '__main__': unittest.main()

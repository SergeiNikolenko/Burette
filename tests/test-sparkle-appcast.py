#!/usr/bin/env python3
import base64
import importlib.util
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('appcast', Path(__file__).resolve().parents[1] / 'scripts/sparkle-appcast.py')
appcast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appcast)
NS = {'s': appcast.NS}


def feed(version, previous=None, arm64=False):
    return appcast.make_feed({'CFBundleShortVersionString': version, 'CFBundleVersion': version,
                             'LSMinimumSystemVersion': '12.0'}, f'Burette-{version}.zip', 42,
                            'test-signature', previous, arm64)


class AppcastTests(unittest.TestCase):
    def test_optimized_signer_still_rejects_wrong_publisher(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / 'scripts/sparkle-appcast.py'
            script.parent.mkdir()
            shutil.copyfile(appcast.__file__, script)
            pinned = root / 'packages/burette/bin/release-signing-key.txt'
            pinned.parent.mkdir(parents=True)
            seed = bytes(range(32))
            public = subprocess.run(
                ['openssl', 'pkey', '-inform', 'DER', '-pubout', '-outform', 'DER'],
                input=bytes.fromhex('302e020100300506032b657004220420') + seed,
                check=True, capture_output=True).stdout[-32:]
            key = base64.b64encode(public).decode()
            info = dict(CFBundleIdentifier='com.local.BuretteV10', CFBundleShortVersionString='2.3.19',
                        SUPublicEDKey=key)
            app = root / 'Burette.app'
            (app / 'Contents').mkdir(parents=True)
            archive = root / 'Burette-2.3.19.zip'
            archive.write_bytes(b'fixture')
            for embedded, installer, message in [
                ('wrong', key, 'embedded in the app'), (key, 'wrong', 'pinned installer key')
            ]:
                info['SUPublicEDKey'] = embedded
                (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
                pinned.write_text(installer)
                result = subprocess.run(
                    [sys.executable, '-O', str(script), str(archive), str(app), str(root / 'feed.xml')],
                    env={**os.environ, 'BURETTE_SPARKLE_PRIVATE_KEY': base64.b64encode(seed).decode()},
                    capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertFalse(archive.with_suffix('.zip.ed25519').exists())

    def test_calendar_release_preserves_legacy_feed_and_download_identity(self):
        result = feed('2026.9.1', feed('2.3.22'))
        items = ET.fromstring(result).findall('channel/item')
        self.assertEqual([item.findtext('s:version', namespaces=NS) for item in items],
                         ['2026.9.1', '2.3.22'])
        self.assertEqual(items[0].findtext('title'), 'Burette 2026.9.1')
        self.assertEqual(items[0].findtext('s:shortVersionString', namespaces=NS), '2026.9.1')
        self.assertEqual(items[0].find('enclosure').get('url'),
                         'https://github.com/SergeiNikolenko/Burette/releases/download/v2026.9.1/Burette-2026.9.1.zip')
        self.assertIsNone(items[0].find('s:channel', NS))

    def test_enclosure_and_compatibility(self):
        item = ET.fromstring(feed('2.3.19', arm64=True)).find('channel/item')
        self.assertEqual(item.find('enclosure').attrib, {
            'url': 'https://github.com/SergeiNikolenko/Burette/releases/download/v2.3.19/Burette-2.3.19.zip',
            'length': '42', 'type': 'application/octet-stream',
            f'{{{appcast.NS}}}edSignature': 'test-signature',
        })
        self.assertEqual(item.findtext('s:minimumSystemVersion', namespaces=NS), '12.0')
        self.assertEqual(item.findtext('s:hardwareRequirements', namespaces=NS), 'arm64')
        self.assertIsNone(item.find('s:channel', NS))

    def test_deltas_point_at_the_release_assets(self):
        item = ET.fromstring(appcast.make_feed(
            {'CFBundleShortVersionString': '2026.10.14', 'CFBundleVersion': '2026.10.14', 'LSMinimumSystemVersion': '12.0'},
            'Burette-2026.10.14.zip', 42, 'zip-signature',
            deltas=[('2026.10.13', 'Burette-2026.10.14-from-2026.10.13.delta', 7, 'delta-signature')])).find('channel/item')
        self.assertEqual([patch.attrib for patch in item.find('s:deltas', NS)], [{
            'url': 'https://github.com/SergeiNikolenko/Burette/releases/download/v2026.10.14/Burette-2026.10.14-from-2026.10.13.delta',
            f'{{{appcast.NS}}}deltaFrom': '2026.10.13', 'length': '7', 'type': 'application/octet-stream',
            f'{{{appcast.NS}}}edSignature': 'delta-signature',
        }])
        self.assertIsNone(ET.fromstring(feed('2026.10.14')).find('channel/item/s:deltas', NS))

    def test_delta_sources_take_the_newest_other_builds(self):
        spec = importlib.util.spec_from_file_location('deltas', Path(__file__).resolve().parents[1] / 'scripts/sparkle-deltas.py')
        deltas = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(deltas)
        previous = None
        for index in range(8):
            previous = feed(f'2026.10.{index}', previous)
        self.assertEqual(deltas.delta_sources(feed('2026.10.7', previous), '2026.10.7'), [
            (f'2026.10.{index}', f'v2026.10.{index}', f'Burette-2026.10.{index}.zip') for index in (6, 5, 4, 3, 2)])

    def test_beta_releases_do_not_remove_the_last_stable_release(self):
        result = feed('2.3.19')
        for index in range(25):
            result = feed(f'2.4.0-beta.{index}', result)
        items = ET.fromstring(result).findall('channel/item')
        self.assertEqual(len(items), 11)
        stable = [item for item in items if item.find('s:channel', NS) is None]
        self.assertEqual([item.findtext('s:version', namespaces=NS) for item in stable], ['2.3.19'])
        self.assertTrue(all(item.findtext('s:channel', namespaces=NS) == 'beta' for item in items if item not in stable))

    def test_retry_replaces_the_same_version(self):
        result = feed('2.3.19', feed('2.3.19'))
        self.assertEqual(len(ET.fromstring(result).findall('channel/item')), 1)

    def test_rejects_malformed_previous_feed(self):
        with self.assertRaises(ET.ParseError):
            feed('2.3.19', b'<broken')
        with self.assertRaises(ValueError):
            feed('2.3.19', b'<html>not an update feed</html>')


if __name__ == '__main__':
    unittest.main()

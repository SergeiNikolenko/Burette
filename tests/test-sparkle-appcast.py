#!/usr/bin/env python3
import importlib.util
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

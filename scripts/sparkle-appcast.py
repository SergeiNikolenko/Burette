#!/usr/bin/env python3
"""Sign the final ZIP and produce a bounded stable/beta Sparkle feed."""
import base64
import datetime
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import xml.etree.ElementTree as ET

NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ET.register_namespace('sparkle', NS)


def make_feed(info, archive_name, size, signature, previous=None, arm64=False):
    version = info['CFBundleShortVersionString']
    build = info['CFBundleVersion']
    feed = ET.fromstring(previous) if previous else ET.Element('rss', version='2.0')
    if feed.tag != 'rss':
        raise ValueError('Previous update feed must be an RSS document')
    channel = feed.find('channel')
    if channel is None:
        channel = ET.SubElement(feed, 'channel')
        ET.SubElement(channel, 'title').text = 'Burette Updates'
    item = ET.Element('item')
    ET.SubElement(item, 'title').text = f'Burette {version}'
    ET.SubElement(item, f'{{{NS}}}version').text = build
    ET.SubElement(item, f'{{{NS}}}shortVersionString').text = version
    ET.SubElement(item, f'{{{NS}}}minimumSystemVersion').text = info['LSMinimumSystemVersion']
    if '-' in version:
        ET.SubElement(item, f'{{{NS}}}channel').text = 'beta'
    if arm64:
        ET.SubElement(item, f'{{{NS}}}hardwareRequirements').text = 'arm64'
    ET.SubElement(item, 'pubDate').text = datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
    ET.SubElement(item, 'link').text = f'https://github.com/SergeiNikolenko/Burette/releases/tag/v{version}'
    ET.SubElement(item, 'enclosure', {
        'url': f'https://github.com/SergeiNikolenko/Burette/releases/download/v{version}/{archive_name}',
        'length': str(size), 'type': 'application/octet-stream', f'{{{NS}}}edSignature': signature,
    })
    for old in list(channel.findall('item')):
        if old.findtext(f'{{{NS}}}version') == build:
            channel.remove(old)
    channel.insert(1, item)
    # Retain stable entries even during a long sequence of beta releases.
    for beta in (False, True):
        items = [entry for entry in channel.findall('item') if bool(entry.findtext(f'{{{NS}}}channel')) == beta]
        for old in items[10:]:
            channel.remove(old)
    return ET.tostring(feed, encoding='utf-8', xml_declaration=True)


def main():
    archive, app, output = map(Path, sys.argv[1:4])
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    assert info['CFBundleIdentifier'] == 'com.local.BuretteV10', 'Only canonical release bundles may enter the public feed'
    assert archive.name == f"Burette-{info['CFBundleShortVersionString']}.zip"
    key = os.environ['BURETTE_SPARKLE_PRIVATE_KEY'].strip()
    seed = base64.b64decode(key, validate=True)
    assert len(seed) == 32, 'Use the 32-byte seed exported by Sparkle 2.9.6 generate_keys'
    public = subprocess.run(['openssl', 'pkey', '-inform', 'DER', '-pubout', '-outform', 'DER'],
                            input=bytes.fromhex('302e020100300506032b657004220420') + seed,
                            check=True, capture_output=True).stdout[-32:]
    assert base64.b64encode(public).decode() == info['SUPublicEDKey'], 'Signing key does not match the key embedded in the app'
    signer = Path(__file__).resolve().parent.parent / 'build/sparkle/2.9.6/bin/sign_update'
    signature = subprocess.run([str(signer), '--ed-key-file', '-', '-p', str(archive)],
                               input=key + '\n', text=True, capture_output=True, check=True).stdout.strip()
    assert len(base64.b64decode(signature, validate=True)) == 64
    architectures = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS' / info['CFBundleExecutable'])], text=True).split()
    previous = None
    if len(sys.argv) > 4:
        previous_path = Path(sys.argv[4])
        assert previous_path.stat().st_size <= 262144, 'Existing appcast exceeds 256 KiB'
        previous = previous_path.read_bytes()
    output.write_bytes(make_feed(info, archive.name, archive.stat().st_size, signature, previous, architectures == ['arm64']))


if __name__ == '__main__':
    main()

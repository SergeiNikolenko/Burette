#!/usr/bin/env python3
"""Sign the final ZIP and produce a bounded stable/beta Sparkle feed.

Usage: sparkle-appcast.py <zip> <app> <output> [previous-feed] [--delta <patch>]... [--asset <dmg>]
Patches are named Burette-<version>-from-<build>.delta (see sparkle-deltas.py).
"""
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


def make_feed(info, archive_name, size, signature, previous=None, arm64=False, deltas=()):
    """deltas: (from_build, name, size, signature) for patches attached to this release."""
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
    if deltas:
        # Sparkle downloads the patch matching the installed build and falls
        # back to the full ZIP when none matches or the patch fails to apply.
        patches = ET.SubElement(item, f'{{{NS}}}deltas')
        for source, name, length, patch_signature in deltas:
            ET.SubElement(patches, 'enclosure', {
                'url': f'https://github.com/SergeiNikolenko/Burette/releases/download/v{version}/{name}',
                f'{{{NS}}}deltaFrom': source, 'length': str(length),
                'type': 'application/octet-stream', f'{{{NS}}}edSignature': patch_signature,
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


def sign(path, key):
    signer = Path(__file__).resolve().parent.parent / 'build/sparkle/2.10.0/bin/sign_update'
    signature = subprocess.run([str(signer), '--ed-key-file', '-', '-p', str(path)],
                               input=key + '\n', text=True, capture_output=True, check=True).stdout.strip()
    if len(base64.b64decode(signature, validate=True)) != 64:
        raise ValueError('Sparkle signer returned an invalid signature')
    return signature


def main():
    args, patches, assets = [], [], []
    argv = iter(sys.argv[1:])
    for arg in argv:
        if arg == '--delta':
            patches.append(Path(next(argv)))
        elif arg == '--asset':
            assets.append(Path(next(argv)))
        else:
            args.append(arg)
    archive, app, output = map(Path, args[:3])
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if info['CFBundleIdentifier'] != 'com.local.BuretteV10':
        raise ValueError('Only canonical release bundles may enter the public feed')
    if archive.name != f"Burette-{info['CFBundleShortVersionString']}.zip":
        raise ValueError('Archive name must match the release version')
    key = os.environ['BURETTE_SPARKLE_PRIVATE_KEY'].strip()
    seed = base64.b64decode(key, validate=True)
    if len(seed) != 32:
        raise ValueError('Use the 32-byte seed exported by Sparkle 2.10.0 generate_keys')
    public = subprocess.run(['openssl', 'pkey', '-inform', 'DER', '-pubout', '-outform', 'DER'],
                            input=bytes.fromhex('302e020100300506032b657004220420') + seed,
                            check=True, capture_output=True).stdout[-32:]
    if base64.b64encode(public).decode() != info['SUPublicEDKey']:
        raise ValueError('Signing key does not match the key embedded in the app')
    installer_key = (Path(__file__).resolve().parents[1] / 'packages/burette/bin/release-signing-key.txt').read_text().strip()
    if base64.b64encode(public).decode() != installer_key:
        raise ValueError('Signing key does not match the pinned installer key')
    signature = sign(archive, key)
    archive.with_name(archive.name + '.ed25519').write_text(signature + '\n')
    for asset in assets:
        if asset.name != f"Burette-{info['CFBundleShortVersionString']}.dmg":
            raise ValueError('Unexpected distribution asset name')
        asset.with_name(asset.name + '.ed25519').write_text(sign(asset, key) + '\n')
    prefix = f"Burette-{info['CFBundleShortVersionString']}-from-"
    deltas = []
    for patch in patches:
        if not patch.name.startswith(prefix) or patch.suffix != '.delta':
            raise ValueError(f'Unexpected delta name {patch.name}')
        deltas.append((patch.name[len(prefix):-len('.delta')], patch.name, patch.stat().st_size, sign(patch, key)))
    architectures = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS' / info['CFBundleExecutable'])], text=True).split()
    previous = None
    if len(args) > 3:
        previous_path = Path(args[3])
        if previous_path.stat().st_size > 262144:
            raise ValueError('Existing appcast exceeds 256 KiB')
        previous = previous_path.read_bytes()
    output.write_bytes(make_feed(info, archive.name, archive.stat().st_size, signature, previous,
                                 architectures == ['arm64'], deltas))


if __name__ == '__main__':
    main()

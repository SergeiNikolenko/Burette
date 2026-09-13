"""Prepare a signed, synthetic next version of an isolated app for native acceptance.

Usage: python3 tests/prepare-sparkle-native.py dev.app key.json output-directory
The key file contains private/public base64 strings and stays outside the HTTP root.
The server binds loopback only. Stop it with Ctrl-C after the manual native checks.
"""
import functools
import http.server
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import sys

source, key_path, output = (Path(value).resolve() for value in sys.argv[1:])
root = Path(__file__).resolve().parent.parent
info = plistlib.load((source / 'Contents/Info.plist').open('rb'))
if '.Dev.' not in info['CFBundleIdentifier']:
    raise ValueError('Native acceptance requires an isolated dev bundle')
key = json.loads(key_path.read_text())
if info['SUPublicEDKey'] != key['public']:
    raise ValueError('Fixture signing key does not match the built app')
output.mkdir(parents=True, exist_ok=False)
web = output / 'www'
web.mkdir()
installed = output / 'installed' / source.name
candidate = output / 'candidate' / source.name
for destination in (installed, candidate):
    subprocess.run(['ditto', str(source), str(destination)], check=True)
version = info['CFBundleShortVersionString'].split('.')
version[-1] = str(int(version[-1]) + 1)
next_version = '.'.join(version)
info.update(CFBundleShortVersionString=next_version, CFBundleVersion=next_version)
with (candidate / 'Contents/Info.plist').open('wb') as stream:
    plistlib.dump(info, stream)
(candidate / 'Contents/Resources/sparkle-acceptance.txt').write_text(next_version)
subprocess.run(['codesign', '--force', '--sign', '-', str(candidate)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(candidate)], check=True)
archive = web / f'Burette-{next_version}.zip'
subprocess.run(['ditto', '-c', '-k', '--keepParent', str(candidate), str(archive)], check=True)
signature = subprocess.run([str(root / 'build/sparkle/2.9.6/bin/sign_update'),
                            '--ed-key-file', '-', '-p', str(archive)],
                           input=key['private'] + '\n', text=True, capture_output=True, check=True).stdout.strip()
spec = importlib.util.spec_from_file_location('appcast', root / 'scripts/sparkle-appcast.py')
appcast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appcast)
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(web)))
url = f'http://127.0.0.1:{server.server_port}'
feed = appcast.ET.fromstring(appcast.make_feed(info, archive.name, archive.stat().st_size, signature, arm64=True))
enclosure = feed.find('channel/item/enclosure')
enclosure.set('url', url + '/' + archive.name)
(web / 'appcast.xml').write_bytes(appcast.ET.tostring(feed, encoding='utf-8', xml_declaration=True))
enclosure.set(f'{{{appcast.NS}}}edSignature', 'A' * 86 + '==')
(web / 'invalid-signature.xml').write_bytes(appcast.ET.tostring(feed, encoding='utf-8', xml_declaration=True))
state = {'installed': str(installed), 'expectedVersion': next_version,
         'feed': url + '/appcast.xml', 'invalidFeed': url + '/invalid-signature.xml',
         'syntheticNextVersion': True}
(output / 'acceptance.json').write_text(json.dumps(state, indent=2) + '\n')
print(json.dumps(state), flush=True)
server.serve_forever()

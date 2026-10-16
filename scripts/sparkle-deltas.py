#!/usr/bin/env python3
"""Build Sparkle delta patches from the newest feed entries to the new app.

Usage: sparkle-deltas.py <new.app> <version> <previous-appcast.xml> <work-dir>

The full release ZIP is about 190 MB, while consecutive releases differ by
about 20 MB. Every patch is optional: a failure only drops that patch, and
Sparkle installs the full ZIP instead. Prints one created patch path per line.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
REPO = 'SergeiNikolenko/Burette'
DELTA_SOURCES = 5
# Each BinaryDelta run holds both app trees in memory; the hosted macOS runner
# has 3 cores and 7 GB.
PARALLEL_DELTAS = 3
BINARY_DELTA = Path(__file__).resolve().parent.parent / 'build/sparkle/2.10.0/bin/BinaryDelta'


def delta_sources(previous, build):
    """Return (build, tag, archive) for the newest feed entries other than this build."""
    channel = ET.fromstring(previous).find('channel')
    sources = []
    for item in channel.findall('item') if channel is not None else []:
        source = item.findtext(f'{{{NS}}}version')
        enclosure = item.find('enclosure')
        if not source or source == build or enclosure is None:
            continue
        # https://github.com/<owner>/<repo>/releases/download/<tag>/<archive>
        tag, archive = enclosure.get('url', '').split('/')[-2:]
        sources.append((source, tag, archive))
    return sources[:DELTA_SOURCES]


def build_delta(app, version, work, source):
    build, tag, archive = source
    folder = work / f'from-{build}'
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.run(['gh', 'release', 'download', tag, '--repo', REPO, '--pattern', archive,
                    '--dir', str(folder), '--clobber'], check=True, capture_output=True)
    subprocess.run(['ditto', '-x', '-k', str(folder / archive), str(folder)], check=True, capture_output=True)
    patch = work / f'Burette-{version}-from-{build}.delta'
    subprocess.run([str(BINARY_DELTA), 'create', str(folder / 'Burette.app'), str(app), str(patch)],
                   check=True, capture_output=True)
    return patch


def main():
    app, version, previous, work = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
    try:
        sources = delta_sources(previous.read_bytes(), version)
    except (OSError, ET.ParseError) as error:
        print(f'warning: no delta updates, unreadable previous feed: {error}', file=sys.stderr)
        return
    if not sources:
        return
    with ThreadPoolExecutor(max_workers=min(len(sources), PARALLEL_DELTAS)) as pool:
        futures = [(source[0], pool.submit(build_delta, app, version, work, source)) for source in sources]
        for build, future in futures:
            try:
                print(future.result(), flush=True)
            except (OSError, subprocess.CalledProcessError) as error:
                detail = (getattr(error, 'stderr', None) or b'').decode(errors='replace')[-400:]
                print(f'warning: no delta update from {build}: {error} {detail}', file=sys.stderr)


if __name__ == '__main__':
    main()

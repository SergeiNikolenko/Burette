#!/usr/bin/env python3
"""Capture bounded, redacted local Burette logs without copying workspace data."""
import argparse
import collections
import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import unquote

NAMES = ('ActionJournal.1.jsonl', 'ActionJournal.jsonl', 'BuretteApp.log')
MAX_BYTES = 256 * 1024
MAX_LINES = 500
MAX_LINE = 2048


def redact(value):
    value = str(value)
    for _ in range(3):
        decoded = unquote(value)
        if decoded == value:
            break
        value = decoded
    value = re.sub(r'(?i)\b[a-z][a-z0-9+.-]*://[^\s<>"\']+', '[URL]', value)
    value = re.sub(r'(?i)\b(?:bearer|basic)\s+[^\s,;"\']+', '[CREDENTIAL]', value)
    value = re.sub(r'(?i)(["\']?(?:[\w-]*(?:token|password|secret|api_key|apikey|authorization|cookie)[\w-]*)["\']?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^\s,;}]+)', r'\1[REDACTED]', value)
    value = re.sub(r'(?i)(?:[a-z]:[\\/]|~/|/)[^\s<>"\']+', '[PATH]', value)
    value = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[IP]', value)
    value = re.sub(r'(?i)\b(?:smiles|molblock|sdf|coordinates|contents|sequence)\s*[:=].*', '[MOLECULAR DATA OMITTED]', value)
    return value[:MAX_LINE] + (' [TRUNCATED]' if len(value) > MAX_LINE else '')


def utc(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat()


def capture(source, output):
    # Exclusive directory creation prevents accidental overwrites of past evidence.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    summary = {'capturedAt': utc(dt.datetime.now().timestamp()),
               'limits': {'sourceBytes': MAX_BYTES, 'lines': MAX_LINES, 'lineChars': MAX_LINE},
               'sources': [], 'eventCounts': {}, 'recentErrors': []}
    counts = collections.Counter()
    for name in NAMES:
        record = {'name': name}
        summary['sources'].append(record)
        try:
            # Do not follow links or open a pipe/device planted in the cache.
            fd = os.open(source / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError('not a regular file')
                offset = max(0, info.st_size - MAX_BYTES)
                stream.seek(offset)
                data = stream.read(MAX_BYTES)
            if offset:
                data = data.partition(b'\n')[2]  # Never emit a partial first record.
            lines = data.decode('utf-8', errors='replace').splitlines()
            record.update(status='captured', sourceBytes=info.st_size,
                          modifiedAt=utc(info.st_mtime), readBytes=len(data),
                          truncated=bool(offset or len(lines) > MAX_LINES))
            rendered = []
            for line in lines[-MAX_LINES:]:
                if name.endswith('.jsonl'):
                    try:
                        entry = json.loads(line)
                    except (ValueError, RecursionError):
                        rendered.append('[INVALID JOURNAL RECORD OMITTED]')
                        continue
                    if not isinstance(entry, dict):
                        continue
                    # Details/targets can contain molecule payloads; allow only correlation metadata.
                    safe = {key: redact(entry[key]) for key in ('at', 'kind', 'action', 'scope', 'window')
                            if isinstance(entry.get(key), (str, int, float, bool))}
                    detail = entry.get('detail')
                    if isinstance(detail, dict):
                        safe_detail = {key: redact(detail[key]) for key in
                                       ('id', 'durableJobId', 'operation', 'status', 'error')
                                       if isinstance(detail.get(key), (str, int, float, bool))}
                        if safe_detail:
                            safe['detail'] = safe_detail
                    counts[safe.get('kind', 'unknown')] += 1
                    line = json.dumps(safe, ensure_ascii=True)
                else:
                    # Only application log records, never multiline payload continuations.
                    if not re.match(r'^\d{10,13} (?:error|warn|info|debug) |^\[|^\d{4}-\d{2}-\d{2}[T ]|^\{', line):
                        continue
                    line = redact(line)
                rendered.append(line)
                if re.search(r'(?i)\b(error|failed|failure|timeout|timed.out)\b', line):
                    summary['recentErrors'].append({'source': name, 'line': line[:512]})
                    summary['recentErrors'] = summary['recentErrors'][-20:]
            record['outputLines'] = len(rendered)
            record['truncated'] |= any('[TRUNCATED]' in line for line in rendered)
            (output / name).write_text('\n'.join(rendered) + '\n', encoding='utf-8')
        except FileNotFoundError:
            record['status'] = 'missing'
        except (OSError, ValueError) as error:
            record.update(status='unavailable', error=type(error).__name__)
    summary['eventCounts'] = dict(counts)
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    for path in output.iterdir():
        path.chmod(0o600)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New directory; parent must exist')
    parser.add_argument('--app-id', default='com.local.BuretteV10', help='Installed app identifier (including dev suffix)')
    args = parser.parse_args()
    if not re.fullmatch(r'com\.local\.BuretteV10(?:\.[A-Za-z0-9_-]+)*', args.app_id):
        parser.error('Invalid Burette app identifier')
    try:
        result = capture(Path.home() / 'Library/Caches' / args.app_id, args.output)
    except OSError as error:
        parser.exit(1, f'Capture failed: {type(error).__name__}; use a new directory with an existing parent.\n')
    print(json.dumps({'sources': result['sources'], 'eventCounts': result['eventCounts']}))


if __name__ == '__main__':
    main()

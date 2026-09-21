# Read-only remote worker. Requests arrive on stdin, never as shell arguments.
import json, os, stat, sys

MAX_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 2000

def main():
    request = json.loads(sys.stdin.buffer.read(16384))
    root = os.path.realpath(os.path.expanduser(request.get('root') or '~'))
    relative = request.get('path') or '.'
    if os.path.isabs(relative) or '..' in relative.split('/'):
        raise ValueError('Path is outside the project folder')
    parts = [part for part in relative.split('/') if part not in ('', '.')]
    # Walk by descriptors so a concurrently replaced parent cannot escape root.
    parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    for part in parts[:-1]:
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.close(parent)
        parent = child
    leaf = parts[-1] if parts else '.'
    path = os.path.join(root, *parts)
    if request['operation'] == 'list':
        entries = []
        truncated = False
        directory = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        with os.scandir(directory) as children:
            for scanned, entry in enumerate(children):
                if scanned >= MAX_ENTRIES:
                    truncated = True
                    break
                if entry.is_symlink():
                    continue
                info = entry.stat(follow_symlinks=False)
                if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                    continue
                entries.append(dict(name=entry.name, directory=stat.S_ISDIR(info.st_mode), size=info.st_size))
        entries.sort(key=lambda e: (not e['directory'], e['name'].lower()))
        print(json.dumps(dict(root=root, path=os.path.relpath(path, root), entries=entries, truncated=truncated)))
    elif request['operation'] == 'read':
        descriptor = os.open(leaf, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=parent)
        with os.fdopen(descriptor, 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
                raise ValueError('Preview requires a regular file up to 64 MiB')
            data = source.read(MAX_BYTES + 1)
            after = os.fstat(source.fileno())
            if len(data) > MAX_BYTES or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('File changed during download; try again')
            sys.stdout.buffer.write(data)
    else:
        raise ValueError('Unsupported operation')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

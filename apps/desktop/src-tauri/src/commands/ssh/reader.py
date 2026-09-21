# Remote file worker. Requests arrive on stdin, never as shell arguments.
import json, os, stat, sys, shutil, inspect, signal

MAX_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 2000

def walk_directory(directory, parts):
    current = os.dup(directory)
    try:
        for part in parts:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = child
        return current
    except BaseException:
        os.close(current)
        raise

def process_request(request):
    root = os.path.realpath(os.path.expanduser(request.get('root') or '~'))
    relative = request.get('path') or '.'
    if os.path.isabs(relative) or '..' in relative.split('/'):
        raise ValueError('Path is outside the project folder')
    parts = [part for part in relative.split('/') if part not in ('', '.')]
    # Walk by descriptors so a concurrently replaced parent cannot escape root.
    root_descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent = walk_directory(root_descriptor, parts[:-1])
    finally:
        os.close(root_descriptor)
    leaf = parts[-1] if parts else '.'
    path = os.path.join(root, *parts)
    try:
        if request['operation'] == 'delete-folder':
            if not parts:
                raise ValueError('The project root cannot be deleted')
            if not shutil.rmtree.avoids_symlink_attacks or 'dir_fd' not in inspect.signature(shutil.rmtree).parameters:
                raise ValueError('Safe folder deletion requires Python 3.11 or later on the server')
            if not stat.S_ISDIR(os.stat(leaf, dir_fd=parent, follow_symlinks=False).st_mode):
                raise ValueError('Only real folders can be deleted')
            def deadline(signum, frame):
                raise TimeoutError('Deletion stopped after 35 seconds; refresh to inspect remaining contents')
            previous_handler = signal.signal(signal.SIGALRM, deadline)
            signal.alarm(35)
            try:
                shutil.rmtree(leaf, dir_fd=parent)
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, previous_handler)
            return json.dumps(dict(deleted='/'.join(parts))).encode()
        if request['operation'] == 'discover':
            directory = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                return json.dumps(chemistry_tree(directory, root, os.path.relpath(path, root), request['extensions'])).encode()
            finally:
                os.close(directory)
        if request['operation'] == 'list':
            entries = []
            truncated = False
            directory = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
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
            finally:
                os.close(directory)
            entries.sort(key=lambda e: (not e['directory'], e['name'].lower()))
            return json.dumps(dict(root=root, path=os.path.relpath(path, root), entries=entries, truncated=truncated)).encode()
        if request['operation'] == 'read':
            descriptor = os.open(leaf, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=parent)
            with os.fdopen(descriptor, 'rb') as source:
                before = os.fstat(source.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
                    raise ValueError('Preview requires a regular file up to 64 MiB')
                data = source.read(MAX_BYTES + 1)
                after = os.fstat(source.fileno())
                if len(data) > MAX_BYTES or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError('File changed during download; try again')
                return data
        raise ValueError('Unsupported operation')
    finally:
        os.close(parent)

if 'chemistry_tree' not in globals():
    import chemistry
    chemistry.MAX_BYTES, chemistry.MAX_ENTRIES = MAX_BYTES, MAX_ENTRIES
    chemistry.os, chemistry.stat, chemistry.walk_directory = os, stat, walk_directory
    chemistry_tree = chemistry.chemistry_tree

if __name__ == '__main__':
    if '--session' in sys.argv:
        while True:
            line = sys.stdin.buffer.readline(16385)
            if not line:
                break
            if len(line) > 16384:
                sys.exit(1)
            try:
                data = process_request(json.loads(line))
                ok = True
            except Exception as error:
                data = str(error).encode()[:8192]
                ok = False
            sys.stdout.buffer.write(json.dumps(dict(ok=ok, length=len(data))).encode() + b'\n' + data)
            sys.stdout.buffer.flush()
    else:
        try:
            sys.stdout.buffer.write(process_request(json.loads(sys.stdin.buffer.read(16384))))
        except Exception as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)

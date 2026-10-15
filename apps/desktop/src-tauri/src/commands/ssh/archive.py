# Included in the shared SSH worker; standalone imports are used by reader.py.
import os, stat, tempfile, zipfile

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 10000

def download_archive(parent, leaf):
    directory = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    total = 0
    entries = 0
    try:
        with tempfile.TemporaryFile() as output:
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                def walk(folder, prefix, depth):
                    nonlocal total, entries
                    if depth > 64:
                        raise ValueError('Folder exceeds 64 nested levels')
                    before = os.fstat(folder)
                    with os.scandir(folder) as children:
                        for entry in children:
                            entries += 1
                            if entries > MAX_ARCHIVE_ENTRIES:
                                raise ValueError('Folder exceeds 10,000 entries')
                            if "\\" in entry.name:
                                raise ValueError("Folder contains a filename that cannot be safely archived")
                            name = prefix + entry.name
                            info = entry.stat(follow_symlinks=False)
                            if stat.S_ISDIR(info.st_mode):
                                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=folder)
                                try:
                                    archive.writestr(name + '/', b'')
                                    walk(child, name + '/', depth + 1)
                                finally:
                                    os.close(child)
                            elif stat.S_ISREG(info.st_mode):
                                descriptor = os.open(entry.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=folder)
                                with os.fdopen(descriptor, 'rb') as source:
                                    start = os.fstat(source.fileno())
                                    if not stat.S_ISREG(start.st_mode) or total + start.st_size > MAX_ARCHIVE_BYTES:
                                        raise ValueError('Folder exceeds 512 MiB')
                                    copied = 0
                                    with archive.open(name, 'w') as target:
                                        while True:
                                            chunk = source.read(1024 * 1024)
                                            if not chunk:
                                                break
                                            copied += len(chunk)
                                            total += len(chunk)
                                            if total > MAX_ARCHIVE_BYTES:
                                                raise ValueError('Folder exceeds 512 MiB')
                                            target.write(chunk)
                                    end = os.fstat(source.fileno())
                                    if copied != start.st_size or (start.st_size, start.st_mtime_ns) != (end.st_size, end.st_mtime_ns):
                                        raise ValueError('File changed during download; try again')
                            else:
                                raise ValueError('Folder contains a symbolic link or special file; choose a folder containing regular files')
                            if output.tell() > MAX_ARCHIVE_BYTES:
                                raise ValueError('Archive exceeds 512 MiB')
                    if os.fstat(folder).st_mtime_ns != before.st_mtime_ns:
                        raise ValueError('Folder changed during download; try again')
                walk(directory, '', 0)
            if output.tell() > MAX_ARCHIVE_BYTES:
                raise ValueError('Archive exceeds 512 MiB')
            output.seek(0)
            return output.read(MAX_ARCHIVE_BYTES + 1)
    finally:
        os.close(directory)

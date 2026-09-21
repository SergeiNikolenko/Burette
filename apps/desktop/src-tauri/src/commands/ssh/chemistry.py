# Bounded chemistry discovery. Supported extensions come from Burette's registry.
import csv, io, re, time
from collections import deque

SKIP_DIRECTORIES = {'node_modules', 'target', 'dist', 'build', '__pycache__', 'venv', 'venvs', 'envs', 'runtimes', 'site-packages'}
AMBIGUOUS = {'csv', 'tsv', 'xml', 'state', 'in', 'inp', 'out', 'log', 'com', 'data', 'dump', 'cfg', 'config', 'history', 'nc', 'netcdf', 'h5md', 'h5', 'pos', 'trj', 'rst'}

def chemical_file(directory, name, size, extensions, budget):
    lower = name.lower()
    extension = next((ext for ext in extensions if lower.endswith('.' + ext)), '')
    if not extension or size == 0 or size > MAX_BYTES:
        return False
    if extension not in AMBIGUOUS:
        return True
    if budget['sniff'] <= 0:
        budget['partial'] = True
        return None
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(descriptor, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            return False
        data = source.read(min(65536, budget['sniff']))
    budget['sniff'] -= len(data)
    text = data.decode('utf-8', errors='replace')
    if extension in ('csv', 'tsv'):
        rows = list(csv.reader(io.StringIO(text), delimiter='\t' if extension == 'tsv' else ','))[:26]
        if len(rows) < 2:
            return False
        columns = [i for i, value in enumerate(rows[0]) if re.fullmatch(r'(canonical[_ -]?smiles|isomeric[_ -]?smiles|smiles|inchi|molfile|mol[_ -]?block|structure)', value.strip(), re.I)]
        return any(i < len(row) and row[i].strip() for row in rows[1:] for i in columns)
    if extension in ('xml', 'state'):
        return bool(re.search(r'<(?:State|System)\b', text) and re.search(r'<(?:Positions|Particles)\b', text))
    if extension in ('data', 'dump', 'cfg', 'config', 'history', 'pos', 'trj', 'rst'):
        return bool(re.search(r'ITEM:\s+(?:TIMESTEP|ATOMS)|\b\d+\s+atoms\b|\b(?:ATOMIC_POSITIONS|Lattice|H0\(1,1\))\b', text))
    if extension in ('nc', 'netcdf', 'h5md', 'h5'):
        return (data.startswith(b'CDF') or data.startswith(b'\x89HDF')) and any(tag in data for tag in (b'coordinates', b'AMBER', b'h5md', b'particles'))
    # Generic source/log extensions require an actual quantum chemistry signature.
    return bool(re.search(r'\$molecule\b|\$DATA\b|\bATOMIC_POSITIONS\b|Standard orientation:|Input orientation:|ORCA.*?PROGRAM|\bNWChem\b|%block\s+AtomicCoordinates|^\s*#[pn]?\s+.*(?:hf|b3lyp|pm[367]|mp2|wb97)', text, re.I | re.M | re.S))

def chemistry_tree(directory, root, relative, extensions):
    budget = {'entries': 2000, 'sniff': 1024 * 1024, 'partial': False}
    deadline = time.monotonic() + 1.5
    queue = deque([(relative, [], 0)])
    records = {}
    hits = set()
    unresolved = set()
    while queue and len(records) < 64 and budget['entries'] > 0 and time.monotonic() < deadline:
        path, parts, depth = queue.popleft()
        fd = None
        try:
            fd = walk_directory(directory, parts)
            entries = []
            truncated = False
            with os.scandir(fd) as children:
                for index, entry in enumerate(children):
                    if index >= MAX_ENTRIES or budget['entries'] <= 0 or time.monotonic() >= deadline:
                        truncated = True
                        break
                    budget['entries'] -= 1
                    if entry.name.startswith('.') or entry.is_symlink():
                        continue
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        if entry.name not in SKIP_DIRECTORIES:
                            entries.append(dict(name=entry.name, directory=True, size=info.st_size))
                    elif stat.S_ISREG(info.st_mode):
                        match = chemical_file(fd, entry.name, info.st_size, extensions, budget)
                        if match:
                            entries.append(dict(name=entry.name, directory=False, size=info.st_size))
                        elif match is None:
                            truncated = True
            entries.sort(key=lambda e: (not e['directory'], e['name'].lower()))
            records[path] = dict(root=root, path=path, entries=entries, truncated=truncated)
            if any(not e['directory'] for e in entries):
                hits.add(path)  # Stop this branch at the first chemical files.
            else:
                for entry in entries:
                    child = entry['name'] if path == '.' else path + '/' + entry['name']
                    if depth < 12:
                        queue.append((child, parts + [entry['name']], depth + 1))
                    else:
                        unresolved.add(child)
            if truncated:
                unresolved.add(path)
        except OSError:
            unresolved.add(path)
        finally:
            if fd is not None:
                os.close(fd)
    unresolved.update(path for path, _, _ in queue)
    # Keep proven chemical branches and explicitly incomplete branches; never
    # present an unsearched directory as known to contain no chemistry.
    keep = hits | unresolved
    expanded = set()
    for path in list(keep):
        current = path
        while True:
            keep.add(current)
            if path in hits:
                expanded.add(current)
            if current == relative:
                break
            parent = current.rsplit('/', 1)[0] if '/' in current else '.'
            if parent == current:
                break
            current = parent
    for path, record in records.items():
        if path not in hits:
            record['entries'] = [entry for entry in record['entries'] if (entry['name'] if path == '.' else path + '/' + entry['name']) in keep]
    result = records.get(relative, dict(root=root, path=relative, entries=[], truncated=True))
    result['discovered'] = [record for path, record in records.items() if path != relative and path in keep]
    result['expanded'] = sorted(expanded)
    result['partial'] = bool(unresolved) or budget['partial']
    return result

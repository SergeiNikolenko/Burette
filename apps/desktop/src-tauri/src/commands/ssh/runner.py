# Remote job runner. Requests arrive on stdin as JSON, never as shell arguments.
import base64, glob, json, os, shutil, signal, subprocess, sys, time

TOOLS = ('xtb', 'crest', 'prism')
EXTRA_PATHS = ('~/.local/bin', '~/.pixi/bin', '~/miniforge3/bin', '~/mambaforge/bin', '~/miniconda3/bin', '~/anaconda3/bin', '/opt/conda/bin')
# Tools installed in pixi or conda environments that are not on PATH.
ENVIRONMENT_GLOBS = ('~/.pixi/envs/*/bin', '~/miniforge3/envs/*/bin', '~/mambaforge/envs/*/bin', '~/miniconda3/envs/*/bin', '~/micromamba/envs/*/bin', '~/work/Tools/*/*/.pixi/envs/*/bin')
MAX_UPLOAD = 24 * 1024 * 1024
LOG_TAIL = 64 * 1024
# A supervisor that stops writing heartbeats for this long is gone (host reboot, OOM kill).
STALE_SECONDS = 150

# Runs detached in its own session so the job survives the SSH connection closing.
SUPERVISOR = r'''
import json, os, re, signal, subprocess, sys, time
job = sys.argv[1]
def write(state, **extra):
    path = os.path.join(job, 'status.json')
    try:
        with open(path) as source:
            status = json.load(source)
    except (OSError, ValueError):
        status = {}
    status.update(extra, state=state, heartbeatAt=time.time())
    with open(path + '.tmp', 'w') as target:
        json.dump(status, target)
    os.replace(path + '.tmp', path)
def cancelled():
    return os.path.exists(os.path.join(job, 'cancel'))
def attempt(argv, log):
    try:
        child = subprocess.Popen(argv, cwd=os.path.join(job, 'work'), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, **spec['env']), start_new_session=True)
    except OSError as error:
        log.write(('%s\n' % error).encode())
        return 127
    started = time.time()
    write('running', pid=child.pid, startedAt=started)
    while True:
        remaining = spec['timeout'] - (time.time() - started)
        if remaining <= 0:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            except ProcessLookupError:
                pass
            return 124
        try:
            return child.wait(timeout=min(30, remaining))
        except subprocess.TimeoutExpired:
            write('running')
with open(os.path.join(job, 'job.json')) as source:
    spec = json.load(source)
log_path = os.path.join(job, 'run.log')
with open(log_path, 'ab') as log:
    code = attempt(spec['argv'], log)
retry = spec.get('retry')
if retry and code not in (124, 130) and not cancelled():
    with open(log_path, 'rb') as source:
        text = source.read().decode('utf-8', 'replace')
    if re.search(retry['pattern'], text):
        with open(log_path, 'ab') as log:
            log.write(('\n--- %s ---\n' % retry['label']).encode())
            log.flush()
            code = attempt(spec['argv'][:1] + retry['args'], log)
write('cancelled' if cancelled() else 'success' if code == 0 else 'failed', exitCode=code, finishedAt=time.time())
'''

def job_directory(request):
    root = os.path.realpath(os.path.expanduser(request.get('root') or '~/burette-jobs'))
    name = request.get('id') or ''
    if not name or len(name) > 128 or not all(c.isalnum() or c in '-_' for c in name):
        raise ValueError('Invalid job id')
    return root, os.path.join(root, name)

def resolve(tool):
    if tool not in TOOLS:
        raise ValueError('Unsupported tool')
    environments = sorted(path for pattern in ENVIRONMENT_GLOBS for path in glob.glob(os.path.expanduser(pattern)))
    search = os.pathsep.join([os.environ.get('PATH', '')] + [os.path.expanduser(path) for path in EXTRA_PATHS] + environments)
    found = shutil.which(tool, path=search)
    if not found:
        raise ValueError('%s is not installed on this host' % tool)
    return found

def read_status(job):
    with open(os.path.join(job, 'status.json')) as source:
        return json.load(source)

def write_status(job, status):
    path = os.path.join(job, 'status.json')
    with open(path + '.tmp', 'w') as target:
        json.dump(status, target)
    os.replace(path + '.tmp', path)

def submit(request):
    root, job = job_directory(request)
    os.makedirs(root, mode=0o700, exist_ok=True)
    os.mkdir(job, 0o700)
    work = os.path.join(job, 'work')
    os.mkdir(work, 0o700)
    total = 0
    for item in request['files']:
        name = item['name']
        if '/' in name or name in ('', '.', '..'):
            raise ValueError('Invalid input file name')
        data = base64.b64decode(item['data'])
        total += len(data)
        if total > MAX_UPLOAD:
            raise ValueError('Inputs exceed 24 MB')
        with open(os.path.join(work, name), 'xb') as target:
            target.write(data)
    argv = [resolve(request['tool'])] + [str(arg) for arg in request['args']]
    # Without an explicit count, stay modest on shared hosts.
    threads = str(max(1, min(int(request.get('threads') or 0) or min(os.cpu_count() or 1, 8), 256)))
    # Tools call siblings from their own environment, e.g. CREST runs xtb.
    path = os.pathsep.join([os.path.dirname(argv[0]), os.environ.get('PATH', '')])
    env = {'PATH': path, 'OMP_NUM_THREADS': threads, 'MKL_NUM_THREADS': threads, 'OMP_STACKSIZE': '1G', 'OMP_MAX_ACTIVE_LEVELS': '1'}
    spec = dict(argv=argv, env=env, timeout=max(5, min(int(request.get('timeout') or 3600), 30 * 86400)), retry=request.get('retry'), createdAt=time.time())
    with open(os.path.join(job, 'job.json'), 'w') as target:
        json.dump(spec, target)
    write_status(job, dict(state='queued', heartbeatAt=time.time()))
    subprocess.Popen([sys.executable, '-c', SUPERVISOR, job], cwd=job, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    return dict(state='queued', executable=argv[0])

def status(request):
    _, job = job_directory(request)
    current = read_status(job)
    if current.get('state') in ('queued', 'running') and time.time() - current.get('heartbeatAt', 0) > STALE_SECONDS:
        current['state'] = 'lost'
    tail = ''
    try:
        with open(os.path.join(job, 'run.log'), 'rb') as log:
            log.seek(max(0, os.fstat(log.fileno()).st_size - LOG_TAIL))
            tail = log.read(LOG_TAIL).decode('utf-8', 'replace')
    except FileNotFoundError:
        pass
    return dict(status=current, log=tail)

def cancel(request):
    _, job = job_directory(request)
    open(os.path.join(job, 'cancel'), 'w').close()
    current = read_status(job)
    pid = current.get('pid')
    if current.get('state') == 'running' and pid:
        try:
            os.killpg(pid, signal.SIGTERM)
            for _ in range(100):
                time.sleep(0.1)
                os.killpg(pid, 0)
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif current.get('state') in ('queued', 'lost'):
        current.update(state='cancelled', exitCode=130, finishedAt=time.time())
        write_status(job, current)
    return dict(cancelled=True)

try:
    request = json.loads(sys.stdin.read(40 * 1024 * 1024))
    handler = dict(submit=submit, status=status, cancel=cancel)[request['operation']]
    sys.stdout.write(json.dumps(handler(request)))
except Exception as error:
    sys.stdout.write(json.dumps(dict(error=str(error) or type(error).__name__)))

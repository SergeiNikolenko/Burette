import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Keep Python's scientific imports warm. Execute the installed CLI unchanged so
// every preset, surface and flag has the same semantics as a standalone render.
const workerScript = `
import contextlib, io, json, logging, sys
from xyzrender.cli import main
for line in sys.stdin:
    output = io.StringIO()
    try:
        sys.argv = ['xyzrender', *json.loads(line)]
        logging.getLogger('xyzrender').handlers.clear()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            main()
        result = {'stdout': output.getvalue()[-8000:], 'stderr': ''}
    except BaseException as error:
        result = {'error': str(error), 'stderr': output.getvalue()[-8000:]}
    print(json.dumps(result), flush=True)
`;

type Result = { stdout: string; stderr: string };
export function createXyzrenderWorker() {
  let child: ChildProcessWithoutNullStreams | null = null;
  let executablePath = '';
  let pending: { resolve: (value: Result) => void; reject: (error: Error) => void } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const stop = () => { const previous = child; child = null; previous?.kill(); pending?.reject(new Error('Render interrupted')); pending = null; };
  const run = (executable: string, args: string[], signal: AbortSignal): Promise<Result | null> => {
    const task = queue.then(async () => {
      signal.throwIfAborted();
      if (!child || executablePath !== executable) {
        stop();
        const interpreter = (await readFile(executable, 'utf8')).split('\n', 1)[0].match(/^#!(\/[^\r\n]+\/python[\d.]*)$/)?.[1];
        // Non-Python wrappers keep the normal executable path.
        if (!interpreter) return null;
        executablePath = executable;
        const process = spawn(interpreter, ['-u', '-c', workerScript], { stdio: 'pipe' });
        child = process;
        let stderr = '';
        process.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
        const lines = createInterface({ input: process.stdout });
        lines.on('line', line => {
          if (child !== process || !pending) return;
          const current = pending; pending = null;
          try {
            const result = JSON.parse(line);
            if (result.error != null) current.reject(new Error(result.stderr || result.error));
            else current.resolve(result);
          } catch { current.reject(new Error('Invalid renderer response')); }
        });
        const failed = (error: Error) => { if (child === process) { child = null; pending?.reject(error); pending = null; } };
        process.on('error', failed);
        process.on('exit', () => { lines.close(); failed(new Error(stderr || 'Renderer stopped')); });
      }
      return await new Promise<Result>((resolve, reject) => {
        const abort = () => stop();
        const timeout = setTimeout(stop, 25_000);
        const finish = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
        pending = { resolve: result => { finish(); resolve(result); }, reject: error => { finish(); reject(error); } };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else child!.stdin.write(JSON.stringify(args) + '\n');
      });
    });
    queue = task.catch(() => {});
    return task;
  };
  return { run, stop };
}

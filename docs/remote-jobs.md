# Remote compute jobs over SSH

Status: implemented for xTB (every operation, including MD and metadynamics),
CREST, and PRISM on plain SSH hosts. Slurm submission and an OpenMM/GROMACS MD
workflow are later stages. This extends the read-only SSH project support in
[ssh-projects.md](ssh-projects.md) so long calculations run on a configured
host, survive the Mac sleeping or Burette quitting, and are reattached later.

## Using it

The scene **Compute** menu shows **Run on** when Settings → Connections has at
least one enabled connection. The choice (This Mac or a connection) is stored in
`localStorage` under `burette.compute-host.v1` and applies to every xTB, CREST,
and PRISM run started from the scene, the inspector, or the command palette. A
disabled or deleted connection falls back to This Mac. The Jobs panel shows the
connection name next to a remote job; Cancel, Open result, Report, and Log work
the same as for local jobs.

## Remote layout

Each job gets one directory on the host:

```text
~/burette-jobs/<job-id>/
  job.json        # argv, environment (PATH, OMP_*), timeout, optional retry
  status.json     # {state, pid, exitCode, startedAt, finishedAt, heartbeatAt}
  run.log         # combined stdout/stderr of every attempt
  cancel          # marker written by a cancel request
  work/           # uploaded inputs and the tool's working directory
```

Job ids are validated on both sides and cannot leave the jobs root.

## Runner

`commands/ssh/runner.py` runs as `python3 -c` through the shared SSH transport
and receives one JSON command on stdin. Each request uses a separate SSH
connection with multiplexing explicitly disabled; this avoids macOS descriptor
handoff failures between the native subprocess pipes and a ControlMaster socket.
The shared transport still limits concurrent connections to three and does not
change the user's SSH configuration or replay a failed submission.

Worker operations:

- `submit` writes the uploaded files (base64, 24 MB in total) into `work/`,
  resolves the tool, writes `job.json`, and starts a detached supervisor with
  `start_new_session`. The supervisor runs the tool without a shell, rewrites
  `status.json` every 30 seconds as a heartbeat, enforces the timeout (exit code
  124), and records the exit code.
- `status` returns `status.json` and the last 64 KB of `run.log`. A running job
  whose heartbeat is older than 150 seconds is reported as `lost`.
- `cancel` writes the marker and sends SIGTERM to the process group, then
  SIGKILL after 10 seconds. Queued and lost jobs are marked `cancelled` at once.

Only `xtb`, `crest`, and `prism` can run. The runner looks for them on `PATH`,
in the usual user bin folders (`~/.local/bin`, `~/.pixi/bin`, conda bases), and
in pixi or conda environments (`~/.pixi/envs/*/bin`, `~/*conda*/envs/*/bin`,
`~/work/Tools/*/*/.pixi/envs/*/bin`). The tool's folder is put first on the
child's `PATH`, so CREST finds the `xtb` from the same environment. Threads
default to the host's CPU count, capped at 8.

A job may carry a retry: when the first attempt fails and its log matches the
retry pattern, the supervisor runs the retry arguments once in the same folder.
CREST uses this to repeat a run with `--legacy` when the built-in tblite
optimizer fails, as the conda-forge CREST 3.0.2 build does on some inputs.

## App side

- **Submit.** `run_xtb_job` and `run_conformer_job` accept `remoteHost`. They
  prepare the same local run folder as a local run, rewrite input paths relative
  to it (`stage_args`), upload it, and submit the same command line the local
  run would use.
- **Polling.** The job is polled every 15 seconds over a separate SSH
  connection. An SSH error records the job as `unreachable` and slows polling to
  60 seconds until the host answers again.
- **Results.** When the job ends, `work/` is downloaded with the existing
  archive download (512 MiB, 10,000 entries, no symbolic links), unpacked into
  the local run folder, and finished by the same code as a local run, so the
  result, report, and log have the same shape.
- **Store.** Unfinished jobs are kept in `remote-jobs.json` in the app data
  folder (200 records at most) and removed after their results are downloaded.
- **Reattach.** On launch, `remote_job_list` returns stored jobs that no window
  follows, and `remote_job_resume` follows one until it ends and returns the
  usual `XtbRunResult` or `ConformerRunResult`. The Jobs panel shows them as
  running again.
- **Cancel.** `cancel_xtb_job` and `cancel_conformer_job` cancel remote jobs on
  the host. If the host cannot be reached, the job is detached on this Mac and
  keeps running remotely.
- **Journal.** Job status changes in `ActionJournal.jsonl` include the host.

## Stages

1. Done: runner, xTB/CREST/PRISM submission, polling, results download,
   persistence and reattach, Run on in the Compute menu.
2. Slurm submission (`sbatch --parsable`, `squeue`/`sacct` in `status`).
3. OpenMM or GROMACS MD workflow with GPU host selection. Its trajectory opens
   as the existing topology + trajectory pair in the Mol* viewer.

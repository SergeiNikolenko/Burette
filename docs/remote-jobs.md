# Remote compute jobs over SSH (design)

Status: proposed. Nothing in this document is implemented yet. It extends the
read-only SSH project support described in [ssh-projects.md](ssh-projects.md)
so long calculations (molecular dynamics, CREST, xTB MD/metadynamics, batch
docking) can run on a configured SSH host, survive the Mac sleeping or Burette
quitting, and be reattached later.

## Goals

- Start a calculation on a remote host from the same places local jobs start
  (xTB, CREST/PRISM, and a new MD workflow), choosing **Run on → This Mac /
  `<ssh host>`**.
- Keep running when the app quits, the laptop sleeps, or the network drops.
- Show remote jobs in the Jobs panel next to local ones, with live status,
  log tail, cancel, and **Open results** that downloads the outputs.
- Reattach: after a restart, every remote job the app started is listed again
  and its state is refreshed from the host.

Out of scope for the first stages: schedulers other than plain processes and
Slurm, interactive terminals, uploading arbitrary folders, and editing remote
files.

## Building blocks that already exist

- `commands/ssh/transport.rs` runs the system `/usr/bin/ssh` with
  `BatchMode=yes`, `ConnectTimeout=10`, and `ControlMaster=auto` /
  `ControlPersist=60`, so repeated calls reuse one authenticated connection.
- `commands/ssh/mod.rs` executes a bundled Python worker as `python3 -c` and
  passes every path and argument as JSON on stdin, never through shell
  interpolation. Remote jobs reuse this pattern with a new `runner.py` worker.
- Hosts come from `~/.ssh/config` and Settings → Connections.
- `ssh_download` already fetches files and folder ZIPs with size, entry, and
  change checks; job outputs reuse it.
- Local jobs already write a run folder with a report, log, and
  `.burette-*-run.json` metadata, and `useJobLifecycle` journals every status
  change to `ActionJournal.jsonl`.

## Remote layout

Each job gets one directory on the host:

```text
~/burette-jobs/<job-id>/
  job.json        # request, tool, arguments, created time, Burette version
  input/          # uploaded input files
  work/           # tool working directory (outputs land here)
  run.log         # combined stdout/stderr
  pid             # process group id of the detached runner
  status.json     # {state, exitCode, startedAt, finishedAt, heartbeatAt}
```

The root is configurable per connection (default `~/burette-jobs`), so hosts
with a policy such as `~/work/Projects` or a scratch volume can point it there.

## Runner

`runner.py` receives a JSON command on stdin:

- `submit`: create the job directory, write uploaded inputs (base64, bounded
  like scene imports at 24 MB), write `job.json`, then start the tool with
  `setsid` + `nohup` so it leaves the SSH session's process group. The runner
  writes `status.json` with `running` and the process group id, and updates
  `heartbeatAt` every 30 seconds from a small supervising loop that also records
  the exit code when the tool ends.
- `status`: return `status.json`, the last 64 KB of `run.log`, and a bounded
  listing of `work/` (at most 2,000 entries, like `ssh_list`).
- `cancel`: send SIGTERM to the process group, then SIGKILL after 10 seconds,
  and mark the job `cancelled`.
- `list`: return the `job.json` + `status.json` pairs under the jobs root, so
  a fresh Burette install can rediscover jobs it did not start.

The command line is built by Burette in Rust from a typed request (tool,
method, charge, threads, temperature, time, solvent), exactly as
`conformer_args` and the xTB argument builders do today, and sent as a JSON
array. The runner calls `subprocess.Popen(argv)` without a shell. Tool
executables are resolved on the host from an allowlist (`xtb`, `crest`,
`prism`, `gmx`, `python3 -m openmm…`) with an optional per-connection override
path, mirroring the local runtime doctor.

A host that runs Slurm uses the same layout with `sbatch --parsable` instead of
`setsid`; `status` then also reads `squeue`/`sacct`. This is a second stage.

## App side

- **Store.** Remote jobs must outlive the window, so they go into a small
  SQLite table next to the compute coordinator database (`remote_jobs`: job id,
  connection, remote dir, tool, request JSON, last known status, timestamps).
  On launch the app loads it and refreshes every non-final job once.
- **Polling.** While a remote job is visible or running, poll `status` every
  15 seconds through the shared ControlMaster connection, backing off to
  60 seconds when the window is in the background. Network errors mark the job
  `unreachable` without changing its remote state; the next successful poll
  restores it.
- **Commands.** `remote_job_submit`, `remote_job_status`, `remote_job_cancel`,
  `remote_job_list`, and `remote_job_fetch` (downloads `work/` outputs through
  the existing archive download into the local run folder layout, then opens
  the primary result the same way local xTB/CREST results open).
- **Jobs panel.** Remote jobs show the host as a badge, the log tail, elapsed
  time from `startedAt`, **Cancel**, **Open results**, and **Reveal on host**
  (opens the job folder as an SSH project path).
- **Journal.** Submit, status changes, cancel, and fetch are journaled with the
  connection alias and remote job directory, never credentials.

## Molecular dynamics

xTB `md`/`metadyn` already exist locally and can be the first remote tools,
because their inputs and outputs (`xtb.trj`) are the same files the local flow
handles. A proper MD workflow (OpenMM or GROMACS: solvated box, minimization,
NVT/NPT equilibration, production, `.dcd`/`.xtc` trajectory) is a separate
stage. Its result opens as the existing topology + trajectory pair in the Mol*
viewer, so the trajectory toolbar works unchanged.

## Stages

1. `runner.py` with submit/status/cancel/list and Rust commands, xTB
   `md`/`metadyn` and CREST on a plain host, Jobs panel rows, persistence and
   reattach after restart.
2. Fetch and open results, log streaming in the job details view.
3. Slurm submission.
4. OpenMM MD workflow with GPU host selection.

Each stage stays under the repository's review-size limits and adds a contract
test for the runner JSON shapes alongside the existing SSH worker tests.

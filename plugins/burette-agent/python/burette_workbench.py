"""Burette workbench client for Python scripts and Jupyter notebooks.

The client speaks the ``burette-workbench-agent/v1`` protocol through the Burette
agent CLI (``burette-agent.mjs workbench``), the same typed and bounded route the
CLI and the MCP ``burette.control_viewer`` tool use. It needs only the Python
standard library and Node.js. It talks to a workspace that
``burette-agent.mjs open --mode browser-agent-shell`` started; it does not start a
server or hold credentials of its own.

Example (one notebook cell per step)::

    from burette_workbench import Workbench

    wb = Workbench("/tmp/burette-agent-shell-abc123")
    doc = wb.observe()
    doc["structure"]["formula"], doc["jobs"]["optimize"]

    atoms = list(wb.iter_atoms())          # pages of at most 100, pinned to one revision

    job = wb.run("optimize", {"method": "lbfgs", "constraints": [{"kind": "freeze", "atoms": [0]}]})
    job.summary["energy"], job.summary["constraintResiduals"]
    wb.export(job.job_id, "structure", output="optimized.sdf")["path"]

    for frame in wb.iter_frame_energy_forces("UFF"):   # every frame or SDF record, in batches
        frame["frameIndex"], frame["energy"], frame["forces"]

``pandas.DataFrame(wb.iter_atoms())`` turns the atoms into a table when pandas is
installed. Every failure raises :class:`WorkbenchError` with the protocol's error
code (for example ``REVISION_CONFLICT``, ``STALE_RESULT``, ``JOB_UNAVAILABLE`` or
``SOURCE_CLOSED``).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Literal, Mapping, Optional, Sequence

API_VERSION = "burette-workbench-agent/v1"
PAGE_SIZE = 100
TERMINAL_STATUSES = frozenset({"succeeded", "stale", "failed", "cancelled", "source_closed"})

JobKind = Literal[
    "properties", "energy", "energy_forces", "frame_energy_forces", "optimize",
    "prepare_3d", "conformers", "metadata_edit", "measurement_set", "coordinate_align",
    "pair_distribution", "point_group",
    "space_group", "powder_xrd", "crystal_transform", "orbital_cube",
    "insert_fragment", "hydrogens", "polymer",
]
# Kinds that build a new structure without a source document (operation ``build``).
BuildKind = Literal["smiles", "peptide", "metal_complex", "nucleic_acid"]


class WorkbenchError(RuntimeError):
    """A failed workbench operation, carrying the protocol error code and details."""

    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details


@dataclass(frozen=True)
class Job:
    """One workbench job as the workspace last reported it."""

    job_id: str
    operation_id: str
    kind: str
    status: str
    binding: str
    source_revision: Optional[str]
    document_id: Optional[str]
    params: Dict[str, Any]
    summary: Optional[Dict[str, Any]]
    artifacts: List[Dict[str, Any]]
    error: Optional[Dict[str, Any]]
    raw: Dict[str, Any] = field(repr=False)

    @property
    def done(self) -> bool:
        return self.status in TERMINAL_STATUSES

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "Job":
        return cls(
            job_id=payload["jobId"],
            operation_id=payload["operationId"],
            kind=payload["kind"],
            status=payload["status"],
            binding=payload["binding"],
            source_revision=payload["sourceRevision"],
            document_id=payload["documentId"],
            params=dict(payload.get("params") or {}),
            summary=payload.get("summary"),
            artifacts=list(payload.get("artifacts") or []),
            error=payload.get("error"),
            raw=dict(payload),
        )


def _default_cli() -> List[str]:
    node = os.environ.get("BURETTE_NODE") or shutil.which("node")
    if not node:
        raise WorkbenchError("CLI_UNAVAILABLE", "Node.js was not found. Set BURETTE_NODE or install node.")
    script = os.environ.get("BURETTE_AGENT_CLI")
    if not script:
        bundled = Path(__file__).resolve().parent.parent / "scripts" / "burette-agent.mjs"
        if not bundled.is_file():
            raise WorkbenchError("CLI_UNAVAILABLE", "burette-agent.mjs was not found. Set BURETTE_AGENT_CLI to its path.")
        script = str(bundled)
    return [node, script]


class Workbench:
    """Typed helpers over ``burette-agent.mjs workbench`` for one agent session."""

    def __init__(
        self,
        session_dir: str | os.PathLike[str],
        *,
        cli: Optional[Sequence[str]] = None,
        wait_ms: int = 15000,
        timeout: float = 120.0,
    ) -> None:
        self.session_dir = str(Path(session_dir).expanduser().resolve())
        self.cli = list(cli) if cli else _default_cli()
        self.wait_ms = wait_ms
        self.timeout = timeout

    # Transport -----------------------------------------------------------

    def request(self, operation: str, *, output: Optional[str | os.PathLike[str]] = None, overwrite: bool = False, **fields: Any) -> Dict[str, Any]:
        """Runs one operation and returns its result object."""
        body = {"operation": operation, **{key: value for key, value in fields.items() if value is not None}}
        command = [*self.cli, "workbench", "--session-dir", self.session_dir, "--stdin", "--wait-ms", str(self.wait_ms)]
        if output is not None:
            command += ["--output", str(Path(output).expanduser().resolve())]
        if overwrite:
            command.append("--overwrite")
        try:
            completed = subprocess.run(command, input=json.dumps(body), capture_output=True, text=True, timeout=self.timeout, check=False)
        except subprocess.TimeoutExpired as error:
            raise WorkbenchError("CLI_TIMEOUT", f"The Burette CLI did not answer within {self.timeout} s.") from error
        if completed.returncode != 0:
            try:
                error = json.loads(completed.stderr)["error"]
            except (ValueError, KeyError, TypeError):
                raise WorkbenchError("CLI_FAILED", (completed.stderr or completed.stdout).strip()[:2000] or f"exit status {completed.returncode}") from None
            raise WorkbenchError(error.get("code", "CLI_FAILED"), error.get("message", ""), error.get("details"))
        return json.loads(completed.stdout)["result"]

    # Reads ---------------------------------------------------------------

    def capabilities(self) -> Dict[str, Any]:
        return self.request("capabilities")

    def observe(self, document_id: Optional[str] = None) -> Dict[str, Any]:
        """Document identity, ``sourceRevision``, structure, frame and scientific summaries, job availability."""
        return self.request("observe", documentId=document_id)

    def atoms(self, offset: int = 0, limit: int = 50, *, frame_index: Optional[int] = None, document_id: Optional[str] = None, expected_source_revision: Optional[str] = None) -> Dict[str, Any]:
        return self.request("atoms", offset=offset, limit=limit, frameIndex=frame_index, documentId=document_id, expectedSourceRevision=expected_source_revision)

    def orbitals(self, offset: int = 0, limit: int = 50, *, document_id: Optional[str] = None, expected_source_revision: Optional[str] = None) -> Dict[str, Any]:
        return self.request("orbitals", offset=offset, limit=limit, documentId=document_id, expectedSourceRevision=expected_source_revision)

    def _iterate(self, operation: str, **fields: Any) -> Iterator[Dict[str, Any]]:
        # Every page after the first is pinned to the first page's revision, so an
        # edit while paging raises REVISION_CONFLICT instead of mixing two sources.
        offset = 0
        revision = fields.pop("expectedSourceRevision", None)
        while True:
            page = self.request(operation, offset=offset, limit=PAGE_SIZE, expectedSourceRevision=revision, **fields)
            revision = page["sourceRevision"]
            yield from page["items"]
            if page["nextOffset"] is None:
                return
            offset = page["nextOffset"]

    def iter_atoms(self, *, frame_index: Optional[int] = None, document_id: Optional[str] = None, expected_source_revision: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        return self._iterate("atoms", frameIndex=frame_index, documentId=document_id, expectedSourceRevision=expected_source_revision)

    def iter_orbitals(self, *, document_id: Optional[str] = None, expected_source_revision: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        return self._iterate("orbitals", documentId=document_id, expectedSourceRevision=expected_source_revision)

    # Jobs ----------------------------------------------------------------

    def submit(self, kind: JobKind, params: Optional[Mapping[str, Any]] = None, *, expected_source_revision: str, operation_id: Optional[str] = None, document_id: Optional[str] = None) -> Job:
        """Queues a job against the revision ``observe`` reported. Reusing ``operation_id`` returns the same job."""
        result = self.request(
            "submit",
            operationId=operation_id or f"py-{uuid.uuid4().hex}",
            job={"kind": kind, "params": dict(params or {})},
            expectedSourceRevision=expected_source_revision,
            documentId=document_id,
        )
        return Job.from_payload(result["job"])

    def status(self, job_id: str) -> Job:
        return Job.from_payload(self.request("status", jobId=job_id)["job"])

    def jobs(self, offset: int = 0, limit: int = 50) -> List[Job]:
        return [Job.from_payload(item) for item in self.request("jobs", offset=offset, limit=limit)["items"]]

    def cancel(self, job_id: str) -> Job:
        return Job.from_payload(self.request("cancel", jobId=job_id)["job"])

    def wait(self, job_id: str, *, timeout: float = 300.0, interval: float = 0.2) -> Job:
        """Polls ``status`` until the job finishes; raises ``WAIT_TIMEOUT`` after ``timeout`` seconds."""
        deadline = time.monotonic() + timeout
        while True:
            job = self.status(job_id)
            if job.done:
                return job
            if time.monotonic() >= deadline:
                raise WorkbenchError("WAIT_TIMEOUT", f"Job {job_id} is still {job.status} after {timeout} s.", job.raw)
            time.sleep(interval)

    def run(self, kind: JobKind, params: Optional[Mapping[str, Any]] = None, *, expected_source_revision: Optional[str] = None, operation_id: Optional[str] = None, document_id: Optional[str] = None, timeout: float = 300.0) -> Job:
        """Submits a job against the current (or given) revision and waits for it.

        Raises :class:`WorkbenchError` with the job's error code unless it succeeded.
        """
        revision = expected_source_revision or self.observe(document_id)["sourceRevision"]
        job = self.wait(self.submit(kind, params, expected_source_revision=revision, operation_id=operation_id, document_id=document_id).job_id, timeout=timeout)
        if job.status != "succeeded":
            error = job.error or {}
            raise WorkbenchError(error.get("code") or f"JOB_{job.status.upper()}", error.get("message") or f"Job {job.job_id} is {job.status}.", job.raw)
        return job

    def build(self, kind: BuildKind, params: Optional[Mapping[str, Any]] = None, *, operation_id: Optional[str] = None, timeout: float = 300.0) -> Job:
        """Builds a new structure that needs no open document and waits for it.

        The job has no source revision (``binding`` is ``none``); export its
        ``structure`` artifact and open the file explicitly.
        """
        result = self.request("build", operationId=operation_id or f"py-{uuid.uuid4().hex}", job={"kind": kind, "params": dict(params or {})})
        job = self.wait(result["job"]["jobId"], timeout=timeout)
        if job.status != "succeeded":
            error = job.error or {}
            raise WorkbenchError(error.get("code") or f"JOB_{job.status.upper()}", error.get("message") or f"Job {job.job_id} is {job.status}.", job.raw)
        return job

    def export(self, job_id: str, artifact: str, output: Optional[str | os.PathLike[str]] = None, *, overwrite: bool = False, allow_stale: bool = False) -> Dict[str, Any]:
        """Writes a job artifact to ``output`` (or the session folder) and returns its path, size and digest."""
        result = self.request("export", output=output, overwrite=overwrite, jobId=job_id, artifact=artifact, allowStale=allow_stale or None)
        return result["artifact"]

    # Batches ---------------------------------------------------------------

    def iter_frame_energy_forces(self, force_field: str = "MMFF94", *, batch_size: Optional[int] = None, offset: int = 0, document_id: Optional[str] = None, expected_source_revision: Optional[str] = None, operation_prefix: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        """Energies and forces of every trajectory frame or SDF record, one bounded job per batch.

        Yields ``{"frameIndex", "energy", "forces", "energyUnit", "forceUnit"}`` per frame.
        Every batch is pinned to the first revision, so an edit while iterating raises
        ``REVISION_CONFLICT``. Batch jobs use ``<operation_prefix>-<offset>`` operation ids,
        so rerunning an interrupted loop with the same prefix reuses finished batches.
        """
        revision = expected_source_revision or self.observe(document_id)["sourceRevision"]
        prefix = operation_prefix or f"py-frames-{uuid.uuid4().hex}"
        while offset is not None:
            params: Dict[str, Any] = {"forceField": force_field, "offset": offset}
            if batch_size is not None:
                params["count"] = batch_size
            job = self.run("frame_energy_forces", params, expected_source_revision=revision, operation_id=f"{prefix}-{offset}", document_id=document_id)
            exported = self.export(job.job_id, "forces", overwrite=True)
            batch = json.loads(Path(exported["path"]).read_text(encoding="utf-8"))
            for frame in batch["frames"]:
                yield {**frame, "energyUnit": batch["energyUnit"], "forceUnit": batch["forceUnit"]}
            offset = job.summary["nextOffset"]

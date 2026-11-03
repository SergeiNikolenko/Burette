import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateWorkbenchRequest } from "../scripts/workbench-agent-contract.mjs";
import { spectrumJob } from "../apps/desktop/src/lib/workbench/agent-spectrum-job";
import { createWorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import type { Snapshot } from "../apps/desktop/src/lib/workbench/agent-source";
import type { ScientificSpectrumRequest } from "../apps/desktop/src/lib/workbench/scientific-spectrum-task";

const request = (params: unknown) => validateWorkbenchRequest({ type: "workbench", operation: "submit", operationId: "spectrum", expectedSourceRevision: `sha256-${"a".repeat(64)}`, job: { kind: "spectrum", params } });
test("spectrum contract requires explicit kind and frame/element identities", () => {
  expect(request({ kind: "vcd" })).toMatchObject({ ok: true, request: { job: { params: { kind: "vcd", source: "file" } } } });
  for (const params of [{}, { kind: "IR" }, { kind: "nmr" }, { kind: "nmr", atomicNumber: 119 }, { kind: "dos", atomicNumber: 6 }, { kind: "vcd", source: "frame" }, { kind: "vcd", frameIndex: 0 }, { kind: "vcd", fwhm: 0 }, { kind: "vcd", scale: 0 }, { kind: "vcd", apply: true }]) expect(request(params).ok).toBe(false);
});

type Golden = ScientificSpectrumRequest & { name: string; rows: number[][] };
const golden: Golden[] = JSON.parse(readFileSync(new URL("./fixtures/quantum/scientific-spectra-golden.json", import.meta.url), "utf8"));
for (const reference of golden) test(`agent artifacts match independent C++ grid: ${reference.name}`, async () => {
  const snapshot = { scientific: { spectra: reference.data, frames: [] } } as unknown as Snapshot;
  const params = { ...reference.selection, source: "file" as const, ...reference.options };
  expect(spectrumJob.unavailable(snapshot)).toBeNull();
  expect(spectrumJob.paramsUnavailable!(snapshot, params)).toBeNull();
  const output = await spectrumJob.run(snapshot, params, {
    signal: new AbortController().signal, timeoutMs: 10000, stem: "reference",
    artifact: async (name, fileName, mimeType, content) => ({ name, fileName, mimeType, content, byteCount: new TextEncoder().encode(content).length, sha256: "fixture" }),
  });
  const artifacts = Object.fromEntries(output.artifacts.map(a => [a.name, a.content]));
  const rows = artifacts.display.trim().split("\n").slice(1).map(line => line.split(",").map(Number));
  expect(rows.length).toBe(reference.rows.length);
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < 3; j++) expect(Math.abs(rows[i][j] - reference.rows[i][j]) / Math.max(1, Math.abs(reference.rows[i][j]))).toBeLessThan(2e-6);
  expect(JSON.parse(artifacts.source)).toEqual(reference.data);
  expect(JSON.parse(artifacts.settings).parameters).toEqual(reference.options);
  expect(spectrumJob.paramsUnavailable!(snapshot, { ...params, source: "frame", frameIndex: 0 })).toContain("selected source");
  await expect(spectrumJob.run(snapshot, params, { signal: AbortSignal.abort(), timeoutMs: 10000, stem: "cancelled", artifact: async () => { throw new Error("must not publish"); } })).rejects.toThrow(/cancelled/);
});

test("real controller pins NMR jobs, replays operations and rejects stale export", async () => {
  let text = readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8");
  const document = { id: "nmr", title: "nmr.cjson", path: "/nmr.cjson", extension: "cjson", renderer: "molstar", byteCount: text.length } as any;
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document, readSource: async () => ({ text, origin: "file" }) });
  const ok = async (action: Record<string, unknown>): Promise<any> => { const r = await controller.execute({ type: "workbench", ...action }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.result; };
  try {
    const observed = await ok({ operation: "observe" });
    expect(observed.jobs.spectrum.available).toBe(true);
    const submit = { operation: "submit", operationId: "nmr-spectrum", expectedSourceRevision: observed.sourceRevision, job: { kind: "spectrum", params: { kind: "nmr", atomicNumber: 6 } } };
    const { job } = await ok(submit);
    expect((await ok(submit)).job.jobId).toBe(job.jobId);
    let status;
    for (let i = 0; i < 500; i++) { status = (await ok({ operation: "status", jobId: job.jobId })).job; if (!["queued", "running"].includes(status.status)) break; await Bun.sleep(10); }
    expect(status.status).toBe("succeeded");
    expect((await ok({ operation: "export", jobId: job.jobId, artifact: "display" })).artifact.content).toContain("position_ppm,smoothed,stick");
    text += "\n";
    expect(await controller.execute({ type: "workbench", operation: "export", jobId: job.jobId, artifact: "display" })).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
  } finally { controller.dispose(); }
});

test("frame and companion selections never fall back to file or neighbouring frames", () => {
  const data = golden.find(item => item.selection.kind === "mcd")!.data;
  const snapshot = { scientific: { spectra: data, frames: [{}, { spectra: data }, { mcdCompanion: { spectra: data } }] } } as unknown as Snapshot;
  expect(spectrumJob.paramsUnavailable!(snapshot, { kind: "mcd", source: "frame", frameIndex: 1 })).toBeNull();
  expect(spectrumJob.paramsUnavailable!(snapshot, { kind: "mcd", source: "companion", frameIndex: 2 })).toBeNull();
  for (const [source, frameIndex] of [["frame", 0], ["frame", 2], ["companion", 1], ["companion", 3]] as const) {
    expect(spectrumJob.paramsUnavailable!(snapshot, { kind: "mcd", source, frameIndex })).toContain("selected source");
  }
});

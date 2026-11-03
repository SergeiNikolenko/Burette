import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateWorkbenchRequest } from "../scripts/workbench-agent-contract.mjs";
import { vibrationalSpectrumJob } from "../apps/desktop/src/lib/workbench/agent-vibrational-spectrum-job";
import { createWorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { parseFchk } from "../apps/desktop/src/lib/molecular-workbench/fchk";
import type { Snapshot } from "../apps/desktop/src/lib/workbench/agent-source";

const text = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url), "utf8");
const science = parseFchk(text);
const snapshot = { scientific: science, document: { title: "water.fchk" } } as Snapshot;
const request = (params: unknown) => validateWorkbenchRequest({ type: "workbench", operation: "submit", operationId: "vibration", expectedSourceRevision: `sha256-${"a".repeat(64)}`, job: { kind: "vibrational_spectrum", params } });
test("vibrational contract rejects ambiguous source identities and invalid units", () => {
  expect(request({ kind: "ir" }).ok).toBe(true);
  for (const params of [{}, { kind: "vcd" }, { kind: "ir", source: "companion" }, { kind: "raman", source: "frame" }, { kind: "ir", frameIndex: 0 }, { kind: "ir", atomicNumber: 6 }, { kind: "ir", scale: 0 }, { kind: "ir", axisStartCm1: -1 }, { kind: "ir", fwhmCm1: 0 }]) expect(request(params).ok).toBe(false);
});
for (const kind of ["ir", "raman"] as const) test(`real FCHK ${kind} exports match independent double Gaussian`, async () => {
  const params = { kind, source: "frame" as const, frameIndex: 0 };
  expect(vibrationalSpectrumJob.paramsUnavailable!(snapshot, params)).toBeNull();
  const context = { signal: new AbortController().signal, timeoutMs: 10000, stem: "water", artifact: async (name: string, fileName: string, mimeType: string, content: string) => ({ name, fileName, mimeType, content, byteCount: content.length, sha256: "test" }) };
  const result = await vibrationalSpectrumJob.run(snapshot, params, context);
  const artifacts = Object.fromEntries(result.artifacts.map(a => [a.name, a.content]));
  const source = JSON.parse(artifacts.source);
  expect(source.modes.map((m: any) => m.frequencyCm1)).toEqual([2169.87538, 4141.29177, 4392.3985]);
  const settings = JSON.parse(artifacts.settings);
  expect(Math.max(settings.parameters.axisStartCm1, settings.parameters.axisEndCm1)).toBe(4500);
  const sigma = 30 / (2 * Math.sqrt(2 * Math.log(2)));
  let maxError = 0;
  for (const row of artifacts.display.trim().split("\n").slice(1)) {
    const [x, y] = row.split(",").map(Number);
    const sum = source.modes.reduce((sum: number, m: any) => sum + m[kind === "ir" ? "irIntensityKmMol" : "ramanActivityAngstrom4Amu"] * Math.exp(-((x - m.frequencyCm1) ** 2) / (2 * sigma * sigma)), 0);
    maxError = Math.max(maxError, Math.abs(y - (kind === "ir" ? 100 * (1 - sum / 125) : sum)));
  }
  expect(maxError).toBeLessThan(0.002);
  await expect(vibrationalSpectrumJob.run(snapshot, params, { ...context, signal: AbortSignal.abort() })).rejects.toThrow("cancelled");
});
test("missing Raman activity is refused, explicit zero retained, no frame fallback", () => {
  const params = { kind: "raman" as const, source: "frame" as const, frameIndex: 1 };
  expect(vibrationalSpectrumJob.paramsUnavailable!(snapshot, params)).toContain("no modes");
  const copy = structuredClone(snapshot);
  copy.scientific!.modes[0].ramanActivityAngstrom4Amu = undefined;
  expect(vibrationalSpectrumJob.paramsUnavailable!(copy, { kind: "raman", source: "file" })).toContain("not zero");
  copy.scientific!.modes[0].ramanActivityAngstrom4Amu = 0;
  expect(vibrationalSpectrumJob.paramsUnavailable!(copy, { kind: "raman", source: "file" })).toBeNull();
});

test("real controller pins vibrational jobs, replays operations and rejects stale export", async () => {
  let text = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url), "utf8");
  const document = { id: "nmr", title: "water.fchk", path: "/water.fchk", extension: "fchk", renderer: "molstar", byteCount: text.length } as any;
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [document], activeDocument: () => document, readSource: async () => ({ text, origin: "file" }) });
  const ok = async (action: Record<string, unknown>): Promise<any> => { const r = await controller.execute({ type: "workbench", ...action }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.result; };
  try {
    const observed = await ok({ operation: "observe" });
    expect(observed.jobs.vibrational_spectrum.available).toBe(true);
    const submit = { operation: "submit", operationId: "nmr-spectrum", expectedSourceRevision: observed.sourceRevision, job: { kind: "vibrational_spectrum", params: { kind: "ir", source: "frame", frameIndex: 0 } } };
    const { job } = await ok(submit);
    expect((await ok(submit)).job.jobId).toBe(job.jobId);
    let status;
    for (let i = 0; i < 500; i++) { status = (await ok({ operation: "status", jobId: job.jobId })).job; if (!["queued", "running"].includes(status.status)) break; await Bun.sleep(10); }
    expect(status.status).toBe("succeeded");
    expect((await ok({ operation: "export", jobId: job.jobId, artifact: "display" })).artifact.content).toContain("wavenumber_cm-1,smoothed,stick");
    text += "\n";
    expect(await controller.execute({ type: "workbench", operation: "export", jobId: job.jobId, artifact: "display" })).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
  } finally { controller.dispose(); }
});

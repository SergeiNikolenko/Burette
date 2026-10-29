import { afterAll, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { useWorkbenchSource, useCancellableJob } from "../apps/desktop/src/components/workbench/use-workbench-source";
import { adoptLogicalSource, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { readWorkbenchSource, workbenchSupportsDocument } from "../apps/desktop/src/lib/workbench/structure";
import { runChemistryTask } from "../apps/desktop/src/lib/molecular-workbench/compute-client";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" });
const globals = { window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true };
const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker")!, NativeWorker = Worker;
type HeldWorker = { worker: Worker; terminated: boolean; replies: (() => void)[] };
const workers: HeldWorker[] = []; let holdReplies = false;
// Only transport delivery is gated; each reply was produced by the actual worker/parser.
const GatedWorker = new Proxy(NativeWorker, { construct(Target, args) {
  const worker = new Target(...args as ConstructorParameters<typeof NativeWorker>), held: HeldWorker = { worker, terminated: false, replies: [] };
  workers.push(held);
  return new Proxy(worker, {
    set(target, key, value: unknown) {
      if (key === "onmessage" && typeof value === "function") {
        const receive = value as NonNullable<Worker["onmessage"]>;
        target.onmessage = event => { const deliver = () => receive.call(target, event); if (holdReplies) held.replies.push(deliver); else deliver(); };
        return true;
      }
      return Reflect.set(target, key, value);
    },
    get(target, key) {
      if (key === "terminate") return () => { held.terminated = true; return target.terminate(); };
      const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
} });
Object.defineProperty(globalThis, "Worker", { ...originalWorker, value: GatedWorker });
afterAll(async () => {
  for (const entry of workers) entry.worker.terminate();
  Object.defineProperty(globalThis, "Worker", originalWorker);
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await browser.happyDOM.close();
});
const scene = (id: string): ViewerDocument => ({ id, title: "water.molx", path: `/${id}.molx`, extension: "molx", renderer: "molstar", runtimePath: "/preview.html", byteCount: 0 });
const xyz = "3\nwater\nO 0 0 0\nH 0.95 0 0\nH -0.24 0.93 0\n", multi = xyz + xyz.replace("0.95", "0.97");
const adopt = (doc: ViewerDocument, text = multi) => adoptLogicalSource({ documentId: doc.id, extension: "xyz", text }, "same-document-uuid", null, ["O", "H", "H"]);
async function until(predicate: () => boolean) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await Bun.sleep(5); }); expect(predicate()).toBe(true); }
function mount(doc: ViewerDocument | null, graph = false) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let state: ReturnType<typeof useWorkbenchSource>, jobs: ReturnType<typeof useCancellableJob>;
  function Probe({ value }: { value: ViewerDocument | null }) { state = useWorkbenchSource(value, { graph }); jobs = useCancellableJob(state.revision); return null; }
  return { read: () => state!, jobs: () => jobs!, render: (value = doc) => act(async () => root.render(<Probe value={value} />)),
    close: async () => { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); holdReplies = false; } };
}

test("a late MOLX restore reads actual logical coordinates and chemistry without fetching the archive", async () => {
  const doc = scene("restored-reader"), view = mount(doc, true);
  try {
    expect(workbenchSupportsDocument(doc)).toBe(false); await view.render(); expect(view.read().loading).toBe(false);
    await expect(readWorkbenchSource(doc, xyz)).rejects.toThrow("no restored molecular source");
    await act(async () => adopt(doc, xyz)); await until(() => !view.read().loading);
    expect({ atoms: view.read().source!.atoms.length, graph: view.read().source!.graphFormat, error: view.read().error, graphError: view.read().structureError }).toEqual({ atoms: 3, graph: "xyz", error: null, graphError: null });
    expect((await runChemistryTask({ action: "properties", molecule: view.read().structure! })).formula).toBe("H2O");
    expect(workbenchSupportsDocument({ ...doc, id: "foreign-reader" })).toBe(false);
  } finally { await view.close(); }
});

test("source adapter retains single XYZ bytes, first trajectory frame and materialized CIF cell", async () => {
  const doc = { ...scene("source-formats"), extension: "xyz", title: "water.xyz" };
  const plain = await readWorkbenchSource(doc, xyz); expect(plain.graphText).toBe(xyz);
  const trajectory = await readWorkbenchSource(doc, multi); expect(trajectory.atoms).toEqual(plain.atoms); expect(trajectory.graphFormat).toBe("xyz");
  const cif = "data_p1\n_cell_length_a 4\n_cell_length_b 5\n_cell_length_c 6\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_IT_number 1\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC .25 .5 .75\n";
  const crystal = await readWorkbenchSource({ ...doc, extension: "cif" }, cif);
  expect(crystal.atoms[0].element).toBe("C"); [1, 2.5, 4.5].forEach((v, i) => expect([crystal.atoms[0].x, crystal.atoms[0].y, crystal.atoms[0].z][i]).toBeCloseTo(v, 12));
  expect(crystal.cell!.map(row => row.map(value => Math.round(value)))).toEqual([[4, 0, 0], [0, 5, 0], [0, 0, 6]]);
});

test("reader errors are source errors and clear when a valid logical revision replaces them", async () => {
  const doc = scene("reader-errors"), view = mount(doc); adopt(doc, multi.replace("0.95", "NaN"));
  try {
    await view.render(); await until(() => !view.read().loading); expect(view.read().error).toBeString();
    expect([view.read().source, view.read().structureError]).toEqual([null, null]);
    await act(async () => adopt(doc, xyz)); await until(() => Boolean(view.read().source)); expect(view.read().error).toBeNull();
  } finally { await view.close(); }
});

test("same-byte logical replacement owns a fresh read; a late old worker cannot replace the new result", async () => {
  const doc = scene("logical-owner"), view = mount(doc); adopt(doc); holdReplies = true;
  try {
    await view.render(); await until(() => Boolean(workers.at(-1)?.replies.length));
    const old = workers.at(-1)!, oldRevision = view.read().revision;
    await act(async () => adopt(doc)); expect(view.read().source).toBeNull(); expect(old.terminated).toBe(true);
    await until(() => workers.at(-1) !== old && Boolean(workers.at(-1)?.replies.length));
    const fresh = workers.at(-1)!; await act(async () => fresh.replies.shift()!());
    const accepted = view.read(); expect(accepted.revision).not.toBe(oldRevision); expect(accepted.source!.atoms).toHaveLength(3);
    await act(async () => old.replies.shift()!()); expect(view.read()).toBe(accepted);
  } finally { await view.close(); }
});

test("replacing a document object at the same id/path reloads it; close drops all pending replies", async () => {
  const doc = scene("reload-owner"), view = mount(doc); adopt(doc); holdReplies = true;
  try {
    await view.render(); await until(() => Boolean(workers.at(-1)?.replies.length)); const old = workers.at(-1)!;
    await view.render({ ...doc }); expect(view.read().source).toBeNull(); expect(old.terminated).toBe(true);
    await until(() => workers.at(-1) !== old && Boolean(workers.at(-1)?.replies.length)); const fresh = workers.at(-1)!;
    await view.render(null); expect(fresh.terminated).toBe(true);
    await act(async () => { old.replies.shift()!(); fresh.replies.shift()!(); });
    expect(view.read()).toMatchObject({ source: null, structure: null, loading: false, error: null, revision: null });
  } finally { await view.close(); }
});

test("a replaced logical source cancels chemical graph construction as well as the reader", async () => {
  const doc = scene("graph-owner"), view = mount(doc, true); adopt(doc, xyz); holdReplies = true;
  try {
    await view.render(); await until(() => Boolean(workers.at(-1)?.replies.length)); const old = workers.at(-1)!;
    await act(async () => adopt(doc, xyz.replace("0.95", "1.2"))); expect(old.terminated).toBe(true);
    await until(() => workers.at(-1) !== old && Boolean(workers.at(-1)?.replies.length));
    await act(async () => workers.at(-1)!.replies.shift()!()); const accepted = view.read();
    expect([accepted.source!.atoms[1].x, accepted.structure!.atoms.length, accepted.structureError]).toEqual([1.2, 3, null]);
    await act(async () => old.replies.shift()!()); expect(view.read()).toBe(accepted);
  } finally { await view.close(); }
});

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("a newer job keeps its busy/error state when a superseded job fails", async () => {
  const doc = scene("job-owner"), view = mount(doc); adopt(doc, xyz);
  try {
    await view.render(); await until(() => Boolean(view.read().source));
    const first = deferred<string>(), second = deferred<string>(); let pendingFirst!: Promise<string | null>, pendingSecond!: Promise<string | null>;
    await act(async () => { pendingFirst = view.jobs().run("old", () => first.promise); pendingSecond = view.jobs().run("new", () => second.promise); });
    await act(async () => { first.reject(new Error("old failure")); expect(await pendingFirst).toBeNull(); });
    expect([view.jobs().running, view.jobs().error]).toEqual(["new", null]);
    await act(async () => { second.resolve("accepted"); expect(await pendingSecond).toBe("accepted"); });
  } finally { await view.close(); }
});

test("same-byte logical replacement and close cancel a pending job owned by the previous source", async () => {
  const doc = scene("pending-job-owner"), view = mount(doc); adopt(doc, xyz);
  try {
    await view.render(); await until(() => Boolean(view.read().source));
    const held = deferred<string>(); let pending!: Promise<string | null>;
    await act(async () => { pending = view.jobs().run("owned", () => held.promise); });
    await act(async () => adopt(doc, xyz)); await act(async () => { held.resolve("stale"); expect(await pending).toBeNull(); });
    expect([view.jobs().running, view.jobs().error]).toEqual([null, null]);
    const closed = deferred<string>(); let closing!: Promise<string | null>;
    await act(async () => { closing = view.jobs().run("closing", () => closed.promise); });
    await view.render(null); await act(async () => { closed.resolve("closed"); expect(await closing).toBeNull(); });
  } finally { await view.close(); }
});

import { expect, mock, test } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";

let documents: ViewerDocument[] = [], calls = 0, aborts: string[] = [];
let open: () => Promise<unknown>;
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: Record<string, unknown>) => {
  if (command === "open_documents") { calls++; return open(); }
  if (command === "abort_open_document_claim") { aborts.push(String(args.claimId)); return; }
  throw new Error(`Unexpected native ${command}`);
} }));
mock.module("../apps/desktop/src/lib/native-menu", () => ({ currentDocumentRegistryRevision: () => 0 }));
mock.module("../apps/desktop/src/lib/perf-trace", () => ({ tracePerf() {} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({
  documents, replaceDocument: (id: string, replacement: ViewerDocument) => { documents = documents.map(doc => doc.id === id ? replacement : doc); },
}) } }));
const { prepareDeferredViewerRuntime } = await import("../apps/desktop/src/hooks/use-deferred-viewer-runtime");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  calls = 0; aborts = [];
  const cold = { id: "cold", path: "/a.molx", renderer: "molstar", runtimeDeferred: true, runtimePath: "" } as ViewerDocument;
  const adopted = { ...cold, runtimeDeferred: false, runtimePath: "/owned/runtime", openClaimId: "owned" };
  documents = [cold]; return { cold, adopted };
}

test("shared native materialization returns its exact adopted object to both callers", async () => {
  const { cold, adopted } = fixture(), entered = deferred<void>(), hold = deferred<unknown>();
  open = () => { entered.resolve(); return hold.promise; };
  const a = prepareDeferredViewerRuntime(cold, {} as never), b = prepareDeferredViewerRuntime(cold, {} as never);
  await entered.promise; hold.resolve({ documents: [adopted], errors: [] });
  expect(await a).toBe(adopted); expect(await b).toBe(adopted);
  expect(documents).toEqual([adopted]); expect(calls).toBe(1); expect(aborts).toEqual([]);
});

test("an invalidated native preparation cannot return a different same-id source and releases its claim", async () => {
  const { cold, adopted } = fixture(), entered = deferred<void>(), hold = deferred<unknown>();
  open = () => { entered.resolve(); return hold.promise; };
  const preparing = prepareDeferredViewerRuntime(cold, {} as never); void preparing.catch(() => {});
  await entered.promise;
  const unrelated = { ...adopted, runtimePath: "/unrelated/runtime", openClaimId: "other" };
  documents = [unrelated]; hold.resolve({ documents: [adopted], errors: [] });
  await expect(preparing).rejects.toThrow(/closed|changed/u);
  expect(documents[0]).toBe(unrelated); expect(aborts).toEqual(["owned"]);
});

test("closing during native preparation releases the unadopted result and never reports success", async () => {
  const { cold, adopted } = fixture(), entered = deferred<void>(), hold = deferred<unknown>();
  open = () => { entered.resolve(); return hold.promise; };
  const preparing = prepareDeferredViewerRuntime(cold, {} as never); void preparing.catch(() => {});
  await entered.promise; documents = []; hold.resolve({ documents: [adopted], errors: [] });
  await expect(preparing).rejects.toThrow(/closed|changed/u);
  expect(documents).toEqual([]); expect(aborts).toEqual(["owned"]);
});

import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { spectralDocument } from "./scientific-spectra-document-fixture";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await browser.happyDOM.close();
});
const { openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const baseline = useMoleculeStore.getState().documents;
afterEach(() => { useMoleculeStore.setState({ documents: baseline }); releaseClosedImports(new Set(baseline.map(doc => doc.id))); });

for (const layout of ["steps", "final"] as const) test(`normal scientific ${layout} open preserves file-scoped data and all source-frame spectra`, async () => {
  const { document } = spectralDocument();
  if (layout === "final") document.atoms = document.frames[1].atoms;
  const bytes = Uint8Array.of(239, 187, 191, 13, 10, 0, 255), original = { name: "source.out.gz", file: new Blob([bytes], { type: "application/gzip" }) };
  const opened: Array<{ document: ViewerDocument; text: string }> = [];
  const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => records.map(record => {
    const path = `/spectra-${layout}.xyz`, viewer: ViewerDocument = { id: `spectra-open-${layout}`, path, runtimePath: path, title: record.path,
      extension: "xyz", renderer: "molstar", byteCount: new TextEncoder().encode(record.text).length };
    opened.push({ document: viewer, text: record.text });
    useMoleculeStore.setState(state => ({ documents: [...state.documents, viewer] })); return viewer;
  }) };
  await openScientificDocument(actions, "source.out", document, layout, original);
  if (opened.length !== 1) throw new Error("Actual import did not open one document");
  const { document: viewer, text } = opened[0];
  const state = scientificStateFor(viewer.id, text), result = state.revision!.document;
  expect(result.spectra).toBe(document.spectra);
  expect(result.spectra!.source.scope).toBe("file");
  expect(result.frames).toBe(document.frames);
  expect(result.frames[1].spectra!.source).toMatchObject({ frameIndex: 1, frameCount: 2 });
  expect(result.frames[1].spectra!.spectra.map(signal => signal.kind)).toEqual(["vcd", "mcd", "nmr", "electronic", "ecd", "dos"]);
  expect(validateScientificDocument(result, readXyzFrames(text))).toBe(result);
  expect(state.original).toBe(original);
  expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(bytes);
});

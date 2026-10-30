import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { plugin as bunPlugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { BuretteGeometry } from "../scripts/molstar-geometry.js";

// The app's actual Compiler, source controller, iframe slots, receiver and model run
// together. Only file/HTML generation and camera capture are platform I/O fixtures.
const compiledPaths: string[] = [];
bunPlugin({ name: "topology-react-compiler", setup(build) {
  build.onLoad({ filter: /apps\/desktop\/src\/(components\/(geometry-panel|workbench\/zmatrix-panel|editor-area\/viewer-frame)\.tsx|hooks\/(use-geometry-binding|use-geometry-live-preview|use-source-editing)\.ts)$/u }, ({ path }) => {
    const tsx = path.endsWith(".tsx"), output = transformSync(readFileSync(path, "utf8"), { filename: path,
      babelrc: false, configFile: false, parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] },
      plugins: [["babel-plugin-react-compiler", {}]] });
    assert.ok(output?.code); if (path.endsWith("use-geometry-binding.ts") || path.endsWith("use-geometry-live-preview.ts")) assert.ok(output.code.includes("react/compiler-runtime"), `memoized ${path}`); compiledPaths.push(path);
    return { contents: output.code, loader: tsx ? "tsx" : "ts" };
  });
} });
const dom = new Window({ url: "http://localhost/" });
const page = dom.document as unknown as Document;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, self: dom, document: page, CSS: dom.CSS,
  Node: dom.Node, NodeFilter: dom.NodeFilter, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
  HTMLSelectElement: dom.HTMLSelectElement, HTMLFormElement: dom.HTMLFormElement, SVGElement: dom.SVGElement,
  DocumentFragment: dom.DocumentFragment, MutationObserver: dom.MutationObserver, Event: dom.Event,
  CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent,
  FocusEvent: dom.FocusEvent, navigator: dom.navigator, localStorage: dom.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => dom.setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (id: ReturnType<typeof dom.setTimeout>) => dom.clearTimeout(id), getComputedStyle: dom.getComputedStyle.bind(dom),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { test, mock, afterAll } = await import("bun:test");
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
const browser = await import("../apps/desktop/src/lib/browser-dev-documents");
const htmlText = new Map<string, string>();
let generated = 0;
const htmlFor = (text: string) => { const html = `<html><head></head><body>fixture-${++generated}</body></html>`; htmlText.set(html, text); return html; };
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browser,
  openBrowserDevTextDocument: async (title: string, extension: string, text: string, _preferences: unknown, _reload: unknown, id: string) =>
    ({ id, path: title, title, extension, renderer: "molstar", runtimePath: htmlFor(text) }),
}));
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path: string) => browser.readBrowserDevVirtualTextDocument(path),
  readStructureTextDocument: async (path: string) => ({ content: browser.readBrowserDevVirtualTextDocument(path), truncated: false }),
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/lib/viewer-view-capture", () => ({ captureViewerView: async () => null }));
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { ViewerFrame } = await import("../apps/desktop/src/components/editor-area/viewer-frame");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";

const zmat = "O\r\nX 1 1.0\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
const source = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const declaration = source.match(/\n  async function executeBuretteAgentAction\(action\) \{[\s\S]*?\n  \}/u)![0];
const globals = source.slice(source.indexOf("  let geometryPreviewRequest ="), source.indexOf(declaration));
const start = source.indexOf("  window.addEventListener('message', event => {", source.indexOf(declaration));
const end = source.indexOf("  window.BuretteViewerActions =", start);
const failure = source.match(/\n  function agentActionFailure\(command, code, message\) \{[\s\S]*?\n  \}/u)![0];
const actors = new Map<HTMLIFrameElement, { plugin: PluginContext; original: string; reads: number }>();
let heldRead: (() => void) | null = null, holdNextRead = false;
async function attach(frame: HTMLIFrameElement, text: string) {
  const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
  const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  const actor = { plugin, original: text, reads: 0 }; actors.set(frame, actor);
  type Message = { data: unknown; source: { postMessage: (value: unknown) => void } };
  let receive!: (event: Message) => void;
  const server = { molstar: { BuretteGeometry }, BuretteAgent: { run() { throw new Error("Unexpected SDK route"); } },
    addEventListener: (_name: string, callback: typeof receive) => { receive = callback; } };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/geometry-preview.js", import.meta.url), "utf8"), { window: server });
  const viewer = { plugin };
  new Function("window", "activeMolstarViewer", `${globals}\n${declaration}\n${failure}\n${source.slice(start, end)}`)(server, () => viewer);
  const frameWindow = frame.contentWindow!;
  Object.defineProperty(frameWindow, "postMessage", { configurable: true, value: (data: { source?: string; body?: { action?: { type: string } } }) => {
    if (data.source !== "burette-agent-host") return;
    const reading = data.body?.action?.type === "geometry_binding"; if (reading) actor.reads++;
    receive({ data, source: { postMessage: reply => {
      const deliver = () => dom.dispatchEvent(new dom.MessageEvent("message", { source: frameWindow as unknown as typeof dom, data: reply }));
      if (reading && holdNextRead) { holdNextRead = false; heldRead = deliver; } else deliver();
    } } });
  } });
  return actor;
}
const send: ShellActions["runStructureViewerAction"] = (document, action, options) => requestViewerAction(document.id, action, 1000, options?.signal, { target: options?.target });
let opened = 0;
const actions = {
  runStructureViewerAction: send,
  openStructureRecords: async (records) => records.map(record => {
    const id = `topology-${++opened}`, path = `burette-ketcher://${id}/${record.path}`;
    browser.writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, path, title: record.path, extension: record.inputExtension, renderer: "molstar", virtual: true, runtimePath: htmlFor(record.text) } as ViewerDocument;
    useMoleculeStore.setState(state => ({ documents: [...state.documents, document] })); return document;
  }),
} as ShellActions;
let controller!: ReturnType<typeof useSourceEditingController>;
const errors: unknown[] = [];
function Fixture({ document }: { document: ViewerDocument }) {
  controller = useSourceEditingController({ activeDocument: document, preferences: defaultPreferences,
    pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
  const session = controller.sessionForDocument(document);
  return <SourceEditingProvider value={controller}>
    <ViewerFrame document={document} sourcePreview={session?.sourcePreview ?? undefined} onStagingLoad={(identity, frame) => controller.stagingLoaded(document, identity, frame)} />
    <GeometryPanel document={document} actions={actions} />
  </SourceEditingProvider>;
}
const wait = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 150 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(predicate(), label);
};
const ready = (frame: HTMLIFrameElement, document: ViewerDocument) => dom.dispatchEvent(new dom.MessageEvent("message", {
  source: frame.contentWindow as unknown as typeof dom, data: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", documentId: document.id, molstarStructureCount: 1 } },
}));

test("own topology staging reads only its promoted frame, then topology Undo and Redo retain an editable Geometry model", async () => {
  await openScientificFiles(actions, [new File([zmat], "water.zmat")]);
  const document = useMoleculeStore.getState().documents.at(-1)!;
  assert.ok(document);
  const mount = page.createElement("div"); page.body.append(mount);
  const root = createRoot(mount);
  const active = () => mount.querySelector<HTMLIFrameElement>("iframe.viewer-iframe")!;
  const button = (label: string) => mount.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const field = () => mount.querySelector<HTMLElement>('[role="spinbutton"][aria-label="Variable R"]');
  const press = async (key: string) => {
    await act(async () => field()!.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key }) as unknown as Event));
    await act(async () => dom.dispatchEvent(new dom.KeyboardEvent("keyup", { key })));
  };
  const addAtom = async () => {
    await act(async () => button("Add").dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
    await wait(() => Boolean(page.querySelector('[role="menuitem"]')), "Add menu opens");
    await act(async () => [...page.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.trim() === "Add atom")!.click());
    await act(async () => page.querySelector<HTMLFormElement>('form[aria-label="New atom"]')!.requestSubmit());
  };
  const reload = async (count: number) => {
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "topology draft queued");
    await act(async () => controller.applyPreview(document));
    await wait(() => Boolean(mount.querySelector(".source-preview-staging-iframe")), "real ViewerFrame creates candidate");
    const frame = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    const text = htmlText.get(frame.getAttribute("srcdoc")!)!; assert.equal(Number(text.split(/\r?\n/u)[0]), count);
    await attach(frame, text);
    await act(async () => { frame.dispatchEvent(new dom.Event("load") as unknown as Event); ready(frame, document); });
    await wait(() => controller.sessionForDocument(document)?.previewState === "current", "controller acknowledges promotion");
    assert.equal(active() === frame, true, "the real promoted iframe owns the read");
    await wait(() => Boolean(field()) && !button("Undo").disabled, "promoted Geometry remains editable with Undo");
    assert.doesNotMatch(mount.textContent ?? "", /The scene changed\. Read the current source/u);
    assert.ok(actors.get(frame)!.reads > 0, "new unread model read the actual promoted MolStar source");
    return frame;
  };
  try {
    await act(async () => root.render(<Fixture document={document} />));
    const initialFrame = active();
    await attach(initialFrame, htmlText.get(initialFrame.getAttribute("srcdoc")!)!);
    await act(async () => ready(initialFrame, document));
    await wait(() => Boolean(field()) && !field()!.hasAttribute("disabled"), "initial no-session reader recovers on actual model ready");
    await press("ArrowUp"); await wait(() => !button("Undo").disabled, "R edit committed");
    assert.equal(field()!.getAttribute("aria-valuenow"), "0.9672");
    await act(async () => button("Undo").click()); await wait(() => field()!.getAttribute("aria-valuenow") === "0.9572", "R undo");
    await act(async () => button("Redo").click()); await wait(() => field()!.getAttribute("aria-valuenow") === "0.9672", "R redo");
    // An old frame response held across promotion cannot authorize the new model.
    holdNextRead = true;
    const oldRead = Promise.resolve(send(document, { type: "geometry_binding", label: "Geometry", notify: false }))
      .then(() => null, (error: unknown) => error);
    await wait(() => heldRead !== null, "old frame ACK held");
    await addAtom();
    const fourFrame = await reload(4);
    await act(async () => { heldRead!(); heldRead = null; });
    assert.equal((await oldRead as Error).message, "The viewer changed before the response arrived.", "late old frame read is rejected rather than rebound");
    assert.match(mount.textContent ?? "", /H4/u);
    assert.equal(Number(BuretteGeometry.binding(actors.get(fourFrame)!.plugin).text.split("\n")[0]), 4);
    await act(async () => button("Undo").click()); const threeFrame = await reload(3);
    await act(async () => button("Redo").click()); const redoFrame = await reload(4);
    assert.notEqual(threeFrame, redoFrame); assert.equal(field()!.getAttribute("aria-valuenow"), "0.9672");
    await press("ArrowUp");
    await wait(() => field()!.getAttribute("aria-valuenow") === "0.9772" && !button("Undo").disabled, "new model accepts coordinate edits");
    const beforeFailure = controller.sessionForDocument(document)!.content;
    await addAtom();
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "second topology draft queued");
    await act(async () => controller.applyPreview(document));
    const failed = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    assert.ok(failed);
    await attach(failed, htmlText.get(failed.getAttribute("srcdoc")!)!);
    await act(async () => {
      failed.dispatchEvent(new dom.Event("load") as unknown as Event);
      dom.dispatchEvent(new dom.MessageEvent("message", { source: failed.contentWindow as unknown as typeof dom,
        data: { source: "burette-viewer", body: { type: "error", message: "Rejected candidate fixture" } } }));
    });
    await wait(() => controller.sessionForDocument(document)?.previewState === "current" && !button("Undo").disabled, "failed reload restores editable prior model");
    assert.equal(controller.sessionForDocument(document)!.content, beforeFailure);
    assert.equal(active() === redoFrame, true, "failed candidate never replaces the admitted frame");
    assert.equal(BuretteGeometry.binding(actors.get(redoFrame)!.plugin).text, beforeFailure);
    assert.equal(errors.length, 0);
    assert.ok(compiledPaths.some(path => path.endsWith("use-source-editing.ts")));
    assert.ok(compiledPaths.some(path => path.endsWith("viewer-frame.tsx")));
  } finally {
    await act(async () => root.unmount()); mount.remove();
    for (const actor of actors.values()) actor.plugin.dispose(); actors.clear();
  }
}, 20_000);

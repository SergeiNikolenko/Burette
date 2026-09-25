import { writeClipboardText } from "./clipboard";

// Annotate mode: the user marks a screen rectangle, writes a comment, and the
// batch is delivered to the agent. Viewer iframes answer `describe_region`
// (Mol* atoms and residues, xyzrender atoms, grid rows, or text) and select
// what the Mol* region covers; anything outside an iframe is read from the DOM.
// Every field that reaches the agent is bounded here.

export type RegionRect = { left: number; top: number; width: number; height: number };

export type RegionGranularity = "atom" | "residue";

type Residue = { chain: string; sequence: number | null; compId: string };

export type RegionTarget = {
  surface: "molstar" | "xyzrender" | "grid" | "document";
  atomCount?: number;
  atomIdentities?: (Residue & { atomName: string; atomIndex: number })[];
  residues?: Residue[];
  structures?: { label: string; atomCount: number; atoms: string | null }[];
  rowCount?: number;
  sourceIndexes?: number[];
  text?: string;
  // Element box a click snapped to (page pixels); layout only, never sent.
  box?: RegionRect;
};

export type Annotation = { id: number; rect: RegionRect; pin: { x: number; y: number }; comment: string; target: RegionTarget | null };

const REGION_TIMEOUT_MS = 8000;
const MAX_TEXT = 1200;

function topElementAt(layer: HTMLElement, x: number, y: number) {
  return document.elementsFromPoint(x, y).find((element) => !layer.contains(element)) ?? null;
}

// A click (no drag) on ordinary DOM content annotates the element under the
// pointer, like the browser annotate tool; canvases and viewer frames keep the
// small click square and let the viewer pick.
export function clickTargetBox(layer: HTMLElement, x: number, y: number): RegionRect | null {
  const element = topElementAt(layer, x, y);
  if (!element || element instanceof HTMLIFrameElement || element instanceof HTMLCanvasElement) return null;
  const rect = element.getBoundingClientRect();
  const bounds = layer.getBoundingClientRect();
  if (rect.width * rect.height > bounds.width * bounds.height * 0.4) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

// Menus, toolbars and other controls keep working in annotate mode: only the
// scene and plain content take annotations.
const CONTROL = "button, a[href], input, select, textarea, summary, label, [contenteditable='true'], [role=button], [role=menu], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=listbox], [role=option], [role=tab], [role=slider], [role=checkbox], [role=switch], [role=spinbutton], [role=combobox], [role=toolbar], [role=dialog]";

function isControl(element: Element | null) {
  return Boolean(element && !(element instanceof HTMLCanvasElement) && element.closest(CONTROL));
}

export function controlAt(layer: HTMLElement, x: number, y: number) {
  const element = topElementAt(layer, x, y);
  if (!(element instanceof HTMLIFrameElement)) return isControl(element);
  let inner: Document | null = null;
  try { inner = element.contentDocument; } catch { /* cross-origin frames stay annotatable */ }
  const frameRect = element.getBoundingClientRect();
  return Boolean(inner && isControl(inner.elementFromPoint(x - frameRect.left, y - frameRect.top)));
}

function viewerFrames() {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe"));
}

function frameAction<T>(frame: HTMLIFrameElement, action: Record<string, unknown>): Promise<T | null> {
  const target = frame.contentWindow;
  if (!target) return Promise.resolve(null);
  const id = `annotate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const finish = (result: T | null) => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      const body = event.data?.body;
      if (event.source !== target || event.data?.source !== "burette-agent-viewer" || body?.type !== "agent-action-result" || body.id !== id) return;
      finish(body.result?.ok !== false && body.result?.result ? body.result.result : null);
    };
    const timeout = window.setTimeout(() => finish(null), REGION_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    target.postMessage({ source: "burette-agent-host", body: { type: "agent-action", id, action } }, "*");
  });
}

async function describeFrameRegion(frame: HTMLIFrameElement, rect: RegionRect, granularity: RegionGranularity): Promise<RegionTarget | null> {
  const frameRect = frame.getBoundingClientRect();
  const result = await frameAction<RegionTarget>(frame, {
    type: "describe_region", granularity, select: true,
    rect: { left: rect.left - frameRect.left, top: rect.top - frameRect.top, width: rect.width, height: rect.height },
  });
  const box = result?.box;
  return result && box ? { ...result, box: { ...box, left: box.left + frameRect.left, top: box.top + frameRect.top } } : result;
}

// The selection annotate mode added in Mol* goes when the batch is sent or
// cancelled.
export function clearRegionSelection(annotations: Annotation[]) {
  if (!annotations.some((annotation) => annotation.target?.surface === "molstar")) return;
  for (const frame of viewerFrames()) void frameAction(frame, { type: "clear_selection" });
}

// One frame of the Mol* view with every mark numbered on it.
export async function captureAnnotatedView(annotations: Annotation[]) {
  const first = annotations.find((annotation) => annotation.target?.surface === "molstar");
  const frame = first && viewerFrames().find((candidate) => {
    const r = candidate.getBoundingClientRect();
    const x = first.rect.left + first.rect.width / 2, y = first.rect.top + first.rect.height / 2;
    return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (!frame) return null;
  const frameRect = frame.getBoundingClientRect();
  const marks = annotations.map(({ rect, pin }, index) => ({ index: index + 1,
    left: rect.left - frameRect.left, top: rect.top - frameRect.top, width: rect.width, height: rect.height,
    pinX: pin.x - frameRect.left, pinY: pin.y - frameRect.top }));
  const shot = await frameAction<{ dataUri: string; mimeType: string }>(frame, { type: "annotation_snapshot", marks });
  return shot?.dataUri ? { data: shot.dataUri.replace(/^data:[^,]*,/, ""), mimeType: shot.mimeType } : null;
}

function documentText(layer: HTMLElement, rect: RegionRect) {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let text = "";
  for (let node = walker.nextNode(); node && text.length < MAX_TEXT; node = walker.nextNode()) {
    if (!node.nodeValue?.trim() || layer.contains(node)) continue;
    range.selectNodeContents(node);
    if (Array.from(range.getClientRects()).some((r) => r.right >= rect.left && r.left <= right && r.bottom >= rect.top && r.top <= bottom)) {
      text += `${node.nodeValue.trim()} `;
    }
  }
  return text.trim().slice(0, MAX_TEXT);
}

export async function describeRegion(layer: HTMLElement, rect: RegionRect, granularity: RegionGranularity): Promise<RegionTarget | null> {
  const element = topElementAt(layer, rect.left + rect.width / 2, rect.top + rect.height / 2);
  // Only viewer runtimes answer; sandboxed document frames would just time out.
  if (element instanceof HTMLIFrameElement) return element.matches(".viewer-iframe") ? describeFrameRegion(element, rect, granularity) : null;
  const text = documentText(layer, rect);
  return text ? { surface: "document", text } : null;
}

function residueList(residues: Residue[]) {
  const labels = [...new Set(residues.map((residue) => `${residue.chain ? `${residue.chain}:` : ""}${residue.compId}${residue.sequence ?? ""}`))];
  return labels.length > 12 ? `${labels.slice(0, 12).join(", ")} and ${labels.length - 12} more` : labels.join(", ");
}

function describeTarget(target: RegionTarget | null) {
  if (!target) return "Region in the viewer; its contents could not be read.";
  switch (target.surface) {
    case "molstar":
      if (!target.atomCount) return "Mol*: empty space, no atom centres in the region.";
      // A handful of atoms (typically a click) is named atom by atom.
      if (target.atomCount <= 8 && target.atomIdentities?.length === target.atomCount) {
        return `Mol*: ${target.atomIdentities.map((atom) => `${residueList([atom])} ${atom.atomName} (atom index ${atom.atomIndex})`).join(", ")}.`;
      }
      return `Mol*: ${target.atomCount} atoms in the region${target.residues?.length ? ` (residues ${residueList(target.residues)})` : ""}.`;
    case "xyzrender":
      return target.structures?.length
        ? `xyzrender: ${target.structures.map((item) => `${item.label} atom${item.atomCount === 1 ? "" : "s"} ${item.atoms} (1-based)`).join("; ")}.`
        : "xyzrender: no atoms in the region.";
    case "grid":
      return `Grid: ${target.rowCount} row${target.rowCount === 1 ? "" : "s"}, source indexes (zero-based) ${target.sourceIndexes?.join(", ")}.`;
    case "document":
      return `Text: "${target.text}"`;
  }
}

export function annotationText(documentTitle: string, annotations: Annotation[]) {
  const lines = annotations.map((annotation, index) =>
    `${index + 1}. ${annotation.comment}\n   → ${describeTarget(annotation.target)}`);
  return `Burette annotations on ${documentTitle}:\n\n${lines.join("\n")}`;
}

// The batch's composer card: the readable list plus the structured targets.
export function annotationContext(documentTitle: string, annotations: Annotation[]) {
  const items = annotations.map(({ comment, target }, index) => {
    const { box: _box, ...rest } = target ?? { surface: "document" as const };
    return { index: index + 1, comment, target: rest };
  });
  const count = annotations.length;
  return {
    content: [{ type: "text" as const, text: annotationText(documentTitle, annotations) }],
    structuredContent: { burette: { annotations: { document: documentTitle, items } } },
    presentation: { composerAttachmentLayout: "card" as const, composerLabel: `Burette · ${count} annotation${count === 1 ? "" : "s"} · ${documentTitle}` },
  };
}

// The Codex native widget posts the batch into the chat as one message; every
// other surface (desktop, browser shell) has no chat, so Send copies it.
export async function deliverAnnotations(documentTitle: string, annotations: Annotation[]): Promise<"sent" | "copied"> {
  const text = annotationText(documentTitle, annotations);
  const workspace = window.BuretteMcpWorkspace;
  if (!workspace?.sendAnnotations) {
    await writeClipboardText(text);
    return "copied";
  }
  const image = await captureAnnotatedView(annotations).catch(() => null);
  await workspace.sendAnnotations({ text, context: annotationContext(documentTitle, annotations), image });
  return "sent";
}

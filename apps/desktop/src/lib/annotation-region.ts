import { writeClipboardText } from "./clipboard";

// Annotate mode: the user marks a screen rectangle, writes a comment, and the
// batch is delivered to the agent. Viewer iframes answer `describe_region`
// (Mol* atoms and residues plus a cropped frame, xyzrender atoms, grid rows,
// or text); anything outside an iframe is read from the DOM. Every field that
// reaches the agent is bounded here.

export type RegionRect = { left: number; top: number; width: number; height: number };

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
  image?: { dataUri: string; mimeType: string };
  // Element box a click snapped to (page pixels); layout only, never sent.
  box?: RegionRect;
};

export type Annotation = { id: number; rect: RegionRect; pin: { x: number; y: number }; comment: string; target: RegionTarget | null };

const REGION_TIMEOUT_MS = 8000;
const MAX_TEXT = 1200;
const MAX_IMAGES = 4;

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

function describeFrameRegion(frame: HTMLIFrameElement, rect: RegionRect): Promise<RegionTarget | null> {
  const target = frame.contentWindow;
  if (!target) return Promise.resolve(null);
  const frameRect = frame.getBoundingClientRect();
  const id = `annotate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const finish = (result: RegionTarget | null) => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      const body = event.data?.body;
      if (event.source !== target || event.data?.source !== "burette-agent-viewer" || body?.type !== "agent-action-result" || body.id !== id) return;
      const result: RegionTarget | null = body.result?.ok !== false && body.result?.result ? body.result.result : null;
      const box = result?.box;
      finish(result && box ? { ...result, box: { ...box, left: box.left + frameRect.left, top: box.top + frameRect.top } } : result);
    };
    const timeout = window.setTimeout(() => finish(null), REGION_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    target.postMessage({ source: "burette-agent-host", body: { type: "agent-action", id, action: {
      type: "describe_region",
      rect: { left: rect.left - frameRect.left, top: rect.top - frameRect.top, width: rect.width, height: rect.height },
    } } }, "*");
  });
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

export async function describeRegion(layer: HTMLElement, rect: RegionRect): Promise<RegionTarget | null> {
  const element = topElementAt(layer, rect.left + rect.width / 2, rect.top + rect.height / 2);
  // Only viewer runtimes answer; sandboxed document frames would just time out.
  if (element instanceof HTMLIFrameElement) return element.matches(".viewer-iframe") ? describeFrameRegion(element, rect) : null;
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

export function annotationMessage(documentTitle: string, annotations: Annotation[]) {
  const lines = annotations.map((annotation, index) =>
    `${index + 1}. ${annotation.comment}\n   → ${describeTarget(annotation.target)}`);
  const text = `Burette annotations on ${documentTitle}:\n\n${lines.join("\n")}`;
  const images = annotations.flatMap((annotation, index) => annotation.target?.image
    ? [{ index: index + 1, ...annotation.target.image }] : []).slice(0, MAX_IMAGES);
  const structured = annotations.map(({ comment, target }, index) => {
    const { image, box: _box, ...rest } = target ?? { surface: "document" as const };
    return { index: index + 1, comment, target: rest, image: image ? "attached" : undefined };
  });
  return {
    text,
    context: {
      content: [
        { type: "text" as const, text: `Burette annotation details (document: ${documentTitle}):\n${JSON.stringify(structured)}` },
        ...images.map((image) => ({ type: "image" as const, data: image.dataUri.replace(/^data:[^,]*,/, ""), mimeType: image.mimeType })),
      ],
    },
  };
}

// The Codex native widget posts the batch into the chat; every other surface
// (desktop, browser shell) has no chat, so the batch goes to the clipboard.
export async function deliverAnnotations(documentTitle: string, annotations: Annotation[]): Promise<"sent" | "copied"> {
  const message = annotationMessage(documentTitle, annotations);
  const workspace = window.BuretteMcpWorkspace;
  if (workspace?.sendAnnotations) {
    await workspace.sendAnnotations(message);
    return "sent";
  }
  await writeClipboardText(message.text);
  return "copied";
}

import { invoke } from "@tauri-apps/api/core";
import { pathExtension } from "./file-routing";
import { isTauriRuntime } from "./tauri";

// 2D ligand interaction maps. The page that draws them ships with the app
// (public/interaction-diagram) and runs in a frame: the Interactions dock tab
// and the viewer's ligand card. It asks its host for the diagram, which the
// desktop app computes with the interaction_diagram command and browser-dev
// with the dev server's /__burette/interaction-diagram route. The agent shell
// and hosted builds have no engine.

// The same list as maps_interactions in src-tauri/src/commands/interaction_diagram.rs.
const MAPPED_EXTENSIONS = new Set(["pdb", "ent", "cif", "mmcif"]);

export const INTERACTION_DIAGRAM_PAGE = `${import.meta.env.BASE_URL}interaction-diagram/index.html`;

export function canMapInteractions(path: string | null | undefined) {
  return Boolean(path) && (isTauriRuntime() || import.meta.env.DEV) && MAPPED_EXTENSIONS.has(pathExtension(path!));
}

// `panel` marks the designs made for a side panel and a card, and gives their order.
export type DiagramStyle = { label: string; panel: number };

export async function fetchDiagramStyles() {
  const response = await fetch(`${import.meta.env.BASE_URL}interaction-diagram/styles/index.json`);
  if (!response.ok) throw new Error(`Diagram styles: HTTP ${response.status}`);
  const styles = await response.json() as Record<string, DiagramStyle>;
  return Object.entries(styles).sort((a, b) => a[1].panel - b[1].panel);
}

// The page asks for the scene of one ligand (or of the largest) drawn with a
// design's layout rules; the engine checks the rules.
export type DiagramRequest = { id: number; ligand: string | null; rules: Record<string, unknown> };

export function readDiagramRequest(message: unknown): DiagramRequest | null {
  const data = message as Record<string, unknown> | null;
  if (data?.type !== "diagram-request" || typeof data.id !== "number") return null;
  if (data.ligand !== null && typeof data.ligand !== "string") return null;
  if (!data.rules || typeof data.rules !== "object" || Array.isArray(data.rules)) return null;
  return { id: data.id, ligand: data.ligand, rules: data.rules as Record<string, unknown> };
}

export type DiagramAnswer = { id: number; result?: unknown; error?: string };

export async function computeInteractionDiagram(path: string, request: DiagramRequest): Promise<DiagramAnswer> {
  const body = { path, ligand: request.ligand, rules: request.rules };
  try {
    if (isTauriRuntime()) return { id: request.id, result: await invoke("interaction_diagram", { request: body }) };
    const response = await fetch("/__burette/interaction-diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return { id: request.id, result: payload };
  } catch (error) {
    return { id: request.id, error: typeof error === "string" ? error : error instanceof Error ? error.message : "The interaction map could not be drawn" };
  }
}

// The answer as the diagram page reads it.
export function diagramAnswerMessage(answer: DiagramAnswer) {
  return { source: "burette-lid-host", type: "diagram", ...answer };
}

// A ligand the Interactions panel should show, asked for by the 3D view's
// ligand card; the panel may not be mounted yet, so the request waits here.
const requestedLigands = new Map<string, string>();
export const INTERACTIONS_LIGAND_EVENT = "burette:interactions-ligand";

export function requestInteractionsLigand(documentId: string, ligandId: string) {
  requestedLigands.set(documentId, ligandId);
  window.dispatchEvent(new CustomEvent(INTERACTIONS_LIGAND_EVENT, { detail: { documentId } }));
}

export function takeRequestedInteractionsLigand(documentId: string) {
  const ligandId = requestedLigands.get(documentId) ?? null;
  requestedLigands.delete(documentId);
  return ligandId;
}

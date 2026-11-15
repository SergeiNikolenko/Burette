import type { ShellActions } from "../components/types";
import type { ViewerDocument } from "../types";
import type { BondOrder } from "./molecular-workbench/graph-edit";
import type { DrawStroke } from "./molecular-workbench/draw-stroke";
import type { Vec3 } from "./molecular-workbench/types";
import type { ViewerActionTarget } from "./viewer-bridge";

/** One Draw gesture from the viewer; atoms are zero-based source indices, positions in Å. */
export type DrawGesture =
  | { gesture: "empty"; position: Vec3 }
  | { gesture: "atom"; atoms: [number] }
  | { gesture: "drag"; atoms: [number]; position: Vec3 }
  | { gesture: "bond" | "bond-click"; atoms: [number, number] };

const ATOM_COUNT: Record<DrawGesture["gesture"], number> = { empty: 0, atom: 1, drag: 1, bond: 2, "bond-click": 2 };

/** Turns the viewer's Draw mode on or off for the frame behind `target`. */
export async function setAtomDrawMode(document: ViewerDocument, target: ViewerActionTarget, lease: string, enabled: boolean,
  send: ShellActions["runStructureViewerAction"]): Promise<void> {
  if (target.documentId !== document.id) throw new Error("The scene belongs to another document.");
  await send(document, { type: "atom_draw", enabled, lease, label: "Draw", notify: false }, { target });
}

/** Validates one untrusted frame message; returns null for anything else. */
export function parseAtomDrawMessage(data: unknown, lease: string): DrawGesture | null {
  if (!data || typeof data !== "object" || (data as { source?: unknown }).source !== "burette-viewer") return null;
  const body = (data as { body?: unknown }).body as Record<string, unknown> | undefined;
  if (!body || body.type !== "atom-draw" || body.lease !== lease || typeof body.gesture !== "string" || !(body.gesture in ATOM_COUNT)) return null;
  const gesture = body.gesture as DrawGesture["gesture"], count = ATOM_COUNT[gesture];
  const atoms = gesture === "empty" ? [] : body.atoms;
  if (!Array.isArray(atoms) || atoms.length !== count || !atoms.every(atom => Number.isSafeInteger(atom) && atom >= 0)) return null;
  const needsPosition = gesture === "empty" || gesture === "drag";
  const position = body.position;
  if (needsPosition && !(Array.isArray(position) && position.length === 3 && position.every(Number.isFinite))) return null;
  return (needsPosition ? { gesture, atoms, position } : { gesture, atoms }) as DrawGesture;
}

/** The structure edit a gesture makes with the chosen element and bond order. */
export function drawStroke(gesture: DrawGesture, element: string, order: BondOrder): DrawStroke {
  switch (gesture.gesture) {
    case "empty": return { kind: "atom", element, position: gesture.position };
    case "atom": return { kind: "element", atom: gesture.atoms[0], element };
    case "drag": return { kind: "bonded-atom", from: gesture.atoms[0], toward: gesture.position, element, order };
    case "bond": return { kind: "bond", a: gesture.atoms[0], b: gesture.atoms[1], order };
    case "bond-click": return { kind: "cycle-bond", a: gesture.atoms[0], b: gesture.atoms[1] };
  }
}

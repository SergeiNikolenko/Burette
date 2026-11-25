import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { activeViewerIframeForDocument, requestViewerAction } from "../lib/viewer-bridge";
import {
  INTERACTION_DIAGRAM_PAGE,
  INTERACTIONS_LIGAND_EVENT,
  computeInteractionDiagram,
  diagramAnswerMessage,
  fetchDiagramStyles,
  readDiagramRequest,
  takeRequestedInteractionsLigand,
  type DiagramStyle,
} from "../lib/interaction-diagram";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

// The 2D interaction diagram of the open complex (lib/interaction-diagram.ts).
// Its frame talks to this panel over postMessage, so a contact picked in 2D is
// shown in the 3D scene.
type DiagramResidue = { chain: string; number: number; name: string };
// The atom pair of one contact, by atom name; "ring" for an aromatic ring.
type DiagramLink = { kind: string; distance: number; ligandAtom: string; residueAtom: string };
type DiagramMessage =
  | { type: "ready" }
  | { type: "ligands"; ligands: { id: string; label: string }[] }
  | { type: "loaded"; ligand: string }
  | { type: "contact"; contact: { residue: DiagramResidue; ligand: DiagramResidue | null; links: DiagramLink[] } | null }
  | { type: "atom"; atom: { residue: DiagramResidue; name: string } };

const STYLE_KEY = "burette.interactions.style";
const DEFAULT_STYLE = "style-schrodinger";

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.querySelector(".app-shell") ?? document.documentElement, { attributes: true, attributeFilter: ["data-effective-theme"] });
  return () => observer.disconnect();
}

function shellTheme() {
  return document.querySelector(".app-shell")?.getAttribute("data-effective-theme") === "light" ? "light" : "dark";
}

// The scene reports either a ligand selector (a picked ligand) or the residues of
// the current selection; both name the ligand the same way the diagram does.
type SceneSelection = {
  selector?: Record<string, unknown>;
  residues?: { chain?: unknown; sequence?: unknown; compId?: unknown }[];
} | null;

function selectedLigandIds(selection: SceneSelection) {
  const selector = selection?.selector;
  if (selector) return [`${selector.auth_comp_id ?? selector.label_comp_id}_${selector.auth_asym_id}_${selector.auth_seq_id}`];
  return (selection?.residues ?? []).map((residue) => `${residue.compId}_${residue.chain}_${residue.sequence}`);
}

// A chosen ligand or a residue picked in the diagram is shown in one step with
// its surroundings; the scene selection is left alone.
// A contact also brings its ligand and atom pairs, drawn with their distances.
function showResidue(documentId: string, residue: { chain: string; number: number }, contact?: { ligand: DiagramResidue | null; links: DiagramLink[] }) {
  return requestViewerAction(documentId, {
    type: "focus_residue",
    selector: { chain: residue.chain, auth_seq_id: residue.number },
    ...(contact?.ligand ? { ligand: { chain: contact.ligand.chain, number: contact.ligand.number }, links: contact.links } : {}),
  }, 15000);
}

// An atom picked in the diagram is marked and framed in 3D with its surroundings.
function showAtom(documentId: string, atom: { residue: DiagramResidue; name: string }) {
  return requestViewerAction(documentId, {
    type: "focus_residue",
    selector: { chain: atom.residue.chain, auth_seq_id: atom.residue.number },
    atom: atom.name,
  }, 15000);
}

// While this panel is open the ligand card in the 3D view shows the plain
// molecule instead of a second, smaller copy of the same map.
function announcePanel(documentId: string, open: boolean) {
  activeViewerIframeForDocument(documentId)?.contentWindow?.postMessage({ source: "burette-interactions-panel", open }, "*");
}

function ligandResidue(ligandId: string) {
  const [, chain, number] = ligandId.split("_");
  return { chain, number: Number(number) };
}

export function InteractionsPanel({ documentId, path }: { documentId: string; path: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A closed dock keeps its content mounted, so "open" is the dock's own state.
  const shown = () => rootRef.current?.closest<HTMLElement>(".dock-panel")?.dataset.open !== "false";
  const theme = useSyncExternalStore(subscribeTheme, shellTheme);
  const [styles, setStyles] = useState<[string, DiagramStyle][]>([]);
  const [style, setStyle] = useState(() => localStorage.getItem(STYLE_KEY) ?? DEFAULT_STYLE);
  const [ligands, setLigands] = useState<{ id: string; label: string }[]>([]);
  const [ligand, setLigand] = useState<string | null>(() => takeRequestedInteractionsLigand(documentId));
  const [ready, setReady] = useState(false);
  // The frame loads once per document, after the remembered design is known to
  // be on offer; later changes go through configure.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const open = (id: string) => {
      setStyle(id);
      // `compact`: the residues in contact with the ligand, without the rest of the pocket
      setSrc((current) => current ?? `${INTERACTION_DIAGRAM_PAGE}?${new URLSearchParams({ embed: "1", collection: "binding", style: id, theme: shellTheme(), detail: "compact" })}`);
    };
    const remembered = localStorage.getItem(STYLE_KEY) ?? DEFAULT_STYLE;
    fetchDiagramStyles()
      .then((offered) => {
        setStyles(offered);
        open(offered.some(([id]) => id === remembered) ? remembered : offered[0]?.[0] ?? DEFAULT_STYLE);
      })
      .catch(() => open(remembered));
  }, [path]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.source !== "burette-lid") return;
      const message = event.data as DiagramMessage;
      const request = readDiagramRequest(message);
      if (request) {
        const frame = event.source as Window;
        void computeInteractionDiagram(path, request).then((answer) => {
          // Keep postMessage out of tail position: JavaScriptCore PTC collapses the
          // caller frame on WebKitGTK and delivers event.source === target frame.
          frame.postMessage(diagramAnswerMessage(answer), "*");
        });
      } else if (message.type === "ready") setReady(true);
      else if (message.type === "ligands") setLigands(message.ligands);
      else if (message.type === "loaded") setLigand(message.ligand);
      else if (message.type === "contact" && message.contact) void showResidue(documentId, message.contact.residue, message.contact).catch(() => {});
      else if (message.type === "atom") void showAtom(documentId, message.atom).catch(() => {});
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [documentId, path]);

  useEffect(() => {
    const dock = rootRef.current?.closest(".dock-panel");
    const announce = () => announcePanel(documentId, shown());
    announce();
    const observer = new MutationObserver(announce);
    if (dock) observer.observe(dock, { attributes: true, attributeFilter: ["data-open"] });
    return () => {
      observer.disconnect();
      announcePanel(documentId, false);
    };
  }, [documentId]);

  // A ligand picked in the scene opens its diagram. The shell keeps only plain
  // ligand picks, so the panel reads the scene's selection message itself.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const body = event.data?.source === "burette-viewer" ? event.data.body : null;
      if (body?.type !== "selectionChanged" || body.documentId !== documentId) return;
      // the scene may have loaded after this panel opened
      announcePanel(documentId, shown());
      const picked = selectedLigandIds(body.selection).find((id) => ligands.some((entry) => entry.id === id));
      if (picked) setLigand(picked);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [documentId, ligands]);

  // The ligand card asks for its ligand while this panel is already open.
  useEffect(() => {
    const take = (event: Event) => {
      if ((event as CustomEvent<{ documentId: string }>).detail?.documentId !== documentId) return;
      const requested = takeRequestedInteractionsLigand(documentId);
      if (requested) setLigand(requested);
    };
    window.addEventListener(INTERACTIONS_LIGAND_EVENT, take);
    return () => window.removeEventListener(INTERACTIONS_LIGAND_EVENT, take);
  }, [documentId]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ source: "burette-lid-host", type: "configure", ligand, style, theme }, "*");
  }, [ready, ligand, style, theme]);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1">
        {ligands.length > 1 && (
          <NativeSelect size="sm" aria-label="Ligand" value={ligand ?? ""} onChange={(event) => {
            const next = event.currentTarget.value;
            setLigand(next);
            void showResidue(documentId, ligandResidue(next)).catch(() => {});
          }}>
            {ligands.map((entry) => <NativeSelectOption key={entry.id} value={entry.id}>{entry.label}</NativeSelectOption>)}
          </NativeSelect>
        )}
        {styles.length > 0 && (
          <NativeSelect size="sm" aria-label="Diagram style" value={style} onChange={(event) => {
            setStyle(event.currentTarget.value);
            localStorage.setItem(STYLE_KEY, event.currentTarget.value);
          }}>
            {styles.map(([id, entry]) => <NativeSelectOption key={id} value={id}>{entry.label}</NativeSelectOption>)}
          </NativeSelect>
        )}
      </div>
      {src && <iframe ref={frameRef} src={src} title="Interaction diagram" className="min-h-0 w-full flex-1 border-0 bg-transparent" />}
    </div>
  );
}

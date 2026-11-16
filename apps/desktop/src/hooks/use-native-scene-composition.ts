import { useEffect, useState } from "react";
import type { ViewerDocument } from "../types";
import type { StructureCompositionSummary, StructureSummaryRow } from "../lib/structure-composition";
import { activeViewerIframeForDocument, captureViewerActionTarget, type ViewerActionTarget } from "../lib/viewer-bridge";
import { useMoleculeStore } from "../stores/molecule-store";

type Counts = { atoms: number; residues: number; chains: number };
function counts(value: unknown): Counts | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Counts;
  return [row.atoms, row.residues, row.chains].every(number => Number.isSafeInteger(number) && number >= 0) ? row : null;
}

function sceneSummary(value: unknown): StructureCompositionSummary | null {
  if (!Array.isArray(value) || value.length > 128) return null;
  const row = value.find(row => row?.query === "all"), total = counts(row?.counts), hierarchy = row?.hierarchy;
  const polymer = counts(hierarchy?.polymer);
  if (!total || !polymer || polymer.atoms > total.atoms || polymer.residues > total.residues || polymer.chains > total.chains
    || !Array.isArray(hierarchy?.chains) || hierarchy.chains.length > 126 || typeof hierarchy.truncated !== "boolean") return null;
  const polymerRows: StructureSummaryRow[] = [];
  for (const chain of hierarchy.chains) {
    if (!chain || !(typeof chain.authId === "string" && chain.authId.length <= 128 && !chain.authId.includes("\0"))
      || ![chain.atoms, chain.residues].every(number => Number.isSafeInteger(number) && number >= 0)
      || chain.atoms > polymer.atoms || chain.residues > polymer.residues) return null;
    const name = chain.authId;
    const selector = { kind: "polymer", auth_asym_id: chain.authId };
    polymerRows.push({ label: name ? `Chain ${name}` : "Chain", value: `${chain.residues} residues / ${chain.atoms} atoms`,
      ...(name ? { action: { type: "select_residues", label: `Select chain ${name}`, selector, granularity: "residue", mode: "replace" } as const } : {}) });
  }
  return {
    rows: [{ label: "Atoms", value: total.atoms.toLocaleString() }, { label: "Residues", value: total.residues.toLocaleString() }, { label: "Chains", value: total.chains.toLocaleString() }],
    componentRows: polymer.atoms ? [{ label: "Polymers", value: `${polymer.chains} chains / ${polymer.residues} residues / ${polymer.atoms} atoms`,
      action: { type: "select_residues", label: "Select polymers", selector: { kind: "polymer" }, granularity: "residue", mode: "replace" } }] : [],
    polymerRows, ligandRows: [], solventRows: [], notes: [],
  };
}

/** A plain MOLX has scene objects, not a host text source. Keep their summary with its exact live viewer. */
export function useNativeSceneComposition(owner: ViewerDocument | null) {
  const [state, setState] = useState<{ owner: ViewerDocument; target: ViewerActionTarget; key: string; summary: StructureCompositionSummary } | null>(null);
  useEffect(() => {
    setState(null);
    if (!owner) return;
    let target: ViewerActionTarget | null = null, frame: HTMLIFrameElement | null = null, requestId: string | null = null;
    const current = () => useMoleculeStore.getState().documents.includes(owner);
    const release = () => {
      if (target && requestId) target.source.postMessage({ source: "burette-agent-host", body: { type: "compositionVisibilityRequest", releaseId: requestId } }, "*");
      target = null; requestId = null; frame = null;
    };
    const request = () => {
      const next = captureViewerActionTarget(owner.id, current);
      if (!next) return;
      release(); target = next; frame = activeViewerIframeForDocument(owner.id); requestId = crypto.randomUUID();
      target.source.postMessage({ source: "burette-agent-host", body: { type: "compositionVisibilityRequest", queries: ["all"], hierarchy: true, requestId } }, "*");
    };
    const receive = (event: MessageEvent) => {
      const body = event.data?.body;
      if (event.data?.source !== "burette-viewer" || body?.documentId !== owner.id) return;
      if (body.type === "ready") {
        const next = captureViewerActionTarget(owner.id, current);
        if (next?.source === event.source && next.isCurrent()) request();
      }
      if (body.type !== "compositionVisibilityChanged" || !target?.isCurrent() || event.source !== target.source
        || !Array.isArray(body.hierarchyRequestIds) || body.hierarchyRequestIds.length > 16 || !body.hierarchyRequestIds.includes(requestId)) return;
      const summary = sceneSummary(body.rows);
      if (summary && requestId) {
        summary.sceneRequestId = requestId;
        const captured = target, key = JSON.stringify(summary);
        setState(previous => previous?.owner === owner && previous.target.source === captured.source && previous.target.isCurrent() && previous.key === key
          ? previous : { owner, target: captured, key, summary });
      }
    };
    const checkOwner = () => {
      if (target && !target.isCurrent()) { release(); setState(null); }
      if (!target && current()) request();
    };
    const observer = new MutationObserver(records => {
      // Attribute ABA can finish before this callback; the old subscription is still retired.
      if (records.some(record => record.type === "attributes" && record.target === frame)) { release(); setState(null); }
      checkOwner();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "srcdoc", "data-source-preview-request-id", "data-source-preview-revision", "data-read-only", "data-active", "data-document-id", "data-renderer"] });
    const unsubscribe = useMoleculeStore.subscribe(checkOwner);
    window.addEventListener("message", receive); request();
    return () => { observer.disconnect(); unsubscribe(); window.removeEventListener("message", receive); release(); };
  }, [owner]);
  return state?.owner === owner && state.target.isCurrent() ? state.summary : null;
}

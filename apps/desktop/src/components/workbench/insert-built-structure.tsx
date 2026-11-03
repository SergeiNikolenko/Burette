import { useState } from "react";
import type { FragmentSource } from "../../lib/molecular-workbench/fragment-source";
import { structureEditAvailable } from "../../lib/workbench/graph-draft";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useGraphDraft } from "./use-graph-draft";

type BuiltGraph = { atoms: { element: string; x: number; y: number; z: number; charge: number }[]; bonds: { a: number; b: number; order: 1 | 2 | 3 }[] };

/**
 * Inserts a builder's output into an editable MOL/SDF document as a separate molecule: one Undo step in
 * that document's Edit history, shared with the Edit tab. Renders nothing for other documents.
 */
export function InsertBuiltStructureButton({ document, name, build, disabled }: {
  document: ViewerDocument | null; name: string; disabled?: boolean;
  /** Builds (or returns the previewed) structure; a rejection is shown as the error. */
  build: () => Promise<BuiltGraph>;
}) {
  const target = structureEditAvailable(document) ? document : null;
  const draft = useGraphDraft(target), [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ inserted: true } | { inserted: false; error: string | null } | null>(null);
  if (!target) return null;
  const insert = async () => {
    setRunning(true); setOutcome(null);
    try {
      const graph = await build();
      const fragment: FragmentSource = { source: "graph", name, atoms: graph.atoms, bonds: graph.bonds };
      const inserted = await draft.apply({ kind: "insert-fragment", fragment, target: null });
      // A refused edit reports its reason through the shared draft error.
      setOutcome(inserted ? { inserted: true } : { inserted: false, error: null });
    } catch (error) {
      setOutcome({ inserted: false, error: error instanceof Error ? error.message : String(error) });
    } finally { setRunning(false); }
  };
  return <>
    {outcome && !outcome.inserted ? <p role="alert" className="text-sm text-destructive">{outcome.error ?? draft.error}</p> : null}
    {outcome?.inserted ? <span role="status" className="workbench-status">Inserted</span> : null}
    <Button type="button" variant="outline" disabled={disabled || running || draft.busy || !draft.history} title={`Insert into ${target.title}`} onClick={() => void insert()}>
      {running ? <Spinner aria-label="Inserting" /> : null}Insert
    </Button>
  </>;
}

import { useState } from "react";
import { cjsonCoordinateSetRevision } from "../../lib/workbench/cjson-coordinate-set";
import { useSourceEditing } from "../../lib/source-editing/context";
import { recordImportedRevision, revisionIndex, useImportedRevisions, useScientificDocument } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { sceneReload } from "./zmatrix-session";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The coordinate sets of a CJSON file, as Avogadro's frames of one molecule. Choosing a
 * set writes its positions to the scene's MOL source as one revision (Undo returns to
 * the previous set); a set shown before is that revision again, with its data.
 */
export function CoordinateSetCard({ document }: { document: ViewerDocument }) {
  const { document: science, text } = useScientificDocument(document);
  const sourceEditing = useSourceEditing();
  const revisions = useImportedRevisions(document.id, text ?? "") ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const graph = science?.format === "cjson" ? science.graph : undefined;
  if (!science || !graph || text === null || science.frames.length < 2) return null;

  const choose = async (index: number) => {
    if (index === graph.activeFrameIndex || busy) return;
    setBusy(true);
    try {
      if (!sourceEditing) throw new Error("This structure can only be changed from its source.");
      const built = cjsonCoordinateSetRevision(science, text, index);
      const shown = revisions[revisionIndex(revisions, built.text)];
      if (!sourceEditing.sessionForDocument(document)) await sourceEditing.beginEditing(document, "inspector");
      if (sourceEditing.sessionForDocument(document)?.content !== text) throw new Error("The structure changed. Try again.");
      const rollback = shown ? null : recordImportedRevision(document.id, text, built);
      if (!shown && !rollback) throw new Error("The structure changed outside its coordinate sets.");
      const target = shown ?? built;
      sourceEditing.updateDraft(document, target.text, { view: "keep" });
      const { outcome, diagnostic } = await sceneReload(sourceEditing, document, target.text);
      if (outcome === "failed") {
        rollback?.();
        sourceEditing.updateDraft(document, text, { previewApplied: true });
        throw new Error(diagnostic ?? "The scene could not show this coordinate set.");
      }
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="structure-brief-card" aria-label="Coordinate set">
      <div className="structure-brief-card-header">
        <h4>Coordinate set</h4>
        <NativeSelect size="sm" name="coordinate-set" aria-label="Coordinate set" value={String(graph.activeFrameIndex)} disabled={busy}
          onChange={(event) => void choose(Number(event.target.value))}>
          {science.frames.map((_, index) => <NativeSelectOption key={index} value={String(index)}>{`Set ${index + 1}`}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </section>
  );
}

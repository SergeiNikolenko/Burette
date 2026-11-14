import { useEffect, useMemo, useRef, useState } from "react";
import { requestGridRecords } from "../../hooks/use-app-derived-columns";
import { useOpenDocuments } from "../../hooks/use-tabs";
import { fetchDerivedSourceRows } from "../../lib/derived-columns";
import {
  coreAttachmentLabels,
  LIBRARY_PRODUCT_LIMIT,
  LibraryInputError,
  reactionReactantTemplates,
  type LibraryBuildingBlock,
  type LibraryRequest,
} from "../../lib/library-enumeration.mjs";
import { runLibraryEnumeration } from "../../lib/library-enumeration-task";
import { isTauriRuntime } from "../../lib/tauri";
import { isAbortError } from "../../lib/viewer-errors";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import type { ViewerDocument } from "../../types";
import { REACTION_PRESETS } from "../perform-reaction-dialog";
import { ShortcutTooltip } from "../shortcut-tooltip";
import type { ShellActions, StatusKind } from "../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

type Props = {
  actions: Pick<ShellActions, "openStructureRecords">;
  onStatus: (message: string, kind?: StatusKind) => void;
};

/** DataWarrior's combinatorial library: building blocks combined through a reaction, or placed on the R positions of a core. */
export function EnumerateLibraryDialogHost({ actions, onStatus }: Props) {
  const request = useWorkbenchDialogRequest();
  const library = request?.kind === "enumerate-library" ? request : null;
  const run = useRef<AbortController | null>(null);
  return (
    <Dialog open={Boolean(library)} onOpenChange={(open) => { if (!open && library) { run.current?.abort(); closeWorkbenchDialog(); } }}>
      {library ? <DialogContent aria-describedby={undefined} variant="form" size="default" className="overscroll-contain">
        <DialogHeader><DialogTitle>Enumerate library</DialogTitle></DialogHeader>
        <EnumerateLibraryForm document={library.document} actions={actions} onStatus={onStatus} run={run} />
      </DialogContent> : null}
    </Dialog>
  );
}

const PASTED = "pasted";
type Slot = { source: string; text: string };
type CollectionList = LibraryBuildingBlock[] | { error: string };

// One SMILES per line; anything after it on the line names the building block.
function pastedBlocks(text: string): LibraryBuildingBlock[] {
  return text.split(/\r?\n/u).flatMap((line, index) => {
    const [smiles, ...name] = line.trim().split(/\s+/u);
    return smiles ? [{ smiles, source: name.join(" ") || `Pasted #${index + 1}` }] : [];
  });
}

// The whole collection, not the filtered page: the desktop pages it out of the
// collection database, the browser shell asks the grid that parsed it.
async function readCollectionBlocks(document: ViewerDocument): Promise<LibraryBuildingBlock[]> {
  const source = (index: number) => `${document.title} #${index + 1}`;
  // A list longer than a whole library can never be enumerated, so it is not read to the end.
  const refuseAbove = (count: number) => {
    if (count > LIBRARY_PRODUCT_LIMIT) throw new LibraryInputError(`More than ${LIBRARY_PRODUCT_LIMIT.toLocaleString()} molecules.`);
  };
  if (!isTauriRuntime()) {
    const records = await requestGridRecords(document.id);
    refuseAbove(records.length);
    return records.map((record) => ({ smiles: record.smiles, molblock: record.molblock, source: source(record.index) }));
  }
  const blocks: LibraryBuildingBlock[] = [];
  let afterSourceIndex = -1;
  for (;;) {
    const batch = await fetchDerivedSourceRows(document.id, afterSourceIndex, 500);
    refuseAbove(batch.totalRows);
    if (batch.rows.length === 0) return blocks;
    blocks.push(...batch.rows.map((row) => ({ smiles: row.smiles ?? null, molblock: row.molblock ?? null, source: source(row.sourceIndex) })));
    afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
  }
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function EnumerateLibraryForm({ document, actions, onStatus, run }: Props & { document: ViewerDocument | null; run: { current: AbortController | null } }) {
  const documents = useOpenDocuments();
  // The collection the command was started from leads, so it fills the first position.
  const collections = useMemo(() => {
    const grids = documents.filter((candidate) => candidate.renderer === "grid2d");
    return [...grids.filter((grid) => grid.id === document?.id), ...grids.filter((grid) => grid.id !== document?.id)];
  }, [document?.id, documents]);
  const [mode, setMode] = useState<"reaction" | "core">("reaction");
  const [smarts, setSmarts] = useState(REACTION_PRESETS[0].smarts);
  const [core, setCore] = useState("");
  const [slots, setSlots] = useState<Record<number, Slot>>({});
  const [lists, setLists] = useState<Record<string, CollectionList>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const preset = REACTION_PRESETS.find((candidate) => candidate.smarts === smarts.trim());
  const scheme = useMemo(() => {
    if (mode === "reaction") {
      const count = reactionReactantTemplates(smarts).length;
      return {
        labels: Array.from({ length: count }, (_, index) => `Reactant ${index + 1}`),
        problem: smarts.trim() && count === 0 ? "A reaction reads reactants>agents>products." : null,
      };
    }
    if (!core.trim()) return { labels: [], problem: null };
    try {
      return { labels: coreAttachmentLabels(core).map((label) => `R${label}`), problem: null };
    } catch (caught) {
      return { labels: [], problem: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [core, mode, smarts]);

  const positions = scheme.labels.map((label, index) => {
    const slot = slots[index] ?? { source: collections[index]?.id ?? PASTED, text: "" };
    const list = slot.source === PASTED ? pastedBlocks(slot.text) : lists[slot.source];
    return { label, slot, blocks: Array.isArray(list) ? list : null, problem: list && !Array.isArray(list) ? list.error : null };
  });
  const sourceKey = positions.map((position) => position.slot.source).join("\n");
  useEffect(() => {
    for (const id of new Set(sourceKey.split("\n"))) {
      const collection = collections.find((candidate) => candidate.id === id);
      if (!collection || requested.current.has(id)) continue;
      requested.current.add(id);
      void readCollectionBlocks(collection).then(
        (blocks) => setLists((previous) => ({ ...previous, [id]: blocks })),
        (caught: unknown) => {
          // Choosing the collection again reads it again.
          requested.current.delete(id);
          setLists((previous) => ({ ...previous, [id]: {
            error: caught instanceof LibraryInputError ? caught.message : "This collection could not be read. Open its tab, then choose it again.",
          } }));
        },
      );
    }
  }, [collections, sourceKey]);

  const total = positions.length > 0 && positions.every((position) => position.blocks)
    ? positions.reduce((count, position) => count * position.blocks!.length, 1) : 0;
  const overLimit = total > LIBRARY_PRODUCT_LIMIT;
  const busy = progress !== null;
  const setSlot = (index: number, slot: Slot) => { setSlots((previous) => ({ ...previous, [index]: slot })); setError(null); };

  const enumerate = async () => {
    if (!total || overLimit) return;
    const blocks = positions.map((position) => position.blocks!);
    const request: LibraryRequest = mode === "reaction"
      ? { mode, reaction: smarts.trim(), reactionName: preset?.label, positions: blocks }
      : { mode, core: core.trim(), positions: blocks };
    const controller = new AbortController();
    run.current = controller;
    setProgress({ done: 0, total });
    setError(null);
    try {
      const result = await runLibraryEnumeration(request, { signal: controller.signal, onProgress: setProgress });
      if (result.products === 0) {
        setError(mode === "reaction" ? "No products. Check that the building blocks fit the reaction." : "No products. Each building block needs one attachment point, written *.");
        return;
      }
      const title = mode === "reaction" ? `${preset?.label ?? "Reaction"} library` : "Core library";
      const opened = await actions.openStructureRecords([{ path: `${title}.sdf`, inputExtension: "sdf", text: result.sdf }], undefined, { newDocument: true });
      if (opened.length === 0) {
        setError("The library could not be opened.");
        return;
      }
      closeWorkbenchDialog();
      onStatus([
        `Enumerated ${plural(result.products, "product")}`,
        ...(result.duplicates ? [`${plural(result.duplicates, "duplicate")} removed`] : []),
        ...(result.skipped ? [`${plural(result.skipped, "building block")} skipped`] : []),
        ...(result.withoutProduct ? [`${plural(result.withoutProduct, "combination")} without a product`] : []),
        ...(result.capped ? [`stopped at ${LIBRARY_PRODUCT_LIMIT.toLocaleString()} products`] : []),
      ].join(", "), "success");
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (run.current === controller) run.current = null;
      setProgress(null);
    }
  };

  return (
    <form className="workbench-form" onSubmit={(event) => { event.preventDefault(); void enumerate(); }}>
      <fieldset disabled={busy} className="workbench-form min-w-0 border-0 p-0">
        <SegmentedControl aria-label="Library from" value={mode} onValueChange={(value) => { setMode(value as typeof mode); setError(null); }}>
          <SegmentedControlItem value="reaction">Reaction</SegmentedControlItem>
          <SegmentedControlItem value="core">Core</SegmentedControlItem>
        </SegmentedControl>
        {mode === "reaction" ? <>
          <label className="workbench-field"><span>Reaction</span>
            <NativeSelect aria-label="Reaction" value={preset?.id ?? "custom"}
              onChange={(event) => { setSmarts(REACTION_PRESETS.find((candidate) => candidate.id === event.target.value)?.smarts ?? ""); setError(null); }}>
              {REACTION_PRESETS.map((candidate) => <NativeSelectOption key={candidate.id} value={candidate.id}>{candidate.label}</NativeSelectOption>)}
              <NativeSelectOption value="custom">Custom</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="workbench-field"><span>Reaction SMARTS</span>
            <Textarea aria-label="Reaction SMARTS" className="max-h-40 min-h-12 resize-y font-mono text-xs" rows={2} spellCheck={false} autoComplete="off"
              maxLength={4000} value={smarts} aria-invalid={Boolean(scheme.problem)} placeholder="[C:1](=[O:2])[OH].[N:3]>>[C:1](=[O:2])[N:3]"
              onChange={(event) => { setSmarts(event.target.value); setError(null); }} />
          </label>
        </> : <label className="workbench-field">
          <ShortcutTooltip label="Number each attachment point, as in [*:1]. A building block marks its own with *." side="top"><span className="w-fit">Core</span></ShortcutTooltip>
          <Input variant="compact" aria-label="Core" className="font-mono" spellCheck={false} autoComplete="off" maxLength={4000}
            value={core} aria-invalid={Boolean(scheme.problem)} placeholder="[*:1]c1ccc([*:2])cc1"
            onChange={(event) => { setCore(event.target.value); setError(null); }} />
        </label>}
        {scheme.problem ? <p role="alert" className="workbench-error">{scheme.problem}</p> : null}
        {positions.map(({ label, slot, blocks, problem }, index) => (
          <div key={label} className="workbench-field" role="group" aria-label={label}>
            <span className="flex items-baseline justify-between gap-2">
              <span>{label}</span>
              {blocks ? <span className="workbench-value">{plural(blocks.length, "molecule")}</span> : null}
            </span>
            <NativeSelect aria-label={`${label} source`} value={slot.source} onChange={(event) => setSlot(index, { ...slot, source: event.target.value })}>
              {collections.map((collection) => <NativeSelectOption key={collection.id} value={collection.id}>{collection.title}</NativeSelectOption>)}
              <NativeSelectOption value={PASTED}>Pasted SMILES</NativeSelectOption>
            </NativeSelect>
            {slot.source === PASTED ? <Textarea aria-label={`${label} SMILES`} className="max-h-40 resize-y font-mono text-xs" rows={3} spellCheck={false} autoComplete="off"
              value={slot.text} placeholder={mode === "reaction" ? "CC(=O)O\nOC(=O)c1ccccc1" : "*C\n*OC"}
              onChange={(event) => setSlot(index, { ...slot, text: event.target.value })} /> : null}
            {problem ? <p role="alert" className="workbench-error">{problem}</p> : null}
          </div>
        ))}
      </fieldset>
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      <DialogFooter>
        {progress ? <span role="status" className="workbench-status mr-auto"><Spinner aria-hidden className="size-3" />
          {progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span>
          : overLimit ? <p role="alert" className="workbench-error mr-auto">{plural(total, "product")}. A library holds up to {LIBRARY_PRODUCT_LIMIT.toLocaleString()}.</p>
          : total ? <span className="workbench-value mr-auto">{plural(total, "product")}</span> : null}
        <Button type="button" variant="outline" onClick={() => { if (busy) run.current?.abort(); else closeWorkbenchDialog(); }}>Cancel</Button>
        <Button type="submit" disabled={busy || !total || overLimit}>Enumerate</Button>
      </DialogFooter>
    </form>
  );
}

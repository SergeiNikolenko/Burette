import { useEffect, useMemo, useState } from "react";
import type { FragmentSource } from "../../../lib/molecular-workbench/fragment-source";
import { Button } from "../../ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "../../ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";
import { Spinner } from "../../ui/spinner";

type LibraryEntry = { id: string; category: string; name: string };
let library: Promise<LibraryEntry[]> | null = null;
const loadLibrary = () => library ??= import("../../../lib/molecular-workbench/fragment-library.json")
  .then(module => (module.default as { fragments: LibraryEntry[] }).fragments.map(({ id, category, name }) => ({ id, category, name })));

/**
 * Modeless, so atoms can be picked in the 3D view while it is open. `target` is the atom label the
 * fragment attaches to (the single selected atom), or null for a separate molecule. The dialog stays
 * open after each insertion so several groups can be added in turn.
 */
export function InsertFragmentDialog({ open, onOpenChange, target, busy, error, onInsert }: {
  open: boolean; onOpenChange: (open: boolean) => void; target: string | null; busy: boolean; error: string | null;
  onInsert: (fragment: FragmentSource) => void;
}) {
  const [mode, setMode] = useState<"library" | "smiles">("library");
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null), [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(""), [smiles, setSmiles] = useState("");
  useEffect(() => {
    if (!open || entries) return;
    let live = true;
    loadLibrary().then(list => { if (live) setEntries(list); }, () => { library = null; if (live) setLoadError(true); });
    return () => { live = false; };
  }, [open, entries, loadError]);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase(), byCategory = new Map<string, LibraryEntry[]>();
    for (const entry of entries ?? []) if (!needle || entry.name.includes(needle) || entry.category.includes(needle)) byCategory.set(entry.category, [...byCategory.get(entry.category) ?? [], entry]);
    return [...byCategory];
  }, [entries, query]);
  const fragment: FragmentSource | null = mode === "smiles" ? (smiles.trim() ? { source: "smiles", smiles: smiles.trim() } : null)
    : entries?.some(entry => entry.id === selected) ? { source: "library", id: selected } : null;
  return <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
    {open ? <DialogContent aria-describedby={undefined} variant="form" size="compact" className="left-auto right-4 top-16 w-80 max-h-[calc(100dvh-5rem)] translate-x-0 translate-y-0 flex flex-col gap-3 overscroll-contain"
      onInteractOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>Insert fragment</DialogTitle></DialogHeader>
      <form className="workbench-form min-w-0" onSubmit={event => { event.preventDefault(); if (fragment && !busy) onInsert(fragment); }}>
        <SegmentedControl aria-label="Fragment source" value={mode} onValueChange={value => { if (value) setMode(value as typeof mode); }}>
          <SegmentedControlItem value="library">Library</SegmentedControlItem><SegmentedControlItem value="smiles">SMILES</SegmentedControlItem>
        </SegmentedControl>
        {mode === "library" ? entries ? <Command shouldFilter={false} value={selected} onValueChange={setSelected} label="Fragments">
          <CommandInput aria-label="Search fragments" placeholder="Search fragments…" maxLength={80} value={query} onValueChange={value => setQuery(value.slice(0, 80))} />
          <CommandList aria-label="Fragments" className="max-h-64 overflow-y-auto">
            {groups.map(([category, items]) => <CommandGroup key={category} heading={category}>
              {items.map(entry => <CommandItem key={entry.id} value={entry.id} onSelect={() => setSelected(entry.id)}>{entry.name}</CommandItem>)}
            </CommandGroup>)}
            {!groups.length ? <div role="status" className="p-2 text-sm">No matching fragments</div> : null}
          </CommandList>
        </Command> : loadError ? <Button type="button" variant="outline" size="sm" onClick={() => setLoadError(false)}>Retry</Button>
          : <Spinner aria-label="Loading fragments" />
          : <label className="workbench-field"><span>SMILES</span>
            <Input aria-label="SMILES" name="fragment-smiles" variant="compact" value={smiles} maxLength={1024} spellCheck={false} autoComplete="off" onChange={event => setSmiles(event.target.value)} />
          </label>}
        <div className="workbench-row"><span>Attach to</span><span className="workbench-value">{target ?? "New molecule"}</span></div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" disabled={!fragment || busy}>{busy ? <Spinner aria-label="Inserting" /> : null}Insert</Button>
        </DialogFooter>
      </form>
    </DialogContent> : null}
  </Dialog>;
}

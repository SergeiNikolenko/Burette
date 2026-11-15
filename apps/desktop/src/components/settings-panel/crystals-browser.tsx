import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InstalledResource } from "../../lib/extensions/resource-bundle";
import type { CrystalOpenRequest } from "../../lib/extensions/open-crystal";
import { Button } from "../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";

export type CrystalsBrowserProps = { resource: InstalledResource | null; onOpen: (request: CrystalOpenRequest) => Promise<string> };
const PAGE_SIZE = 25;

export function CrystalsBrowser({ resource, onOpen }: CrystalsBrowserProps) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0), [selected, setSelected] = useState("");
  const [opening, setOpening] = useState(false), [failed, setFailed] = useState<CrystalOpenRequest | null>(null);
  const inFlight = useRef(false), container = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  useEffect(() => {
    const moved = (event: FocusEvent) => { if (event.target !== restoreFocus.current) restoreFocus.current = null; };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, []);
  useLayoutEffect(() => {
    if (opening || !restoreFocus.current) return;
    const from = restoreFocus.current; restoreFocus.current = null;
    if (document.activeElement === from || document.activeElement === document.body) input.current?.focus();
  }, [opening]);
  const matches = (resource?.files ?? []).filter(file => file.path.endsWith(".cif") && file.path.toLowerCase().includes(query.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
  const start = currentPage * PAGE_SIZE, visible = matches.slice(start, start + PAGE_SIZE);
  async function open(request: CrystalOpenRequest) {
    if (inFlight.current) return;
    restoreFocus.current = container.current?.contains(document.activeElement) ? document.activeElement : null;
    inFlight.current = true; setOpening(true);
    try {
      const path = await onOpen(request);
      if (!path) throw new Error("No document opened");
      setFailed(null);
    } catch { setFailed(request); }
    finally { inFlight.current = false; setOpening(false); }
  }
  if (!resource) return null;
  return <div ref={container} className="min-w-0" aria-label="Crystal library" aria-busy={opening}>
    <Command shouldFilter={false} value={selected} onValueChange={setSelected} label="Crystals">
      <CommandInput ref={input} aria-label="Search crystals" placeholder="Search crystals…" maxLength={160} disabled={opening}
        value={query} onValueChange={value => { setQuery(value.slice(0, 160)); setPage(0); setSelected(""); setFailed(null); }} />
      <CommandList aria-label="Crystals" className="max-h-72 overflow-y-auto">
        {visible.map(file => <CommandItem key={file.path} value={file.path} disabled={opening}
          onSelect={() => { void open({ path: file.path, version: resource.catalog.version }); }}>
          <span className="min-w-0 break-all">{file.path}</span>
        </CommandItem>)}
        {!matches.length && <div role="status" className="p-2 text-sm">No matching crystals</div>}
      </CommandList>
    </Command>
    {matches.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
      <output className="tabular-nums" aria-live="polite">{opening ? "Opening…" : `${start + 1}–${start + visible.length} of ${matches.length}`}</output>
      <div className="flex gap-2">
        <Button variant="ghost" size="toolbar" disabled={opening || currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelected(""); setFailed(null); }}>Previous</Button>
        <Button variant="ghost" size="toolbar" disabled={opening || start + PAGE_SIZE >= matches.length} onClick={() => { setPage(currentPage + 1); setSelected(""); setFailed(null); }}>Next</Button>
      </div>
    </div>}
    {failed && <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
      {!opening && <span role="alert">This crystal could not be opened. Try again.</span>}
      <Button variant="outline" size="toolbar" disabled={opening} onClick={() => { void open(failed); }}>{opening ? "Opening…" : "Retry"}</Button>
    </div>}
  </div>;
}

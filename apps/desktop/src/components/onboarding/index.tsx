import { useEffect, useId, useRef, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InfoCircle } from "../ui/app-icons";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { guideForState, guides, type GuideId } from "./guides";

const storageKey = "burette.screen-guides.v1";
type Progress = { automatic: boolean; seen: GuideId[] };

function initialProgress(state: ShellViewState): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<Progress> | null;
    if (saved && typeof saved.automatic === "boolean" && Array.isArray(saved.seen)) {
      return { automatic: saved.automatic, seen: saved.seen.filter(id => Object.hasOwn(guides, id)) };
    }
  } catch { /* A guide is still usable when browser storage is unavailable. */ }
  // Restored workspaces and established users should never be interrupted by
  // a new feature added during an update. The Guide button stays available.
  return { automatic: guideForState(state) === "launcher" && state.documents.length === 0
    && state.recentStructures.length === 0 && state.sidebarProjects.length === 0
    && state.tabs.every(tab => tab.location.kind === "launcher"), seen: [] };
}

export function ScreenGuide({ state, actions }: { state: ShellViewState; actions: Pick<ShellActions, "openSettingsSection"> }) {
  if (window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return null;
  return <LocalScreenGuide state={state} actions={actions} />;
}

function LocalScreenGuide({ state, actions }: { state: ShellViewState; actions: Pick<ShellActions, "openSettingsSection"> }) {
  const current = guideForState(state);
  const [progress, setProgress] = useState(() => initialProgress(state));
  const [selected, setSelected] = useState<GuideId>(current);
  const [open, setOpen] = useState(false);
  const openedManually = useRef(false);
  const titleId = useId();
  const checkboxId = useId();

  useEffect(() => {
    openedManually.current = false;
    setSelected(current);
    setOpen(progress.automatic && !progress.seen.includes(current));
  }, [current]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* Keep in-memory dismissal. */ }
  }, [progress]);

  const changeOpen = (next: boolean) => {
    openedManually.current = next;
    if (next) setSelected(current);
    else setProgress(previous => ({ ...previous, seen: [...new Set([...previous.seen, current, selected])] }));
    setOpen(next);
  };
  const guide = guides[selected];
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="xs" aria-label="Screen guide" className="no-drag shrink-0 gap-1">
        <InfoCircle className="size-4" aria-hidden />Guide
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" side="bottom" size="large" className="max-w-[calc(100vw-24px)] gap-4 p-4 text-sm leading-5"
      aria-labelledby={titleId} onOpenAutoFocus={event => { if (!openedManually.current) event.preventDefault(); }}>
      <PopoverTitle id={titleId}>{guide.title}</PopoverTitle>
      <ol className="m-0 list-decimal space-y-3 pl-5">
        {guide.tips.map(tip => <li key={tip} className="pl-1">{tip}</li>)}
      </ol>
      {selected === "agent" && <Button size="xs" variant="secondary" onClick={() => { changeOpen(false); actions.openSettingsSection("agent"); }}>Open agent settings</Button>}
      <Select value={selected} onValueChange={value => setSelected(value as GuideId)}>
        <SelectTrigger size="sm" aria-label="Browse screen guides" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.entries(guides) as [GuideId, typeof guide][]).map(([id, entry]) => <SelectItem key={id} value={id}>{entry.title}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={checkboxId} className="flex items-center gap-2 text-xs">
          <Checkbox id={checkboxId} checked={progress.automatic} onCheckedChange={checked => setProgress(previous => ({ ...previous, automatic: checked === true }))} />
          Tips on first visit
        </label>
        <Button size="xs" variant="secondary" onClick={() => changeOpen(false)}>Got it</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

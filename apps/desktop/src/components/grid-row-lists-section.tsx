import { useEffect, useState } from "react";
import { deleteRowList, nextRowListName, renameRowList, saveRowList, useRowLists, type RowList } from "../lib/grid-row-lists";
import { postGridRowListCommand, requestGridSelection } from "../lib/grid-table-bridge";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import { useMoleculeStore } from "../stores/molecule-store";
import { DotsHorizontal, Filter } from "./ui/app-icons";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CollapsibleSection } from "./ui/collapsible-section";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// The grid reports its selection with its menu state. Asking for that state on
// mount covers a selection made before the panel was opened.
function useGridSelectionCount(documentId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid" || data.body?.type !== "gridMenuStateChanged" || data.body.documentId !== documentId) return;
      setCount(Math.max(0, Math.trunc(Number(data.body.selectedCount) || 0)));
    };
    window.addEventListener("message", onMessage);
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestState", documentId },
    }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [documentId]);
  return count;
}

/**
 * Named selections of the open collection. A list can be selected again, shown
 * on its own - a filter that stays when the selection changes - and exported.
 */
export function GridRowListsSection({ documentId, shownListId }: { documentId: string; shownListId: string | null }) {
  // Lists belong to the file, so they are found again under its path.
  const documentKey = useMoleculeStore((state) => state.documents.find((document) => document.id === documentId)?.path) ?? documentId;
  const lists = useRowLists(documentKey);
  const selectedCount = useGridSelectionCount(documentId);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  if (lists.length === 0 && selectedCount === 0) return null;

  const save = async () => {
    const indexes = await requestGridSelection(documentId).catch(() => []);
    const list = saveRowList(documentKey, nextRowListName(lists), indexes);
    // A new list starts with its name open for typing.
    if (list) setRenaming({ id: list.id, name: list.name });
  };
  const finishRename = (commit: boolean) => {
    if (renaming && commit) renameRowList(documentKey, renaming.id, renaming.name);
    setRenaming(null);
  };
  const remove = (list: RowList) => {
    if (shownListId === list.id) postGridRowListCommand(documentId, "filter", null);
    deleteRowList(documentKey, list.id);
  };

  return (
    <CollapsibleSection
      className="structure-inspector-section grid-filter-card-host"
      title="Row lists"
      detail={lists.length ? lists.length.toLocaleString() : undefined}
      actions={(
        <Button type="button" variant="ghost" size="xs" disabled={selectedCount === 0} onClick={() => void save()}>
          Save selection
          {selectedCount ? <Badge variant="secondary">{selectedCount.toLocaleString()}</Badge> : null}
        </Button>
      )}
    >
      <div className="grid-row-lists">
        {lists.map((list) => {
          const shown = shownListId === list.id;
          return (
            <div key={list.id} className="grid-row-list">
              {renaming?.id === list.id ? (
                <Input
                  className="grid-row-list-rename"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  name="row-list-name"
                  aria-label="Row list name"
                  value={renaming.name}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setRenaming({ id: list.id, name: event.currentTarget.value })}
                  onBlur={() => finishRename(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finishRename(true);
                    else if (event.key === "Escape") finishRename(false);
                  }}
                />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="grid-row-list-name" data-pill={undefined} data-squircle=""
                      onClick={() => postGridRowListCommand(documentId, "select", list)}>
                      <span className="min-w-0 flex-1 truncate">{list.name}</span>
                      {shown ? <Badge variant="secondary">Shown</Badge> : null}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent showArrow={false}>Select these rows</TooltipContent>
                </Tooltip>
              )}
              <span className="grid-row-list-count">{list.indexes.length.toLocaleString()}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-2xs" aria-pressed={shown}
                    aria-label={shown ? `Show all rows again` : `Show only ${list.name}`}
                    onClick={() => postGridRowListCommand(documentId, "filter", shown ? null : list)}>
                    <Filter aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent showArrow={false}>{shown ? "Show all rows" : "Show only these rows"}</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-2xs" aria-label={`${list.name} actions`}>
                    <DotsHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => postGridRowListCommand(documentId, "export-csv", list)}>Export as CSV</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => postGridRowListCommand(documentId, "export-smiles", list)}>Export as SMILES</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenaming({ id: list.id, name: list.name })}>Rename</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => remove(list)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

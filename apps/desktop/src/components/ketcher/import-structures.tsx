import type { ComponentType } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Warning } from "@/components/ui/app-icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./chemical-surfaces.css";

type StructurePreview = { struct: unknown; options: Record<string, unknown>; className?: string };
type ImportedItem = { struct?: unknown; error?: unknown };

// The native Open controller retains payload/loading and import semantics;
// only its footer presentation is replaced (also used for pasted structures).
export function KetcherImportActions({ structStr, openHandler, copyHandler, onCancel, isAddToCanvasDisabled }: {
  structStr: string; openHandler: () => void; copyHandler: () => void; onCancel: () => void; isAddToCanvasDisabled?: boolean;
}) {
  const empty = !structStr.trim();
  return <div className="ketcher-import-actions">
    <Button type="button" variant="outline" size="sm" onClick={onCancel} data-testid="cancel-button">Cancel</Button>
    <div className="ketcher-import-primary-actions">
      <Button type="button" variant="outline" size="sm" disabled={empty} onClick={openHandler} data-testid="open-as-new-button">Open as New Project</Button>
      <TooltipProvider><Tooltip>
        <TooltipTrigger asChild><Button type="button" size="sm" disabled={empty || isAddToCanvasDisabled} onClick={copyHandler} data-testid="add-to-canvas-button">Add to Canvas</Button></TooltipTrigger>
        <TooltipContent container={document.fullscreenElement as HTMLElement | null ?? undefined}>Structure will be loaded as fragment and added to Clipboard</TooltipContent>
      </Tooltip></TooltipProvider>
    </div>
  </div>;
}

// Native CDXStructuresViewer still parses each embedded object, caches its real
// Struct and forwards the original base64 payload to the import dialog.
export function KetcherImportStructures({ fileName, count, selectedIndex, onSelect, items, loading, Renderer, options }: {
  fileName: string; count: number; selectedIndex: number; onSelect: (index: number) => void;
  items: Record<number, ImportedItem>; loading: boolean; Renderer: ComponentType<StructurePreview>; options: Record<string, unknown>;
}) {
  const selected = items[selectedIndex];
  return <section className="ketcher-import-chooser" data-testid="embedded-structures-chooser">
    <div className="truncate text-sm">{fileName}</div>
    {count === 0 ? <p className="text-sm">No embedded structures found in the file</p> : <div className="ketcher-import-layout">
      <RadioGroup aria-label="Choose structure" value={String(selectedIndex)} onValueChange={value => {
        if (typeof value !== "string") return;
        const index = Number(value); if (Number.isInteger(index) && index >= 0 && index < count) onSelect(index);
      }} onKeyDown={event => event.stopPropagation()} className="ketcher-import-list">
        {Array.from({ length: count }, (_, index) => <label key={index} className={`ketcher-import-option ${selectedIndex === index ? "bg-muted" : "hover:bg-accent"}`}>
          <RadioGroupItem value={String(index)} data-testid={`cdx-structure-${index + 1}`} />
          <span>Structure {index + 1}</span>
          {Boolean(items[index]?.error) && <Warning className="size-4 text-destructive" role="img" aria-label="Could not read this structure" />}
        </label>)}
      </RadioGroup>
      <div className="ketcher-import-preview" data-testid="embedded-structure-preview" aria-busy={loading}>
        {loading ? <Spinner aria-label="Loading structure" role="status" className="motion-reduce:animate-none" />
          : selected?.error ? <p role="alert" className="text-sm">Could not read this structure.</p>
            : selected?.struct ? <Renderer struct={selected.struct} options={options} className="ketcher-import-native-preview" /> : null}
      </div>
    </div>}
  </section>;
}

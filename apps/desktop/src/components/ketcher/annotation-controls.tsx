import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, InfoCircle } from "@/components/ui/app-icons";
import "./annotation-controls.css";

const fullscreenContainer = () => document.fullscreenElement as HTMLElement | null ?? undefined;
type TextMenuProps = { open: boolean; onOpenChange: (open: boolean) => void; onReturnFocus: () => void };
// Native TextEditorInner's toolbar focuses the editor on every click and on
// Enter/Space. Portaled menus still bubble through that React ancestor. Stop
// only propagation, not the Radix activation/focus defaults inside the menu.
const isolateTextMenu = (event: { stopPropagation: () => void }) => event.stopPropagation();

export function KetcherFontMenu({ value, sizes, onSelect, onReturnFocus, ...props }: TextMenuProps & {
  value: string; sizes: number[]; onSelect: (value: number) => void;
}) {
  return <DropdownMenu {...props} modal={false}>
    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label="Font size" data-testid="font-size-button" onClick={isolateTextMenu} onKeyDown={isolateTextMenu}>
      {parseFloat(value)}<ChevronDown className="size-3" aria-hidden="true" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent container={fullscreenContainer()} className="ketcher-ui-menu min-w-20 max-h-52" onClick={isolateTextMenu} onKeyDown={isolateTextMenu} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <DropdownMenuRadioGroup value={String(parseFloat(value))}>
        {sizes.map(size => <DropdownMenuRadioItem key={size} value={String(size)} data-testid={`${size}-option`} onSelect={() => onSelect(size)}>{size}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function KetcherSymbolsMenu({ icon, children, onReturnFocus, ...props }: TextMenuProps & { icon: ReactNode; children: ReactNode }) {
  return <DropdownMenu {...props} modal={false}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Special symbols" data-testid="special-symbols-button" onClick={isolateTextMenu} onKeyDown={isolateTextMenu}>{icon}</Button></DropdownMenuTrigger>
    <DropdownMenuContent container={fullscreenContainer()} className="ketcher-ui-menu ketcher-symbols-menu" onClick={isolateTextMenu} onKeyDown={isolateTextMenu} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function KetcherSymbolItems({ symbols, onSelect, renderSymbol }: { symbols: string[]; onSelect: (event: Event, value: string) => void; renderSymbol: (symbol: string) => ReactNode }) {
  return <>{symbols.map(symbol => <DropdownMenuItem key={symbol} textValue={symbol} aria-label={symbol} onSelect={event => onSelect(event, symbol)} className="justify-center">{renderSymbol(symbol)}</DropdownMenuItem>)}</>;
}

export function normalizeHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  return /^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex) ? `#${hex}` : null;
}

export function KetcherColorPicker({ value, onChange, name, colors, Picker }: {
  value: string; onChange: (color: string) => void; name?: string; colors: string[];
  Picker: ComponentType<{ color: string; onChange: (color: string) => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" className="w-full justify-between" aria-label="Choose color" data-testid={open ? "color-picker-field-open" : "color-picker-field"}>
      <span className="size-4 rounded-sm border border-border" style={{ backgroundColor: value }} data-testid={`${name}-color-picker-preview`} aria-hidden="true" />
      <ChevronDown className="size-3" aria-hidden="true" />
    </Button></PopoverTrigger>
    <PopoverContent container={fullscreenContainer()} align="end" className="ketcher-color-picker flex w-52 flex-col gap-3 p-3" data-testid="color-picker-preset"
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
          onKeyDown={event => {
            // Color editing must never submit the enclosing chemistry dialog.
            if (event.key === "Enter") event.stopPropagation();
          }}>
          <div className="flex flex-wrap gap-2">{colors.map(color => <Button key={color} variant="outline" size="icon" className="size-6" aria-label={`Use ${color}`} aria-pressed={color.toLowerCase() === value.toLowerCase()}
            onClick={() => onChange(color)}><span className="size-4 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" /></Button>)}</div>
          <Picker color={value} onChange={onChange} />
          <label className="flex items-center gap-2 text-sm">HEX<Input aria-label="Hex color" name={name ? `${name}-hex` : "hex-color"} autoComplete="off" spellCheck={false} value={draft} data-testid="color-picker-input"
            onChange={event => { const next = event.target.value; setDraft(next); const color = normalizeHexColor(next); if (color) onChange(color); }}
            onBlur={() => { if (!normalizeHexColor(draft)) setDraft(value); }} /></label>
    </PopoverContent>
  </Popover>;
}

export function KetcherFieldLabel({ title, tooltip, after = false }: { title: ReactNode; tooltip?: ReactNode; after?: boolean }) {
  if (!title) return null;
  if (!tooltip) return <span>{title}</span>;
  const hint = <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-5 shrink-0" aria-label={`About ${typeof title === "string" ? title.trim() : "this option"}`} onClick={event => event.preventDefault()}>
    <InfoCircle className="size-3.5" aria-hidden="true" />
  </Button></TooltipTrigger><TooltipContent container={fullscreenContainer()}>{tooltip}</TooltipContent></Tooltip></TooltipProvider>;
  return <span className="inline-flex items-center gap-1.5">{after && hint}<span>{title}</span>{!after && hint}</span>;
}

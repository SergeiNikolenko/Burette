// Development fixture: every DOM menu of the app, open at once on one screen.
// The shell menus are the production components; the viewer and grid menus are
// production class names and stylesheets around representative markup.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HugeiconsIcon } from "@hugeicons/react";
import * as icons from "@/components/ui/app-icon-data";
import {
  Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import {
  ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as Retab from "@/components/ui/retab-dropdown-menu";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import viewerSource from "../../../PreviewExtension/Web/viewer.js?raw";
import viewerCssUrl from "../../../PreviewExtension/Web/viewer-runtime.css?url";
import gridCssUrl from "../../../PreviewExtension/Web/grid.css?url";
import "../src/styles.css";
import "../src/styles/interface-tokens.css";
import "../src/components/workspace-file-header.css";

type Theme = "light" | "dark";
type IconData = typeof icons.Check;

const Icon = ({ icon }: { icon: IconData }) => <HugeiconsIcon icon={icon} strokeWidth={2} />;

function Cell({ title, children }: { title: string; children: (container: HTMLElement) => ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <section className="menu-gallery-cell">
      <h2>{title}</h2>
      <div ref={setContainer}>{container ? children(container) : null}</div>
    </section>
  );
}

const anchor = <DropdownMenuTrigger asChild><span /></DropdownMenuTrigger>;

function ShellMenus({ theme }: { theme: Theme }) {
  return (
    <>
      <Cell title="Dropdown">{container => (
        <DropdownMenu open modal={false}>
          {anchor}
          <DropdownMenuContent container={container}>
            <DropdownMenuLabel>File</DropdownMenuLabel>
            <DropdownMenuItem><Icon icon={icons.Edit} />Rename<DropdownMenuShortcut>⌘R</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem><Icon icon={icons.Copy} />Duplicate<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem><Icon icon={icons.Link} />Copy path<DropdownMenuShortcut>⇧⌘C</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Open in</DropdownMenuLabel>
            <DropdownMenuItem><Icon icon={icons.FolderOpen} />Finder<DropdownMenuShortcut>⌘O</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Icon icon={icons.ExternalLink} />Editor</DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuItem>Ketcher</DropdownMenuItem></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled><Icon icon={icons.Agent} />Agent session</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive"><Icon icon={icons.Delete} />Move to Trash</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}</Cell>
      <Cell title="Checkbox and radio">{container => (
        <DropdownMenu open modal={false}>
          {anchor}
          <DropdownMenuContent container={container}>
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked>Hydrogens</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={false}>Water</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Ligand contacts</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup value="auto">
              <DropdownMenuRadioItem value="auto">Auto</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}</Cell>
      <Cell title="Two-line rows">{container => (
        <DropdownMenu open modal={false}>
          {anchor}
          <DropdownMenuContent container={container} className="workspace-file-menu">
            <DropdownMenuLabel className="radix-menu-group-label">Optimize</DropdownMenuLabel>
            {[["Geometry", "Relax the structure to a minimum"], ["Conformers", "Sample and rank an ensemble"]].map(([label, detail]) => (
              <DropdownMenuItem key={label}>
                <span className="radix-menu-item-body">
                  <HugeiconsIcon icon={icons.Flask} strokeWidth={2} className="radix-menu-item-icon" />
                  <span className="radix-menu-item-copy">
                    <span className="radix-menu-item-label">{label}</span>
                    <span className="radix-menu-item-detail">{detail}</span>
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}</Cell>
      <Cell title="Context menu">{container => <OpenContextMenu container={container} />}</Cell>
      <section className="menu-gallery-cell"><h2>Select</h2><iframe title="Select" className="menu-gallery-select" src={`?only=select&theme=${theme}`} /></section>
      <Cell title="Command palette">{() => (
        <Command className="menu-gallery-command">
          <CommandInput placeholder="Search commands" />
          <CommandList>
            <CommandGroup heading="Files">
              <CommandItem><Icon icon={icons.FileUpload} />Open file<CommandShortcut>⌘O</CommandShortcut></CommandItem>
              <CommandItem><Icon icon={icons.FolderOpen} />Open folder<CommandShortcut>⇧⌘O</CommandShortcut></CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="View">
              <CommandItem><Icon icon={icons.SidebarLeft} />Toggle sidebar<CommandShortcut>⌘B</CommandShortcut></CommandItem>
              <CommandItem><Icon icon={icons.SettingsCog} />Settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )}</Cell>
      <Cell title="Document download">{container => (
        <Retab.DropdownMenu open modal={false}>
          <Retab.DropdownMenuTrigger asChild><span /></Retab.DropdownMenuTrigger>
          <Retab.DropdownMenuContent container={container} align="start">
            <Retab.DropdownMenuLabel>Download</Retab.DropdownMenuLabel>
            <Retab.DropdownMenuItem><Icon icon={icons.Download} />Original file</Retab.DropdownMenuItem>
            <Retab.DropdownMenuItem><Icon icon={icons.FileDocument} />PDF<Retab.DropdownMenuShortcut>⌘P</Retab.DropdownMenuShortcut></Retab.DropdownMenuItem>
            <Retab.DropdownMenuSeparator />
            <Retab.DropdownMenuItem><Icon icon={icons.Copy} />Copy text</Retab.DropdownMenuItem>
          </Retab.DropdownMenuContent>
        </Retab.DropdownMenu>
      )}</Cell>
    </>
  );
}

// Radix opens a context menu only from a contextmenu event, and closes it on any
// outside press; the fixture reopens it so it stays on screen with the others.
function OpenContextMenu({ container }: { container: HTMLElement }) {
  const trigger = useRef<HTMLSpanElement | null>(null);
  const open = () => trigger.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  useEffect(() => { open(); }, []);
  return (
    <ContextMenu modal={false} onOpenChange={value => { if (!value) window.setTimeout(open, 0); }}>
      <ContextMenuTrigger asChild><span ref={trigger} /></ContextMenuTrigger>
      <ContextMenuContent container={container}>
        <ContextMenuLabel>Tab</ContextMenuLabel>
        <ContextMenuItem><Icon icon={icons.Pin} />Pin tab<ContextMenuShortcut>⌥⌘P</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem><Icon icon={icons.CompareArrows} />Compare with…</ContextMenuItem>
        <ContextMenuCheckboxItem checked>Show in sidebar</ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive"><Icon icon={icons.X} />Close tab<ContextMenuShortcut>⌘W</ContextMenuShortcut></ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// An open Radix Select locks page scroll and outside clicks, so the fixture keeps
// it in a frame of its own.
function OpenSelect({ theme }: { theme: Theme }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <div ref={setContainer} className="app-shell menu-gallery menu-gallery-only" data-theme={theme} data-effective-theme={theme}>
      {galleryStyle}
      {container ? (
        <Select open value="cartoon">
          <SelectTrigger className="sr-only"><SelectValue /></SelectTrigger>
          <SelectContent container={container} position="popper">
            <SelectGroup>
              <SelectLabel>Representation</SelectLabel>
              <SelectItem value="cartoon">Cartoon</SelectItem>
              <SelectItem value="ball-and-stick">Ball and stick</SelectItem>
              <SelectItem value="surface">Molecular surface</SelectItem>
              <SelectSeparator />
              <SelectItem value="spacefill" disabled>Spacefill</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

const viewerIconData = JSON.parse(viewerSource.match(/const APP_ICON_DATA = (.*);/)![1]) as Record<string, [string, Record<string, string>][]>;
const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const viewerIcon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${
  viewerIconData[name].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key === "viewBox" ? key : kebab(key)}="${value}"`).join(" ")}/>`).join("")
}</svg>`;
const treeItem = (label: string, icon: string, extra = "") =>
  `<button type="button" role="menuitem" class="buret-tree-menu-item ${extra}"><span class="buret-tree-menu-icon">${viewerIcon(icon)}</span><span class="buret-tree-menu-label">${label}</span></button>`;
const subTrigger = (label: string, icon: string) =>
  `<button type="button" role="menuitem" class="buret-tree-menu-item buret-tree-menu-sub-trigger"><span class="buret-tree-menu-icon">${viewerIcon(icon)}</span><span class="buret-tree-menu-label">${label}</span><span class="buret-tree-menu-chevron">${viewerIcon("ChevronRight")}</span></button>`;
const cell = (title: string, markup: string) => `<section><h2>${title}</h2>${markup}</section>`;

const viewerMenus = [
  cell("Scene tree", `<div class="buret-tree-menu" role="menu">
    <div class="buret-tree-menu-header"><span class="buret-tree-menu-heading">Chain A</span><span class="buret-tree-menu-note">Polymer</span></div>
    ${treeItem("Focus", "Search")}${treeItem("Isolate", "Eye")}${treeItem("Show all", "ArrowRotateCcw")}
    <div class="buret-tree-menu-divider"></div><div class="buret-tree-menu-title">Selection</div>
    ${treeItem("Copy sequence", "Copy")}
    <div class="buret-tree-menu-divider"></div>
    ${treeItem("Remove", "Delete", "buret-tree-menu-item-destructive")}
  </div>`),
  cell("Viewport", `<div class="buret-tree-menu buret-viewport-menu" role="menu">
    <div class="buret-tree-menu-title">Screenshot</div>
    <button type="button" role="menuitemcheckbox" aria-checked="true" class="buret-tree-menu-item"><span class="buret-tree-menu-icon">${viewerIcon("Check")}</span><span class="buret-tree-menu-label">Transparent background</span></button>
    ${treeItem("Copy image", "Copy")}${treeItem("Save image…", "Download")}
    <div class="buret-tree-menu-divider"></div>
    <details class="buret-tree-menu-actions"><summary>Actions</summary></details>
  </div>`),
  cell("Style", `<div class="buret-molstar-preset-menu" role="menu">
    <div class="buret-molstar-preset-menu-section">Style</div>
    <button type="button" role="menuitemradio" aria-checked="true" class="buret-tree-menu-item"><span class="buret-tree-menu-label">Auto</span><span class="buret-molstar-preset-current">Current</span></button>
    <button type="button" role="menuitemradio" aria-checked="false" class="buret-tree-menu-item"><span class="buret-tree-menu-label">Cartoon</span></button>
    <button type="button" role="menuitemradio" aria-checked="false" class="buret-tree-menu-item"><span class="buret-tree-menu-label">Molecular surface</span></button>
    <div class="buret-molstar-preset-menu-separator"></div>
    <div class="buret-molstar-preset-menu-section">Appearance</div>
    <div class="buret-molstar-appearance-group">
      <button type="button" role="menuitemradio" aria-checked="true" class="buret-molstar-appearance-item"><span class="buret-tree-menu-label">Dark</span><span class="buret-molstar-appearance-indicator">✓</span></button>
      <button type="button" role="menuitemradio" aria-checked="false" class="buret-molstar-appearance-item"><span class="buret-tree-menu-label">Light</span></button>
    </div>
  </div>`),
  cell("Compute", `<div class="buret-generate-3d-menu" role="menu">
    <button type="button" role="menuitem">Generate 3D</button>
    <button type="button" role="menuitem">Generate conformer ensemble</button>
    <button type="button" role="menuitem">Optimize geometry</button>
    <button type="button" role="menuitem" disabled>RM1 energy &amp; charges</button>
  </div>`),
  cell("Structure context menu", `<div class="buret-molecule-context-menu" role="menu">
    <div class="buret-molecule-context-menu-title">LEU 83</div>
    <div class="buret-molecule-context-menu-subtitle">Chain A · 8 atoms</div>
    ${treeItem("Focus", "Search")}${subTrigger("Measure", "Chart")}${subTrigger("Representation", "Cube")}
    <div class="buret-tree-menu-divider"></div>
    ${treeItem("Hide", "EyeOff")}${treeItem("Remove", "Delete", "buret-tree-menu-item-destructive")}
  </div>`),
  cell("Structure submenu", `<div class="buret-molecule-context-submenu" role="menu">
    <div class="buret-tree-menu-title">Measure</div>
    ${treeItem("Distance", "Chart")}${treeItem("Angle", "Chart")}${treeItem("Dihedral", "Chart")}
  </div>`),
].join("");

const gridMenus = [
  cell("Grid actions", `<div id="grid-controls"><div class="ab-menu" role="menu">
    <div class="ab-selhead has-selection">12 selected</div>
    <div class="ab-separator"></div>
    <div class="ab-group">File</div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><span class="ab-item-title">Save</span></button></div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><span class="ab-item-title">Save As...</span></button></div>
    <div class="ab-group">Export</div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><span class="ab-item-title">Export selected</span><span class="ab-item-meta">.smi</span></button></div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><span class="ab-item-title">Export selected</span><span class="ab-item-meta">.csv</span></button></div>
    <div class="ab-separator"></div>
    <div class="ab-group">Compute</div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><svg class="ab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg><span class="ab-item-title">Generate 3D</span></button><select class="ab-mini"><option>ETKDG</option></select></div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><svg class="ab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span class="ab-item-title">Optimize geometry</span></button><select class="ab-mini"><option>MMFF94</option></select></div>
    <div class="ab-separator"></div>
    <div class="ab-group">Collection</div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><svg class="ab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span class="ab-item-title">Cluster</span></button></div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item" disabled><svg class="ab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><span class="ab-item-title">Find similar</span></button></div>
    <div class="ab-separator"></div>
    <div class="ab-group">Selection</div>
    <div class="ab-row"><button type="button" role="menuitem" class="ab-item"><svg class="ab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span class="ab-item-title">Copy selected</span></button></div>
  </div></div>`),
  cell("Grid context menu", `<div class="buret-grid-molecule-context-menu" role="menu">
    <div class="buret-grid-molecule-context-menu-title">Imatinib</div>
    <div class="buret-grid-molecule-context-menu-subtitle">Row 14</div>
    <button type="button" role="menuitem">Open in viewer</button>
    <button type="button" role="menuitem">Copy SMILES</button>
    <hr role="separator">
    <button type="button" role="menuitem" disabled>Find similar</button>
    <button type="button" role="menuitem">Remove from collection</button>
  </div>`),
].join("");

// The viewer and grid stylesheets own `body` and theme selectors, so each runs in
// its own document, the way it does in the app. Menus drop their popup
// positioning there and flow in a row.
const frameDocument = (cssUrl: string, theme: Theme, markup: string) => `<!doctype html>
<html data-buret-theme="${theme}"><head><link rel="stylesheet" href="${cssUrl}"><style>
html { color-scheme: ${theme} !important; }
html, body { height: auto !important; min-height: 0 !important; margin: 0; overflow: hidden; background: transparent !important; }
body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px 20px; padding: 4px 4px 20px; font: 400 13px -apple-system, BlinkMacSystemFont, sans-serif; }
h2 { margin: 0 0 8px; color: ${theme === "dark" ? "#a3a3a3" : "#737373"}; font-size: 12px; font-weight: 500; }
section [role="menu"] { position: static !important; display: block; max-height: none !important; animation: none; }
#grid-controls { position: static; container-type: normal; }
</style></head><body class="buret-theme-${theme}">${markup}</body></html>`;

function Frame({ cssUrl, theme, markup }: { cssUrl: string; theme: Theme; markup: string }) {
  const [height, setHeight] = useState(320);
  return (
    <iframe
      title="Menus"
      srcDoc={frameDocument(cssUrl, theme, markup)}
      style={{ height }}
      onLoad={event => setHeight(event.currentTarget.contentDocument!.documentElement.scrollHeight)}
    />
  );
}

const galleryStyle = (
  <style>{`
        html, body, #root { height: auto; overflow: visible; background: transparent; }
        .app-shell.menu-gallery { display: flex; flex-flow: row wrap; width: auto; height: auto; align-items: flex-start; gap: 16px 20px; min-height: 100vh; padding: 16px 20px; background: var(--surface-primary); color: var(--text-primary); }
        .menu-gallery h2 { margin: 0 0 8px; color: var(--text-muted); font-size: 12px; font-weight: 500; }
        .menu-gallery-cell { padding: 4px; }
        .menu-gallery [data-radix-popper-content-wrapper] { position: static !important; transform: none !important; }
        .menu-gallery-command { width: 280px; height: auto; box-shadow: 0 8px 16px -4px rgb(0 0 0 / 0.12), 0 0 0 0.5px color-mix(in srgb, var(--popover-foreground) 8%, transparent); }
        .menu-gallery iframe { flex: 0 0 100%; width: 100%; border: 0; }
        .menu-gallery iframe.menu-gallery-select { display: block; width: 200px; height: 190px; }
        .app-shell.menu-gallery-only { display: block; min-height: 0; padding: 4px; background: transparent; }
        .menu-gallery-only [data-slot="select-content"] { max-height: none; }
        .menu-gallery-theme { position: fixed; top: 12px; right: 16px; z-index: 100; }
      `}</style>
);

function Gallery() {
  const [theme, setTheme] = useState<Theme>("light");
  return (
    <div className="app-shell menu-gallery" data-theme={theme} data-effective-theme={theme}>
      {galleryStyle}
      <button type="button" className="menu-gallery-theme" aria-label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
        <HugeiconsIcon icon={theme === "light" ? icons.ThemeDark : icons.ThemeLight} strokeWidth={2} />
      </button>
      <ShellMenus theme={theme} />
      <Frame cssUrl={viewerCssUrl} theme={theme} markup={viewerMenus} />
      <Frame cssUrl={gridCssUrl} theme={theme} markup={gridMenus} />
    </div>
  );
}

const query = new URLSearchParams(window.location.search);
const frameTheme: Theme = query.get("theme") === "dark" ? "dark" : "light";
// A frame whose colour scheme differs from its host paints an opaque canvas.
if (query.get("only") === "select") document.documentElement.style.colorScheme = frameTheme;
createRoot(document.getElementById("root")!).render(
  query.get("only") === "select" ? <OpenSelect theme={frameTheme} /> : <Gallery />,
);

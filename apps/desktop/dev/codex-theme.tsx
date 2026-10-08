// Development fixture: the Codex theme tokens and the app's shared controls in
// both appearances on one screen. Colors come from the production theme code.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { buildThemeStyle, type ThemeMode } from "@/lib/theme";
import { defaultPreferences } from "@/stores/settings-store";
import "../src/styles.css";
import "../src/styles/codex-tokens.css";
import "../src/styles/interface-tokens.css";

const SURFACES = [
  ["Sidebar", "--color-token-side-bar-background"],
  ["Main surface", "--color-token-main-surface-primary"],
  ["Panel", "--color-background-panel"],
  ["Control", "--color-background-control-opaque"],
  ["Menu", "--color-token-dropdown-background"],
  ["Row hover", "--color-token-list-hover-background"],
  ["Primary", "--color-background-primary-solid"],
  ["Accent", "--codex-base-accent"],
  ["Info soft", "--color-background-info-soft"],
  ["Success", "--color-background-success-solid"],
  ["Warning", "--color-background-warning-solid"],
  ["Danger", "--color-background-danger-solid"],
];
const TEXT = [
  ["Primary text", "--color-text-primary"],
  ["Secondary text", "--color-text-secondary"],
  ["Tertiary text", "--color-text-tertiary"],
  ["Accent text", "--app-color-text-accent"],
  ["Success text", "--color-text-success"],
  ["Danger text", "--color-text-danger"],
];
const BORDERS = [["Subtle", "--color-border-subtle"], ["Default", "--color-border"], ["Strong", "--color-border-strong"]];

function Appearance({ mode }: { mode: ThemeMode }) {
  // Each appearance is its own token scope, so overlays portal into their own shell.
  const [shell, setShell] = useState<HTMLDivElement | null>(null);
  const [method, setMethod] = useState("gfn2");
  return (
    <div ref={setShell} className="app-shell theme-fixture" data-theme={mode} data-effective-theme={mode} style={buildThemeStyle({ ...defaultPreferences, theme: mode }, mode)}>
      <aside>
        <h2>{mode === "light" ? "Light" : "Dark"}</h2>
        {["Home", "Structures", "Trajectories", "Settings"].map((label, index) => (
          <div key={label} className="theme-fixture-row" data-active={index === 1}>{label}</div>
        ))}
      </aside>
      <main>
        <section>
          <h3>Surfaces</h3>
          <div className="theme-fixture-swatches">
            {SURFACES.map(([label, token]) => (
              <figure key={token}><span style={{ background: `var(${token})` }} /><figcaption>{label}</figcaption></figure>
            ))}
          </div>
        </section>
        <section>
          <h3>Text and borders</h3>
          <div className="theme-fixture-text">
            {TEXT.map(([label, token]) => <span key={token} style={{ color: `var(${token})` }}>{label}</span>)}
          </div>
          <div className="theme-fixture-borders">
            {BORDERS.map(([label, token]) => <span key={token} style={{ borderColor: `var(${token})` }}>{label}</span>)}
          </div>
        </section>
        <section>
          <h3>Controls</h3>
          <div className="theme-fixture-controls" aria-label="Atlas buttons">
            <Button size="xs">Solid</Button>
            <Button size="xs" variant="secondary">Soft</Button>
            <Button size="xs" variant="ghost">Ghost</Button>
            <Button size="xs" variant="outline">Surface</Button>
            <Button size="xs" variant="link" data-color="primary">Transparent</Button>
          </div>
          <div className="theme-fixture-controls">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="theme-fixture-controls">
            <Button size="xs">Pill</Button>
            <Button size="xs" variant="secondary">Pill</Button>
            <Button size="sm" variant="outline">Toolbar</Button>
            <Button size="sm" variant="ghost">Toolbar</Button>
          </div>
          <div className="theme-fixture-controls">
            <Input aria-label="Search structures" placeholder="Search structures" style={{ width: 200 }} />
            <Switch aria-label="Enabled switch" defaultChecked />
            <Switch aria-label="Off switch" />
            <Switch aria-label="Small switch" size="sm" defaultChecked />
            <Switch aria-label="Neutral switch" tone="neutral" defaultChecked />
            <Switch aria-label="Disabled switch" disabled defaultChecked />
            <Checkbox aria-label="Checked" defaultChecked />
            <Checkbox aria-label="Unchecked" />
            <Checkbox aria-label="Indeterminate" checked="indeterminate" />
            <Checkbox aria-label="Disabled" disabled />
            <Checkbox aria-label="Disabled checked" disabled defaultChecked />
            <Badge>Ready</Badge>
            <Badge variant="secondary">Draft</Badge>
            <Kbd>⌘K</Kbd>
          </div>
          <div className="theme-fixture-controls">
            <Tabs defaultValue="3d"><TabsList><TabsTrigger value="3d">3D</TabsTrigger><TabsTrigger value="2d">2D</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList></Tabs>
            <Slider defaultValue={[60]} max={100} style={{ width: 160 }} />
          </div>
          <div className="theme-fixture-controls">
            <SegmentedControl aria-label="Calculation method" value={method} onValueChange={setMethod}>
              <SegmentedControlItem value="gfn2">GFN2</SegmentedControlItem>
              <SegmentedControlItem value="gfn1">GFN1</SegmentedControlItem>
              <SegmentedControlItem value="gfn0" disabled>GFN0</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div className="theme-fixture-controls">
            <RadioGroup defaultValue="atoms" aria-label="Selection">
              <RadioGroupItem value="atoms">Atoms</RadioGroupItem>
              <RadioGroupItem value="residues">Residues</RadioGroupItem>
              <RadioGroupItem value="chains" disabled>Chains</RadioGroupItem>
            </RadioGroup>
            <Spinner />
            <LoadingIndicator size="sm" />
            <LoadingIndicator />
            <LoadingIndicator size="lg" />
          </div>
        </section>
        <section>
          <h3>Fields</h3>
          <div className="theme-fixture-controls">
            <Input variant="field" aria-label="Column name" placeholder="Column name" />
            <Input variant="compact" aria-label="Compact search" placeholder="Find a column" />
            <Input variant="code" aria-label="Expression" defaultValue="mass / count" spellCheck={false} />
            <Input variant="field" aria-label="Invalid column" aria-invalid defaultValue="Existing column" />
            <Input variant="field" aria-label="Locked column" disabled defaultValue="Read-only column" />
            <Input variant="field" aria-label="Maximum rows" type="number" min={1} max={500} defaultValue={100} />
          </div>
        </section>
        <section aria-label="Status messages" className="grid gap-3">
          <Alert><AlertTitle>Structure saved</AlertTitle></Alert>
          <Alert variant="destructive"><AlertTitle>Could not load structure</AlertTitle><AlertDescription>Choose another file.</AlertDescription></Alert>
          <Alert><AlertDescription>Attach the matching topology to show elements, residues and bonds.</AlertDescription>
            <AlertAction><Button variant="outline" size="xs" disabled>Attaching…</Button></AlertAction>
          </Alert>
        </section>
        <section>
          <h3>Overlays</h3>
          <div className="theme-fixture-controls" style={{ gap: 96, paddingBottom: 72 }}>
            <TooltipProvider>
              <Tooltip open>
                <TooltipTrigger asChild><Button size="sm" variant="ghost">Tooltip</Button></TooltipTrigger>
                <TooltipContent side="bottom" container={shell}><span className="inline-flex items-center gap-1.5">Search <Kbd>⌘K</Kbd></span></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Popover open>
              <PopoverTrigger asChild><Button size="sm" variant="outline">Popover</Button></PopoverTrigger>
              <PopoverContent side="bottom" align="start" container={shell} onOpenAutoFocus={(event) => event.preventDefault()}><div className="px-2 py-1.5 text-sm">Sort by name</div></PopoverContent>
            </Popover>
            <Dialog>
              <DialogTrigger asChild><Button size="sm" variant="secondary">Dialog</Button></DialogTrigger>
              <DialogContent container={shell}>
                <DialogHeader>
                  <DialogTitle>Rename project</DialogTitle>
                  <DialogDescription>The folder on disk keeps its name.</DialogDescription>
                </DialogHeader>
                <Input aria-label="Project name" defaultValue="samples" />
                <DialogFooter>
                  <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                  <DialogClose asChild><Button>Save</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <style>{`
      html, body, #root { height: auto; overflow: auto; }
      #root { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
      .app-shell.theme-fixture { display: flex; flex-direction: row; width: auto; height: auto; min-height: 100vh; background: var(--color-token-side-bar-background); color: var(--text-primary); backdrop-filter: none; }
      .theme-fixture aside { flex: 0 0 168px; padding: 16px 8px; }
      .theme-fixture aside h2 { margin: 0 8px 12px; font-size: 13px; font-weight: 500; color: var(--text-muted); }
      .theme-fixture main > section > h3 { margin: 0 0 10px; font-size: 13px; font-weight: 500; color: var(--text-secondary); }
      .theme-fixture-row { padding: 5px 8px; border-radius: 10px; font-size: 13px; line-height: 20px; }
      .theme-fixture-row[data-active="true"] { background: var(--surface-selected); }
      .theme-fixture main { flex: 1; margin: 8px 8px 8px 0; padding: 20px; border-radius: 12px; background: var(--surface-primary); box-shadow: var(--app-shell-page-surface-shadow); display: flex; flex-direction: column; gap: 24px; }
      .theme-fixture-swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .theme-fixture figure { margin: 0; }
      .theme-fixture figure span { display: block; height: 40px; border-radius: 10px; box-shadow: 0 0 0 0.5px var(--color-border-strong); }
      .theme-fixture figcaption { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
      .theme-fixture-text { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; }
      .theme-fixture-borders { display: flex; gap: 10px; margin-top: 10px; }
      .theme-fixture-borders span { padding: 6px 12px; border: 1px solid; border-radius: 10px; font-size: 12px; color: var(--text-secondary); }
      .theme-fixture-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
    `}</style>
    <Appearance mode="light" />
    <Appearance mode="dark" />
  </>,
);

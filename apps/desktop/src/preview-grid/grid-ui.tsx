import React from "react";
import { Copy, Cube, Download, Edit, Grid, Search } from "../components/ui/app-icons";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { GridSelectMenu } from "./grid-select-menu";
import { NativeSelectControl } from "../components/ui/native-select-control";
import { SearchInput } from "../components/ui/search-input";
import { gridAtlasStyles } from "./grid-atlas-styles";
import { codexThemeColors } from "../lib/codex-theme";
import { SegmentedControl as AtlasSegmentedControl, SegmentedControlItem } from "../components/ui/segmented-control";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";

type SortOption = {
  value: string;
  label: string;
};

type XyzrenderPresetOption = {
  value: string;
  label: string;
};

type SemiempiricalMethod = "RM1" | "AM1" | "PM3" | "PM6" | "PM6_D" | "PM6_D3H4" | "PM6_SP" | "AM1_STAR";
type ConformerVariant = "DG" | "KDG" | "ETDG" | "ETDGv2" | "ETKDG" | "ETKDGv2" | "ETKDGv3" | "srETKDGv3";
type MmffVariant = "MMFF94" | "MMFF94s";

const CONFORMER_VARIANTS: ConformerVariant[] = [
  "DG", "KDG", "ETDG", "ETDGv2", "ETKDG", "ETKDGv2", "ETKDGv3", "srETKDGv3",
];
const MMFF_VARIANTS: MmffVariant[] = ["MMFF94", "MMFF94s"];
const SEMIEMPIRICAL_METHODS: SemiempiricalMethod[] = [
  "RM1", "AM1", "PM3", "PM6", "PM6_D", "PM6_D3H4", "PM6_SP", "AM1_STAR",
];
const CLUSTER_CUTOFFS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9];

function semiempiricalLabel(method: SemiempiricalMethod) {
  return method === "AM1_STAR" ? "AM1*" : method;
}

type GridControlProps = {
  format: "csv" | "dwar" | "sdf" | "smiles" | "tsv";
  label: string;
  exportEnabled: boolean;
  selectionEnabled: boolean;
  substructureSearch: boolean;
  exportScopeLabel: string;
  exportPending: boolean;
  supportsXyzrenderCards: boolean;
  viewMode: "cards" | "table";
  cardRenderer: "rdkit" | "xyzrender";
  xyzrenderPreset: string;
  xyzrenderPresetOptions: XyzrenderPresetOption[];
  hydrogenDisplay: HydrogenDisplay;
  ketcherOpen: boolean;
  molstarOpen: boolean;
  ketcherPending: boolean;
  selectableCount: number;
  allVisibleSelected: boolean;
  rendererSwitch: boolean;
  generating3d: boolean;
  aligningPoses: boolean;
  evaluatingSemiempirical: boolean;
  semiempiricalEnabled: boolean;
  semiempiricalMethod: SemiempiricalMethod;
  conformerVariant: ConformerVariant;
  mmffVariant: MmffVariant;
  clusterEnabled: boolean;
  clustering: boolean;
  findingSimilar: boolean;
  exportingClusterRepresentatives: boolean;
  clusterRepresentativesAvailable: boolean;
  similarityQuerySelected: boolean;
  clusterCutoff: number;
  selectedCount: number;
  selectedInput3d: boolean;
  // Collection edit state. grid-viewer also writes these onto the buttons by id,
  // but the overflow menu only exists in the DOM while it is open, so its items
  // have to render the right state from props on the way in.
  saveEnabled: boolean;
  saveAsEnabled: boolean;
  undoEnabled: boolean;
  saveTitle: string;
  saveAsTitle: string;
  undoTitle: string;
  sortOptions: SortOption[];
  searchQuery: string;
  onSearchInput: (value: string) => void;
  onSortChange: (value: string) => void;
  onShowProperties: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCluster: () => void;
  onFindSimilar: () => void;
  onExportClusterRepresentatives: () => void;
  onClusterCutoffChange: (value: number) => void;
  onCopySelected: () => void;
  onSaveGrid: () => void;
  onSaveGridAs: () => void;
  onUndoGridEdit: () => void;
  onExportSmiles: () => void;
  onExportCSV: () => void;
  onViewModeChange: (value: "cards" | "table") => void;
  onToggleTableColumns: () => void;
  onToggleTableFilters: () => void;
  onSetCardRenderer: (value: "rdkit" | "xyzrender") => void;
  onXyzrenderPresetChange: (value: string) => void;
  onHydrogenDisplayChange: (value: HydrogenDisplay) => void;
  onOpenKetcher: () => void;
  onAlignSelectedPoses: () => void;
  onEvaluateSemiempirical: () => void;
  onSemiempiricalMethodChange: (value: SemiempiricalMethod) => void;
  onGenerate3D: () => void;
  onOptimizeGeometry: () => void;
  onCalculateSelectedDescriptors: () => void;
  onConformerVariantChange: (value: ConformerVariant) => void;
  onMmffVariantChange: (value: MmffVariant) => void;
  onRendererSwitch: (value: "molstar") => void;
  onRdkitUseInputCoordsChange: (checked: boolean) => void;
};

type HydrogenDisplay = "all" | "none";

type GridUIApi = {
  mountGridControls: (container: Element, props: GridControlProps) => void;
  themeColors: typeof codexThemeColors;
};

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

declare global {
  interface Window {
    BuretteNativeViewerMenus?: { show(menu: HTMLElement, options: {
      x: number; y: number; post: (body: Record<string, unknown>) => boolean; close: () => void;
    }): boolean };
    BuretteGridUI?: GridUIApi;
  }
}

const roots = new WeakMap<Element, Root>();

function ControlTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const [boundary, setBoundary] = React.useState<HTMLElement | null>(null);
  return <Tooltip onOpenChange={open => { if (open) setBoundary(document.getElementById("grid-controls")); }}>
    <TooltipTrigger asChild aria-description={label}>{children}</TooltipTrigger>
    <TooltipContent variant="floating" side="bottom" collisionBoundary={boundary} collisionPadding={6}>{label}</TooltipContent>
  </Tooltip>;
}

function Icon({ paths }: { paths: React.ReactNode }) {
  return (
    <svg
      className="ab-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

const ICONS = {
  generate3d: <Cube className="ab-ico" aria-hidden="true" />,
  optimize: <Icon paths={<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>} />,
  energy: <Icon paths={<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />} />,
  align: <Icon paths={<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /></>} />,
  cluster: <Grid className="ab-ico" aria-hidden="true" />,
  findSimilar: <Search className="ab-ico" aria-hidden="true" />,
  exportDiverse: <Download className="ab-ico" aria-hidden="true" />,
  copy: <Copy className="ab-ico" aria-hidden="true" />,
};

function MiniSelect<T extends string>({ value, options, ariaLabel, disabled, formatOption, onChange }: {
  value: T;
  options: T[];
  ariaLabel: string;
  disabled?: boolean;
  formatOption?: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <GridSelectMenu>
      <NativeSelectControl size="sm"
        className="ab-mini"
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{formatOption ? formatOption(option) : option}</option>
        ))}
      </NativeSelectControl>
    </GridSelectMenu>
  );
}

function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  dataAttribute,
  onChange,
}: {
  ariaLabel: string;
  options: SegmentedOption<T>[];
  value: T;
  dataAttribute: string;
  onChange: (value: T) => void;
}) {
  return (
    <AtlasSegmentedControl aria-label={ariaLabel} value={value} onValueChange={next => onChange(next as T)}>
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          data-buret-grid-segment={dataAttribute}
          data-buret-grid-segment-value={option.value}
          {...{ [`data-${dataAttribute}`]: option.value }}
          aria-pressed={value === option.value ? "true" : "false"}
          disabled={option.disabled}
        >
          {option.label}
        </SegmentedControlItem>
      ))}
    </AtlasSegmentedControl>
  );
}

function XyzrenderStyleControl(props: GridControlProps) {
  if (!props.supportsXyzrenderCards) return null;
  return (
    <label
      id="xyzrender-preset-control"
      className="buret-grid-xyzrender-preset-control"
      hidden={props.cardRenderer !== "xyzrender"}
    >
      Style
      <GridSelectMenu>
        <NativeSelectControl size="sm"
          id="xyzrender-preset"
          className="ab-mini"
          value={props.xyzrenderPreset}
          disabled={props.cardRenderer !== "xyzrender"}
          aria-label="3D card style"
          onChange={(event) => props.onXyzrenderPresetChange(event.currentTarget.value)}
        >
          {props.xyzrenderPresetOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </NativeSelectControl>
      </GridSelectMenu>
    </label>
  );
}

// React owns the pressed state here: grid-viewer re-renders the toolbar with the
// new mode instead of syncing this button by id.
function HydrogenToggle(props: GridControlProps) {
  if (!props.substructureSearch) return null;
  const shown = props.hydrogenDisplay === "all";
  return (
    <ControlTooltip label={shown ? "Hide hydrogens" : "Show all hydrogens"}>
    <Button variant="ghost" size="sm"
      id="grid-hydrogens"
      className="ab-btn"
      type="button"
      aria-pressed={shown ? "true" : "false"}
      aria-label="Show hydrogens"
      onClick={() => props.onHydrogenDisplayChange(shown ? "none" : "all")}
    >
      H
    </Button>
    </ControlTooltip>
  );
}

// Keep actual buttons: the native adapter and grid-viewer dispatch and update
// them by id. Radix adds the shared item geometry and roving keyboard focus.
function ActionItem(props: React.ComponentProps<"button">) {
  return <DropdownMenuItem asChild disabled={props.disabled}><button {...props} /></DropdownMenuItem>;
}

function ComputeSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  const noSelection = props.selectedCount === 0;
  const needs3d = !noSelection && !props.selectedInput3d;
  return (
    <>
      <DropdownMenuLabel className="ab-group">Compute</DropdownMenuLabel>
      <div className="ab-row">
        <ActionItem
          id="generate-3d-selected"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.generating3d || noSelection}
          aria-description="Generate and selected-MMFF-optimize conformers for selected molecules"
          onClick={() => props.onRun(props.onGenerate3D)}
        >
          {ICONS.generate3d}
          <span className="ab-item-title" data-buret-grid-generate-3d-label>
            {props.generating3d ? "Generating…" : "Generate 3D"}
          </span>
        </ActionItem>
        <MiniSelect
          ariaLabel="Conformer generation method"
          value={props.conformerVariant}
          options={CONFORMER_VARIANTS}
          disabled={props.generating3d}
          onChange={props.onConformerVariantChange}
        />
      </div>
      <div className="ab-row">
        <ActionItem
          id="optimize-geometry-selected"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.generating3d || noSelection || !props.selectedInput3d}
          aria-description={needs3d ? "Generate 3D coordinates for every selected molecule first" : "Optimize selected input 3D coordinates with the chosen MMFF variant on Metal"}
          onClick={() => props.onRun(props.onOptimizeGeometry)}
        >
          {ICONS.optimize}
          <span className="ab-item-title">{props.generating3d ? "Working…" : "Optimize geometry"}</span>
        </ActionItem>
        <MiniSelect
          ariaLabel="MMFF optimization variant"
          value={props.mmffVariant}
          options={MMFF_VARIANTS}
          disabled={props.generating3d}
          onChange={props.onMmffVariantChange}
        />
      </div>
      {props.semiempiricalEnabled ? (
        <div className="ab-row">
          <ActionItem
            id="calculate-semiempirical-selected"
            className="ab-item"
            type="button"
            role="menuitem"
            disabled={props.evaluatingSemiempirical || noSelection || !props.selectedInput3d}
            aria-busy={props.evaluatingSemiempirical ? "true" : "false"}
            aria-description={needs3d ? "Generate 3D coordinates for every selected molecule first" : "Calculate native semi-empirical energies and atomic charges and write them to Grid"}
            onClick={() => props.onRun(props.onEvaluateSemiempirical)}
          >
            {ICONS.energy}
            <span className="ab-item-title">
              {props.evaluatingSemiempirical ? "Calculating…" : "Energy & charges"}
            </span>
          </ActionItem>
          <MiniSelect
            ariaLabel="Semi-empirical method"
            value={props.semiempiricalMethod}
            options={SEMIEMPIRICAL_METHODS}
            disabled={props.evaluatingSemiempirical}
            formatOption={semiempiricalLabel}
            onChange={props.onSemiempiricalMethodChange}
          />
        </div>
      ) : null}
      <div className="ab-row">
        <ActionItem
          id="align-selected-poses"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.aligningPoses || props.selectedCount < 2 || !props.selectedInput3d}
          aria-busy={props.aligningPoses ? "true" : "false"}
          aria-description={needs3d ? "Generate 3D coordinates for every selected molecule first" : "Align selected 3D poses to the first selected row on Metal and write scores to Grid"}
          onClick={() => props.onRun(props.onAlignSelectedPoses)}
        >
          {ICONS.align}
          <span className="ab-item-title">{props.aligningPoses ? "Aligning…" : "Align & compare"}</span>
        </ActionItem>
      </div>
    </>
  );
}

function CollectionSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  if (!props.clusterEnabled) return null;
  const clusterBusy = props.clustering || props.findingSimilar;
  return (
    <>
      <DropdownMenuSeparator className="ab-separator" />
      <DropdownMenuLabel className="ab-group">Collection</DropdownMenuLabel>
      <div className="ab-row">
        <ActionItem
          id="cluster-molecules"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.findingSimilar}
          aria-busy={props.clustering ? "true" : "false"}
          aria-description="Cluster selected, filtered, or all molecules"
          onClick={() => props.onRun(props.onCluster)}
        >
          {ICONS.cluster}
          <span className="ab-item-title" data-buret-grid-cluster-label>
            {props.clustering
              ? "Cancel clustering"
              : props.selectedCount
                ? `Cluster selected (${props.selectedCount.toLocaleString()})`
                : "Cluster all"}
          </span>
        </ActionItem>
        <GridSelectMenu>
          <NativeSelectControl size="sm"
            id="cluster-cutoff"
            className="ab-mini"
            aria-label="Tanimoto similarity cutoff"
            value={props.clusterCutoff.toFixed(2)}
            disabled={clusterBusy}
            onChange={(event) => props.onClusterCutoffChange(Number(event.currentTarget.value))}
          >
            {CLUSTER_CUTOFFS.map((cutoff) => (
              <option key={cutoff} value={cutoff.toFixed(2)}>{cutoff.toFixed(2)}</option>
            ))}
          </NativeSelectControl>
        </GridSelectMenu>
      </div>
      <div className="ab-row">
        <ActionItem
          id="find-similar-molecules"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={clusterBusy || !props.clusterRepresentativesAvailable || !props.similarityQuerySelected}
          aria-busy={props.findingSimilar ? "true" : "false"}
          aria-description="Find the top 50 matches to the single selected molecule in the latest clustered snapshot"
          onClick={() => props.onRun(props.onFindSimilar)}
        >
          {ICONS.findSimilar}
          <span className="ab-item-title" data-buret-grid-similarity-label>
            {props.findingSimilar ? "Searching…" : "Find similar"}
          </span>
        </ActionItem>
      </div>
      <div className="ab-row">
        <ActionItem
          id="export-cluster-representatives"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={
            props.clustering
            || props.exportingClusterRepresentatives
            || !props.clusterRepresentativesAvailable
          }
          aria-busy={props.exportingClusterRepresentatives ? "true" : "false"}
          aria-description="Export the immutable representative subset, structures, table, and provenance report"
          onClick={() => props.onRun(props.onExportClusterRepresentatives)}
        >
          {ICONS.exportDiverse}
          <span className="ab-item-title" data-buret-grid-representative-export-label>
            {props.exportingClusterRepresentatives ? "Exporting…" : "Export diverse"}
          </span>
        </ActionItem>
      </div>
    </>
  );
}

function SelectionSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  const noSelection = props.selectedCount === 0;
  return (
    <>
      <DropdownMenuSeparator className="ab-separator" />
      <DropdownMenuLabel className="ab-group">Selection</DropdownMenuLabel>
      <div className="ab-row">
        <ActionItem
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={noSelection}
          aria-description="Copy selected molecule records"
          onClick={() => props.onRun(props.onCopySelected)}
        >
          {ICONS.copy}
          <span className="ab-item-title">Copy selected</span>
        </ActionItem>
      </div>
    </>
  );
}

function FileSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  if (!props.exportEnabled) return null;
  return (
    <>
      <DropdownMenuLabel className="ab-group">File</DropdownMenuLabel>
        <div className="ab-row">
          <ActionItem
            id="save-grid"
            className="ab-item"
            type="button"
            role="menuitem"
            disabled={!props.saveEnabled}
            title={props.saveTitle}
            onClick={() => props.onRun(props.onSaveGrid)}
          >
            <span className="ab-item-title">Save</span>
          </ActionItem>
        </div>
        <div className="ab-row">
          <ActionItem
            id="undo-grid-edit"
            className="ab-item"
            type="button"
            role="menuitem"
            disabled={!props.undoEnabled}
            title={props.undoTitle}
            onClick={() => props.onRun(props.onUndoGridEdit)}
          >
            <span className="ab-item-title">Undo</span>
          </ActionItem>
        </div>
        <div className="ab-row">
          <ActionItem
            id="save-grid-as"
            className="ab-item"
            type="button"
            role="menuitem"
            disabled={!props.saveAsEnabled}
            title={props.saveAsTitle}
            onClick={() => props.onRun(props.onSaveGridAs)}
          >
            <span className="ab-item-title">Save as…</span>
          </ActionItem>
        </div>
      <DropdownMenuLabel className="ab-group">Export</DropdownMenuLabel>
      <div className="ab-row">
        <ActionItem
          id="export-smi"
          className="ab-item"
          type="button"
          role="menuitem"
          title={`Export ${props.exportScopeLabel} as SMILES`}
          disabled={props.exportPending}
          onClick={() => props.onRun(props.onExportSmiles)}
        >
          <span className="ab-item-title">Export {props.exportScopeLabel}</span>
          <span className="ab-item-meta">.smi</span>
        </ActionItem>
      </div>
      <div className="ab-row">
        <ActionItem
          id="export-csv"
          className="ab-item"
          type="button"
          role="menuitem"
          title={`Export ${props.exportScopeLabel} as CSV`}
          disabled={props.exportPending}
          onClick={() => props.onRun(props.onExportCSV)}
        >
          <span className="ab-item-title">Export {props.exportScopeLabel}</span>
          <span className="ab-item-meta">.csv</span>
        </ActionItem>
      </div>
    </>
  );
}

function ActionsMenu(props: GridControlProps) {
  const [open, setOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<HTMLDivElement | null>(null);
  const [cover, setCover] = React.useState(0);
  const trigger = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const host = document.getElementById("grid-controls");
    if (!host) return;
    const update = () => setCover(Number(host.dataset.viewportCover) || 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [open]);
  React.useEffect(() => {
    const config = (window as Window & { BuretteConfig?: { appViewer?: boolean } }).BuretteConfig;
    if (!open || !menu || config?.appViewer !== true || window.parent === window) return;
    const rect = trigger.current?.getBoundingClientRect();
    window.BuretteNativeViewerMenus?.show(menu, {
      x: rect?.left ?? 0, y: rect?.bottom ?? 0,
      post: body => { window.parent.postMessage({ source: 'burette-grid', body }, '*'); return true; },
      close: () => setOpen(false),
    });
  }, [open, menu]);
  const onRun = (action: () => void) => {
    // Close before handing off to a dialog, editor or changing the document.
    flushSync(() => setOpen(false));
    action();
  };
  return (
    <div className="ab-menu-wrap ab-actions-menu">
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="sm" className="ab-btn" type="button">Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={setMenu} className="ab-menu" align="end"
          collisionPadding={{ top: 6, bottom: 6, left: 6, right: cover + 6 }}
          onInteractOutside={event => {
            // The inline select owns a separate portal and focus scope.
            if ((event.target as Element).closest?.("[data-buret-grid-select-menu]")) event.preventDefault();
          }}>
          {props.selectedCount > 0 ? <DropdownMenuLabel className="ab-selhead">
            {props.selectedCount.toLocaleString()} selected
          </DropdownMenuLabel> : null}
          <FileSection {...props} onRun={onRun} />
          {props.clusterEnabled ? <ComputeSection {...props} onRun={onRun} /> : null}
          <CollectionSection {...props} onRun={onRun} />
          <SelectionSection {...props} onRun={onRun} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function GridActionToolbar(props: GridControlProps) {
  const showRendererSwitch = (props.substructureSearch || props.rendererSwitch) && props.supportsXyzrenderCards;
  return (
    <div
      className="buret-toolbar-row buret-toolbar-row-view buret-actionbar"
      role="toolbar"
      aria-label="Grid actions"
    >
      <SegmentedControl
        ariaLabel="Grid view mode"
        dataAttribute="buret-grid-view-mode"
        value={props.viewMode}
        onChange={props.onViewModeChange}
        options={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards" },
        ]}
      />
      <span className="ab-divider" aria-hidden="true" />
      {/* grid-viewer owns the `hidden` attribute on both: Columns in table view,
          Properties in cards view. Never pass `hidden` here or React would
          fight that sync. */}
      <ControlTooltip label="Choose visible table columns"><Button variant="ghost" size="sm"
        id="table-columns"
        className="ab-btn"
        type="button"
        aria-pressed="false"
        onClick={props.onToggleTableColumns}
      >
        Columns
      </Button></ControlTooltip>
      <ControlTooltip label="Show molecule properties in cards"><Button variant="ghost" size="sm"
        id="show-properties"
        className="ab-btn"
        type="button"
        aria-pressed="false"
        onClick={props.onShowProperties}
      >
        Properties
      </Button></ControlTooltip>
      {showRendererSwitch ? (
        <label className="buret-renderer-control">
          <span className="buret-visually-hidden">Molecule view</span>
          <GridSelectMenu>
            <NativeSelectControl size="sm"
              id="card-renderer"
              value={props.cardRenderer}
              aria-label="Molecule view"
              onChange={(event) => props.onSetCardRenderer(event.currentTarget.value as "rdkit" | "xyzrender")}
            >
              <option value="rdkit">2D diagrams</option>
              <option value="xyzrender">3D renders</option>
            </NativeSelectControl>
          </GridSelectMenu>
        </label>
      ) : null}
      <XyzrenderStyleControl {...props} />
      <HydrogenToggle {...props} />
      {/* A pressed-state button rather than a checkbox: grid-viewer owns both the
          `hidden` on the wrapper and the pressed state on the button by id. */}
      <span id="rdkit-use-input-coords-control" className="buret-rdkit-coords-control" hidden>
        <ControlTooltip label="2D diagram / 3D file coordinates"><Button variant="ghost" size="sm"
          id="rdkit-use-input-coords"
          className="ab-btn"
          type="button"
          aria-pressed="false"
          aria-label="Use file coords"
          onClick={(event) => props.onRdkitUseInputCoordsChange(
            event.currentTarget.getAttribute("aria-pressed") !== "true",
          )}
        >
          <span data-coordinate-mode>2D</span>
        </Button></ControlTooltip>
      </span>
      <span className="ab-spacer" aria-hidden="true" />
      {props.selectionEnabled ? (
        <div className="buret-selection-actions" role="group" aria-label="Selection">
          <ControlTooltip label="Select all visible molecules"><Button variant="ghost" size="sm" id="select-all" className="ab-btn" type="button"
            disabled={props.selectableCount === 0 || props.allVisibleSelected}
            onClick={props.onSelectAll}>
            Select all
          </Button></ControlTooltip>
          {props.selectedCount > 0 ? <>
            <span className="buret-selection-count" role="status">{props.selectedCount.toLocaleString()} selected</span>
            <Button variant="ghost" size="sm" id="clear-selection" className="ab-btn" type="button"
              aria-label="Clear selection" onClick={props.onClearSelection}>Clear</Button>
          </> : null}
        </div>
      ) : null}
      {props.selectionEnabled && (props.ketcherOpen || props.molstarOpen) ? (
        <div id="selected-open-actions" className="buret-selected-open-actions" role="group" aria-label="Open selection">
          {props.ketcherOpen ? <ControlTooltip label={props.selectedCount ? "Edit selected molecules in Ketcher" : "Select molecules to edit in Ketcher"}><Button variant="ghost" size="icon-sm"
            id="open-selected-ketcher"
            className="ab-btn ab-btn-icon"
            type="button"
            aria-label="Open in Ketcher"
            disabled={props.selectedCount === 0 || props.ketcherPending}
            onClick={props.onOpenKetcher}
          >
            <Edit className="ab-ico" aria-hidden="true" />
          </Button></ControlTooltip> : null}
          {props.molstarOpen ? <ControlTooltip label={props.selectedCount ? "Open selected molecules in a new Burette tab" : "Select molecules to open in a new tab"}><Button variant="ghost" size="icon-sm"
            id="open-selected-molstar"
            className="ab-btn ab-btn-icon"
            type="button"
            aria-label="Open in new tab"
            disabled={props.selectedCount === 0}
            onClick={() => props.onRendererSwitch("molstar")}
          >
            <Cube className="ab-ico" aria-hidden="true" />
          </Button></ControlTooltip> : null}
        </div>
      ) : null}
      <ActionsMenu {...props} />
    </div>
  );
}

function GridControls(props: GridControlProps) {
  const [themeRevision, refreshTheme] = React.useReducer((revision: number) => revision + 1, 0);
  React.useEffect(() => {
    window.addEventListener("burette-grid-theme-changed", refreshTheme);
    return () => window.removeEventListener("burette-grid-theme-changed", refreshTheme);
  }, []);
  const atlasStyles = React.useMemo(() => gridAtlasStyles((window as Window & {
    BuretteConfig?: { themeTokens?: Parameters<typeof gridAtlasStyles>[0] };
  }).BuretteConfig?.themeTokens), [themeRevision]);
  const searchPlaceholder = props.substructureSearch
    ? "Search or SMARTS…"
    : "Search…";

  return (
    <TooltipProvider delayDuration={200}><div className="buret-grid-toolbar">
      <style>{atlasStyles}</style>
      <div className="buret-toolbar-row buret-toolbar-row-main">
        <div className="buret-search-control buret-filter-control">
          <SearchInput
            id="search"
            value={props.searchQuery ?? ""}
            onValueChange={props.onSearchInput}
            name="molecule-search"
            autoComplete="off"
            aria-label={props.substructureSearch ? "Search text or structures with SMARTS" : "Search text"}
            spellCheck={false}
            autoCapitalize="off"
            placeholder={searchPlaceholder}
          />
        </div>
        <label className="buret-sort-control">
          <GridSelectMenu>
            <NativeSelectControl size="sm" id="sort" name="molecule-sort" aria-label="Sort molecules" onChange={(event) => props.onSortChange(event.currentTarget.value || "index")}>
              {props.sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelectControl>
          </GridSelectMenu>
        </label>
        <div id="load-status" className="buret-load-status" />
      </div>
      <GridActionToolbar {...props} />
    </div></TooltipProvider>
  );
}

function mountGridControls(container: Element, props: GridControlProps) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  flushSync(() => {
    root.render(<GridControls {...props} />);
  });
}

window.BuretteGridUI = { mountGridControls, themeColors: codexThemeColors };

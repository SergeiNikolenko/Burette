import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

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
  supportsXyzrenderCards: boolean;
  viewMode: "cards" | "table";
  cardRenderer: "rdkit" | "xyzrender";
  xyzrenderPreset: string;
  xyzrenderPresetOptions: XyzrenderPresetOption[];
  ketcherOpen: boolean;
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
  onSearchInput: (value: string) => void;
  onSortChange: (value: string) => void;
  onShowProperties: () => void;
  onClearSmarts: () => void;
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

type GridUIApi = {
  mountGridControls: (container: Element, props: GridControlProps) => void;
};

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

declare global {
  interface Window {
    BurreteGridUI?: GridUIApi;
  }
}

const roots = new WeakMap<Element, Root>();

function ControlTooltip({ label }: { label: string }) {
  return <span className="buret-control-tooltip" role="tooltip" aria-hidden="true">{label}</span>;
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
  generate3d: <Icon paths={<><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>} />,
  optimize: <Icon paths={<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>} />,
  energy: <Icon paths={<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />} />,
  descriptors: <Icon paths={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /><path d="M12.5 13h5M12.5 16.5h5" /></>} />,
  align: <Icon paths={<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /></>} />,
  cluster: <Icon paths={<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>} />,
  findSimilar: <Icon paths={<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>} />,
  exportDiverse: <Icon paths={<><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /></>} />,
  selectAll: <Icon paths={<><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>} />,
  clearSelection: <Icon paths={<><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m9 9 6 6M15 9l-6 6" /></>} />,
  copy: <Icon paths={<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>} />,
  fileCoords: <Icon paths={<><path d="M4 20V6a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M13 4v5h5" /><path d="M9 16.5 11 14l1.6 1.8L15 12" /></>} />,
  molstar: <Icon paths={<><circle cx="12" cy="6" r="2.4" /><circle cx="6" cy="16.5" r="2.4" /><circle cx="18" cy="16.5" r="2.4" /><path d="M10.4 7.9 7.6 14.6M13.6 7.9l2.8 6.7M8.4 16.5h7.2" /></>} />,
  ketcher: <Icon paths={<><path d="M14.5 4.5 19.5 9.5 9 20H4v-5Z" /><path d="M12.5 6.5 17.5 11.5" /></>} />,
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
    <select
      className="ab-mini"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value as T)}
    >
      {options.map((option) => (
        <option key={option} value={option}>{formatOption ? formatOption(option) : option}</option>
      ))}
    </select>
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
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (active && active.offsetWidth > 0) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
  }, [value, options.length]);

  return (
    <div className="ab-seg buret-grid-segmented-control" role="group" aria-label={ariaLabel} ref={trackRef}>
      {thumb ? <span className="ab-thumb" style={{ left: thumb.left, width: thumb.width }} aria-hidden="true" /> : null}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-buret-grid-segment={dataAttribute}
          data-buret-grid-segment-value={option.value}
          {...{ [`data-${dataAttribute}`]: option.value }}
          aria-pressed={value === option.value ? "true" : "false"}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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
      <select
        id="xyzrender-preset"
        className="ab-mini"
        value={props.xyzrenderPreset}
        disabled={props.cardRenderer !== "xyzrender"}
        aria-label="xyzrender card style"
        onChange={(event) => props.onXyzrenderPresetChange(event.currentTarget.value)}
      >
        {props.xyzrenderPresetOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ComputeSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  const noSelection = props.selectedCount === 0;
  return (
    <>
      <div className="ab-group">Compute · <span className="ab-group-accent">Metal GPU</span></div>
      <div className="ab-row">
        <button
          id="generate-3d-selected"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.generating3d || noSelection}
          title="Generate and selected-MMFF-optimize conformers for selected molecules"
          onClick={() => props.onRun(props.onGenerate3D)}
        >
          {ICONS.generate3d}
          <span className="ab-item-title" data-buret-grid-generate-3d-label>
            {props.generating3d ? "Generating..." : "Generate 3D"}
          </span>
        </button>
        <MiniSelect
          ariaLabel="Conformer generation method"
          value={props.conformerVariant}
          options={CONFORMER_VARIANTS}
          disabled={props.generating3d}
          onChange={props.onConformerVariantChange}
        />
      </div>
      <div className="ab-row">
        <button
          id="optimize-geometry-selected"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.generating3d || noSelection}
          title="Optimize selected input 3D coordinates with the chosen MMFF variant on Metal"
          onClick={() => props.onRun(props.onOptimizeGeometry)}
        >
          {ICONS.optimize}
          <span className="ab-item-title">{props.generating3d ? "Working..." : "Optimize geometry"}</span>
        </button>
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
          <button
            id="calculate-semiempirical-selected"
            className="ab-item"
            type="button"
            role="menuitem"
            disabled={props.evaluatingSemiempirical || noSelection}
            aria-busy={props.evaluatingSemiempirical ? "true" : "false"}
            title="Calculate native semi-empirical energies and atomic charges and write them to Grid"
            onClick={() => props.onRun(props.onEvaluateSemiempirical)}
          >
            {ICONS.energy}
            <span className="ab-item-title">
              {props.evaluatingSemiempirical ? "Calculating..." : "Energy & charges"}
            </span>
          </button>
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
        <button
          id="align-selected-poses"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.aligningPoses || props.selectedCount < 2}
          aria-busy={props.aligningPoses ? "true" : "false"}
          title="Align selected 3D poses to the first selected row on Metal and write scores to Grid"
          onClick={() => props.onRun(props.onAlignSelectedPoses)}
        >
          {ICONS.align}
          <span className="ab-item-title">{props.aligningPoses ? "Aligning..." : "Align & compare"}</span>
        </button>
      </div>
      <div className="ab-row">
        <button
          id="calculate-descriptors-selected"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={noSelection}
          title="Calculate Mordred descriptors for the selected molecules and write them to Grid"
          onClick={() => props.onRun(props.onCalculateSelectedDescriptors)}
        >
          {ICONS.descriptors}
          <span className="ab-item-title">Calculate descriptors</span>
        </button>
      </div>
    </>
  );
}

function CollectionSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  if (!props.clusterEnabled) return null;
  const clusterBusy = props.clustering || props.findingSimilar;
  return (
    <>
      <div className="ab-separator" />
      <div className="ab-group">Collection</div>
      <div className="ab-row">
        <button
          id="cluster-molecules"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={props.findingSimilar}
          aria-busy={props.clustering ? "true" : "false"}
          title="Cluster selected, filtered, or all molecules"
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
        </button>
        <select
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
        </select>
      </div>
      <div className="ab-row">
        <button
          id="find-similar-molecules"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={clusterBusy || !props.clusterRepresentativesAvailable || !props.similarityQuerySelected}
          aria-busy={props.findingSimilar ? "true" : "false"}
          title="Find the top 50 matches to the single selected molecule in the latest clustered snapshot"
          onClick={() => props.onRun(props.onFindSimilar)}
        >
          {ICONS.findSimilar}
          <span className="ab-item-title" data-buret-grid-similarity-label>
            {props.findingSimilar ? "Searching..." : "Find similar"}
          </span>
        </button>
      </div>
      <div className="ab-row">
        <button
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
          title="Export the immutable representative subset, structures, table, and provenance report"
          onClick={() => props.onRun(props.onExportClusterRepresentatives)}
        >
          {ICONS.exportDiverse}
          <span className="ab-item-title" data-buret-grid-representative-export-label>
            {props.exportingClusterRepresentatives ? "Exporting..." : "Export diverse"}
          </span>
        </button>
      </div>
    </>
  );
}

function SelectionSection(props: GridControlProps & { onRun: (action: () => void) => void }) {
  const noSelection = props.selectedCount === 0;
  return (
    <>
      <div className="ab-separator" />
      <div className="ab-group">Selection</div>
      <div className="ab-row">
        <button
          id="select-all"
          className="ab-item"
          type="button"
          role="menuitem"
          title="Select all visible molecules"
          onClick={() => props.onRun(props.onSelectAll)}
        >
          {ICONS.selectAll}
          <span className="ab-item-title">Select all</span>
        </button>
      </div>
      <div className="ab-row">
        <button
          id="clear-selection"
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={noSelection}
          title="Clear selected molecules"
          onClick={() => props.onRun(props.onClearSelection)}
        >
          {ICONS.clearSelection}
          <span className="ab-item-title">Clear selection</span>
        </button>
      </div>
      <div className="ab-row">
        <button
          className="ab-item"
          type="button"
          role="menuitem"
          disabled={noSelection}
          title="Copy selected molecule records"
          onClick={() => props.onRun(props.onCopySelected)}
        >
          {ICONS.copy}
          <span className="ab-item-title">Copy selected</span>
        </button>
      </div>
    </>
  );
}

// Shared open/close behaviour for the toolbar's dropdowns. The menu is switched
// to fixed positioning and clamped to the viewport so it stays on screen when
// the grid panel is squeezed narrow, instead of overflowing off the left edge.
function useMenu() {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>();

  const reposition = React.useCallback(() => {
    const trigger = wrapRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const t = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const margin = 8;
    // The visible strip stops where the dock begins floating over the grid; the
    // runtime writes that width onto the toolbar host as the dock moves.
    const host = document.getElementById("grid-controls");
    const cover = Number(host?.dataset.viewportCover) || 0;
    const vw = Math.max(0, document.documentElement.clientWidth - cover);
    const vh = document.documentElement.clientHeight;
    // When the strip is narrower than the menu, cap it (its rows wrap) so it fits
    // rather than spilling back under the dock.
    const maxWidth = Math.max(160, vw - margin * 2);
    const width = Math.min(m.width, maxWidth);
    // Right-align to the trigger, then pull back inside the visible strip.
    const left = Math.max(margin, Math.min(t.right - width, vw - width - margin));
    // Prefer opening below; flip above only when there is no room down there.
    const top = t.bottom + margin + m.height <= vh - margin
      ? t.bottom + margin
      : Math.max(margin, t.top - margin - m.height);
    setMenuStyle(cover > 0
      ? { position: "fixed", top, left, right: "auto", maxWidth: `${maxWidth}px`, minWidth: 0 }
      : { position: "fixed", top, left, right: "auto" });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined);
      return;
    }
    reposition();
  }, [open, reposition]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReflow = () => reposition();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, reposition]);

  const onRun = React.useCallback((action: () => void) => {
    action();
    setOpen(false);
  }, []);

  return { open, setOpen, wrapRef, menuRef, menuStyle, onRun };
}

function ActionsMenu(props: GridControlProps) {
  const { open, setOpen, wrapRef, menuRef, menuStyle, onRun } = useMenu();
  const selectedCount = props.selectedCount;

  return (
    <div className="ab-menu-wrap" ref={wrapRef}>
      <button
        className="ab-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open ? (
        <div className="ab-menu" role="menu" ref={menuRef} style={menuStyle}>
          <div className={selectedCount > 0 ? "ab-selhead has-selection" : "ab-selhead"}>
            {selectedCount > 0
              ? `${selectedCount.toLocaleString()} selected`
              : "Select molecules to enable actions"}
          </div>
          <ComputeSection {...props} onRun={onRun} />
          <CollectionSection {...props} onRun={onRun} />
          <SelectionSection {...props} onRun={onRun} />
        </div>
      ) : null}
    </div>
  );
}

// The collection's file actions: Save stays on the surface, everything else
// moves into an overflow menu so the header keeps one row on narrow grids.
function HeaderActions(props: GridControlProps) {
  const { open, setOpen, wrapRef, menuRef, menuStyle, onRun } = useMenu();
  return (
    <div className="buret-actions" hidden={!props.exportEnabled}>
      <button
        id="save-grid"
        className="ab-btn"
        type="button"
        disabled={!props.saveEnabled}
        title={props.saveTitle}
        onClick={props.onSaveGrid}
      >
        Save
      </button>
      <div className="ab-menu-wrap" ref={wrapRef}>
        <button
          className="ab-btn buret-actions-more"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More collection actions"
          onClick={() => setOpen((value) => !value)}
        >
          <MoreIcon />
        </button>
        {open ? (
          <div className="ab-menu" role="menu" ref={menuRef} style={menuStyle}>
            <div className="ab-group">File</div>
            <div className="ab-row">
              <button
                id="save-grid-as"
                className="ab-item"
                type="button"
                role="menuitem"
                disabled={!props.saveAsEnabled}
                title={props.saveAsTitle}
                onClick={() => onRun(props.onSaveGridAs)}
              >
                <span className="ab-item-title">Save As...</span>
              </button>
            </div>
            <div className="ab-row">
              <button
                id="undo-grid-edit"
                className="ab-item"
                type="button"
                role="menuitem"
                disabled={!props.undoEnabled}
                title={props.undoTitle}
                onClick={() => onRun(props.onUndoGridEdit)}
              >
                <span className="ab-item-title">Undo</span>
              </button>
            </div>
            <div className="ab-separator" />
            <div className="ab-group">Export</div>
            <div className="ab-row">
              <button
                id="export-smi"
                className="ab-item"
                type="button"
                role="menuitem"
                title="Export visible molecules as SMILES"
                onClick={() => onRun(props.onExportSmiles)}
              >
                <span className="ab-item-title">Export SMILES</span>
                <span className="ab-item-meta">.smi</span>
              </button>
            </div>
            <div className="ab-row">
              <button
                id="export-csv"
                className="ab-item"
                type="button"
                role="menuitem"
                title="Export visible table data as CSV"
                onClick={() => onRun(props.onExportCSV)}
              >
                <span className="ab-item-title">Export CSV</span>
                <span className="ab-item-meta">.csv</span>
              </button>
            </div>
            <div className="ab-separator" />
            <div className="ab-group">Clipboard</div>
            <div className="ab-row">
              <button
                id="copy-selected"
                className="ab-item"
                type="button"
                role="menuitem"
                disabled={props.selectedCount === 0}
                title="Copy selected molecule records"
                onClick={() => onRun(props.onCopySelected)}
              >
                <span className="ab-item-title">Copy selected</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MoreIcon() {
  return (
    <svg className="ab-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
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
      <button
        id="table-columns"
        className="ab-btn"
        type="button"
        aria-pressed="false"
        onClick={props.onToggleTableColumns}
      >
        Columns
        <ControlTooltip label="Choose visible table columns" />
      </button>
      <button
        id="show-properties"
        className="ab-btn"
        type="button"
        aria-pressed="false"
        onClick={props.onShowProperties}
      >
        Properties
        <ControlTooltip label="Show molecule properties in cards" />
      </button>
      {showRendererSwitch ? (
        <>
          <span className="ab-divider" aria-hidden="true" />
          <span className="ab-label">Render</span>
          <SegmentedControl
            ariaLabel="Molecule renderer"
            dataAttribute="buret-grid-card-renderer"
            value={props.cardRenderer}
            onChange={props.onSetCardRenderer}
            options={[
              { value: "rdkit", label: "RDKit" },
              { value: "xyzrender", label: "xyzrender" },
            ]}
          />
        </>
      ) : null}
      <XyzrenderStyleControl {...props} />
      {/* A pressed-state button rather than a checkbox: grid-viewer owns both the
          `hidden` on the wrapper and the pressed state on the button by id. */}
      <span id="rdkit-use-input-coords-control" className="buret-rdkit-coords-control" hidden>
        <button
          id="rdkit-use-input-coords"
          className="ab-btn ab-btn-icon"
          type="button"
          aria-pressed="false"
          aria-label="Use file coords"
          onClick={(event) => props.onRdkitUseInputCoordsChange(
            event.currentTarget.getAttribute("aria-pressed") !== "true",
          )}
        >
          {ICONS.fileCoords}
          <ControlTooltip label="Use the coordinates embedded in the file" />
        </button>
      </span>
      <button id="clear-smarts" className="ab-btn buret-clear-smarts" type="button" hidden onClick={props.onClearSmarts}>
        Clear search
        <ControlTooltip label="Clear the SMARTS search" />
      </button>
      <span className="ab-spacer" aria-hidden="true" />
      {props.selectionEnabled ? (
        <div id="selected-open-actions" className="buret-selected-open-actions" hidden>
          <button
            id="open-selected-molstar"
            className="ab-btn ab-btn-icon"
            type="button"
            aria-label="Open in Molstar"
            onClick={() => props.onRendererSwitch("molstar")}
          >
            {ICONS.molstar}
            <ControlTooltip label="Open selected molecules in Molstar" />
          </button>
          <button
            id="open-selected-ketcher"
            className="ab-btn ab-btn-icon"
            type="button"
            aria-label="Open in Ketcher"
            onClick={props.onOpenKetcher}
          >
            {ICONS.ketcher}
            <ControlTooltip label="Open selected molecule in Ketcher" />
          </button>
        </div>
      ) : null}
      <ActionsMenu {...props} />
    </div>
  );
}

function GridControls(props: GridControlProps) {
  const collectionType = props.format === "sdf"
    ? "SDF collection"
    : props.format === "csv"
      ? "CSV table"
      : props.format === "tsv"
        ? "TSV table"
        : props.format === "dwar"
          ? "DataWarrior table"
          : "SMILES collection";
  const searchPlaceholder = props.substructureSearch
    ? "name, SMILES, metadata, SMARTS"
    : "name or table value";

  return (
    <>
      <header className="buret-grid-header">
        <div>
          <div className="buret-eyebrow">{collectionType}</div>
          <h1>{props.label || "Molecule collection"}</h1>
          <div id="summary" className="buret-summary" />
        </div>
        <HeaderActions {...props} />
      </header>
      <div className="buret-grid-toolbar">
        <div className="buret-toolbar-row buret-toolbar-row-main">
          <label className="buret-search-control buret-filter-control">
            Search
            <input
              id="search"
              type="search"
              aria-label="Search molecules and SMARTS"
              spellCheck={false}
              autoCapitalize="off"
              placeholder={searchPlaceholder}
              onInput={(event) => props.onSearchInput(event.currentTarget.value || "")}
            />
          </label>
          <label className="buret-sort-control">
            Sort
            <select id="sort" onChange={(event) => props.onSortChange(event.currentTarget.value || "index")}>
              {props.sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div id="load-status" className="buret-load-status" />
        </div>
        <GridActionToolbar {...props} />
      </div>
    </>
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

window.BurreteGridUI = { mountGridControls };

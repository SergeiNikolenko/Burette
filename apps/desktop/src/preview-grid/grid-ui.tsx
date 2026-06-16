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

type GridControlProps = {
  format: "sdf" | "smiles";
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
  sortOptions: SortOption[];
  onSearchInput: (value: string) => void;
  onSortChange: (value: string) => void;
  onShowProperties: () => void;
  onClearSmarts: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
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
  onGenerate3D: () => void;
  onCalculateSelectedDescriptors: () => void;
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
    <div className="buret-grid-segmented-control" role="group" aria-label={ariaLabel}>
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

function GridViewControls(props: GridControlProps) {
  return (
    <div className="buret-grid-control-group buret-grid-view-group">
      <SegmentedControl
        ariaLabel="Grid view mode"
        dataAttribute="buret-grid-view-mode"
        value={props.viewMode}
        onChange={props.onViewModeChange}
        options={[
          { value: "cards", label: "Cards" },
          { value: "table", label: "Table" },
        ]}
      />
      <button
        id="table-columns"
        className="buret-toggle-button buret-table-columns-button"
        type="button"
        aria-pressed="false"
        onClick={props.onToggleTableColumns}
      >
        Columns
        <ControlTooltip label="Choose visible table columns" />
      </button>
      <button
        id="show-properties"
        className="buret-toggle-button"
        type="button"
        aria-pressed="false"
        onClick={props.onShowProperties}
      >
        Properties
        <ControlTooltip label="Show molecule properties in cards" />
      </button>
    </div>
  );
}

function GridRenderControls(props: GridControlProps) {
  return (
    <div className="buret-grid-control-group buret-grid-render-group">
      <span className="buret-grid-control-label">Render</span>
      <SegmentedControl
        ariaLabel="Molecule renderer"
        dataAttribute="buret-grid-card-renderer"
        value={props.cardRenderer}
        onChange={props.onSetCardRenderer}
        options={[
          { value: "rdkit", label: "RDKit" },
          ...(props.supportsXyzrenderCards ? [{ value: "xyzrender" as const, label: "xyzrender" }] : []),
        ]}
      />
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

function SelectionControls(props: GridControlProps) {
  return (
    <div className="buret-selection-actions" hidden={!props.selectionEnabled}>
      <button id="select-all" className="buret-toggle-button" type="button" onClick={props.onSelectAll}>
        Select all
        <ControlTooltip label="Select all visible molecules" />
      </button>
      <button id="clear-selection" className="buret-toggle-button" type="button" onClick={props.onClearSelection}>
        Clear selection
        <ControlTooltip label="Clear selected molecules" />
      </button>
    </div>
  );
}

function SelectedOpenActions(props: GridControlProps) {
  if (!props.selectionEnabled) return null;
  return (
    <div id="selected-open-actions" className="buret-selected-open-actions" hidden>
      <button id="open-selected-molstar" className="buret-toggle-button" type="button" onClick={() => props.onRendererSwitch("molstar")}>
        Open in Molstar
        <ControlTooltip label="Open selected molecules in Molstar" />
      </button>
      <button id="open-selected-ketcher" className="buret-toggle-button" type="button" onClick={props.onOpenKetcher}>
        Open in Ketcher
        <ControlTooltip label="Open selected molecule in Ketcher" />
      </button>
    </div>
  );
}

function GridControls(props: GridControlProps) {
  const collectionType = props.format === "sdf" ? "SDF collection" : "SMILES collection";
  const searchPlaceholder = props.substructureSearch
    ? "name, SMILES, metadata, SMARTS"
    : "name, SMILES, metadata";

  return (
    <>
      <header className="buret-grid-header">
        <div>
          <div className="buret-eyebrow">{collectionType}</div>
          <h1>{props.label || "Molecule collection"}</h1>
          <div id="summary" className="buret-summary" />
        </div>
        <div className="buret-actions" hidden={!props.exportEnabled}>
          <button id="copy-selected" type="button" onClick={props.onCopySelected}>
            Copy selected
            <ControlTooltip label="Copy selected molecule records" />
          </button>
          <button id="save-grid" type="button" disabled onClick={props.onSaveGrid}>
            Save
            <ControlTooltip label="Save changes back to this collection" />
          </button>
          <button id="save-grid-as" type="button" onClick={props.onSaveGridAs}>
            Save As...
            <ControlTooltip label="Save this collection as a new file" />
          </button>
          <button id="undo-grid-edit" type="button" disabled onClick={props.onUndoGridEdit}>
            Undo
            <ControlTooltip label="Undo the last grid edit" />
          </button>
          <button id="export-smi" type="button" onClick={props.onExportSmiles}>
            Export SMILES
            <ControlTooltip label="Export visible molecules as SMILES" />
          </button>
          <button id="export-csv" type="button" onClick={props.onExportCSV}>
            Export CSV
            <ControlTooltip label="Export visible table data as CSV" />
          </button>
        </div>
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
        <div className="buret-toolbar-row buret-toolbar-row-view">
          <GridViewControls {...props} />
          <button
            id="clear-smarts"
            className="buret-toggle-button buret-clear-smarts"
            type="button"
            hidden
            onClick={props.onClearSmarts}
          >
            Clear search
            <ControlTooltip label="Clear the SMARTS search" />
          </button>
          <GridRenderControls {...props} />
          <XyzrenderStyleControl {...props} />
          <div className="buret-toolbar-spacer" aria-hidden="true" />
          <SelectedOpenActions {...props} />
          <SelectionControls {...props} />
          <label id="rdkit-use-input-coords-control" className="buret-rdkit-coords-control" hidden>
            <input
              id="rdkit-use-input-coords"
              type="checkbox"
              onChange={(event) => props.onRdkitUseInputCoordsChange(event.currentTarget.checked === true)}
            />
            <span>Use file coords</span>
          </label>
          {props.rendererSwitch || props.ketcherOpen ? (
            <div className="buret-grid-renderer-controls">
              <div className="buret-grid-renderer-switch" aria-label="3D renderer">
                {props.rendererSwitch ? (
                  <button
                    type="button"
                    data-buret-grid-renderer="molstar"
                    data-buret-grid-sdf-poses
                    data-buret-grid-docking
                    onClick={() => props.onRendererSwitch("molstar")}
                  >
                    Molstar
                    <ControlTooltip label="Open selected molecules in Molstar" />
                  </button>
                ) : null}
                {props.ketcherOpen ? (
                  <button
                    type="button"
                    data-buret-grid-ketcher
                    onClick={props.onOpenKetcher}
                  >
                    Ketcher
                    <ControlTooltip label="Open selected molecule in Ketcher" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
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

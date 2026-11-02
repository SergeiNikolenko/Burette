import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  COORDINATE_PRESETS, CUSTOM_COORDINATE_SPEC, coordinateSpecError, generateCoordinateBlock, parseCoordinateBlock,
  type CoordinateBlockMode, type CoordinateUnit,
} from "../../lib/molecular-workbench/coordinate-block";
import type { MolecularAtom, UnitCell, Vec3 } from "../../lib/molecular-workbench/types";
import { Check, Copy, InfoCircle } from "../ui/app-icons";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import "./coordinate-editor.css";

const CUSTOM = "custom";
const SHOWN_ERRORS = 6;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
const TOKENS: [string, string][] = [
  ["#", "Atom index"], ["Z", "Atomic number"], ["G", "GAMESS atomic number, 6.0"], ["S", "Element symbol"], ["N", "Element name"],
  ["L", "Atom label, C2"], ["x y z", "Cartesian coordinates"], ["a b c", "Lattice coordinates"], ["I J K", "Z-matrix reference rows"],
  ["R A T", "Distance, angle, dihedral"], ["0 1", "Literal flag"], ["_", "Space"], [",", "Comma"],
];
const modeFor = (spec: string, previous: CoordinateBlockMode): CoordinateBlockMode =>
  /[IJKRAT]/u.test(spec) ? (previous === "cartesian" ? "zmatrix" : previous) : "cartesian";

/**
 * Avogadro's Cartesian coordinate editor for one structure: the atoms as a text block in a
 * preset or custom format, edited, checked line by line and applied as new positions of the
 * same atoms in the same order. `revision` identifies the structure the atoms belong to;
 * an edit started on another revision is never applied. `onApply` resolves true once the
 * owner has recorded the positions as one undoable edit.
 */
export function CoordinateEditor({ atoms, revision, cell, disabled, onApply }: {
  atoms: readonly MolecularAtom[]; revision: string | number; cell?: UnitCell | null; disabled: boolean;
  onApply: (positions: Vec3[]) => Promise<boolean>;
}) {
  const [presetId, setPresetId] = useState("xyz-symbols");
  const [customSpec, setCustomSpec] = useState(CUSTOM_COORDINATE_SPEC);
  const [spec, setSpec] = useState("Sxyz");
  const [mode, setMode] = useState<CoordinateBlockMode>("cartesian");
  const [unit, setUnit] = useState<CoordinateUnit>("angstrom");
  // The edited text and the structure revision it was edited from; null shows the structure.
  const [draft, setDraft] = useState<{ text: string; revision: string | number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const errorsId = useId();
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const format = { spec, mode, unit, cell: cell ?? null };
  let generated = "", generationError: string | null = null;
  try { generated = generateCoordinateBlock(atoms, format); } catch (caught) { generationError = caught instanceof Error ? caught.message : String(caught); }
  const value = draft?.text ?? generated;
  const specError = coordinateSpecError(spec, mode);
  const parsed = draft && !specError ? parseCoordinateBlock(draft.text, { ...format, reference: atoms }) : null;
  const lineErrors = parsed?.errors ?? [];
  const stale = draft !== null && draft.revision !== revision;
  const presets = COORDINATE_PRESETS.filter((preset) => cell || !preset.lattice);
  const busy = disabled || applying;

  const choosePreset = (id: string) => {
    setPresetId(id);
    const preset = COORDINATE_PRESETS.find((item) => item.id === id);
    if (!preset) { setSpec(customSpec); setMode(modeFor(customSpec, "cartesian")); return; }
    setSpec(preset.spec);
    setMode(preset.mode);
    setUnit(preset.unit ?? "angstrom");
  };
  // Editing the format switches to Custom, which remembers it.
  const editSpec = (next: string) => {
    setSpec(next);
    setCustomSpec(next);
    setMode(modeFor(next, mode));
    setPresetId(CUSTOM);
  };
  const edit = (next: string) => {
    setError(null);
    setDraft({ text: next, revision: draft?.revision ?? revision });
  };
  const revert = () => { setDraft(null); setError(null); };
  const copy = async () => {
    const copied = typeof navigator.clipboard?.writeText === "function"
      && await navigator.clipboard.writeText(value).then(() => true, () => false);
    setCopied(copied);
    setError(copied ? null : "Could not copy the coordinates. Try again.");
  };
  const apply = async () => {
    if (!draft || busy || stale || specError || !parsed || lineErrors.length) return;
    const next = parsed.atoms;
    if (next.length !== atoms.length) {
      setError(`The coordinates list ${next.length} atom${next.length === 1 ? "" : "s"}; this structure has ${atoms.length}. Only positions can change here.`);
      return;
    }
    const changed = next.findIndex((atom, index) => atom.element !== atoms[index].element);
    if (changed >= 0) {
      setError(`Atom ${changed + 1} is ${atoms[changed].element}, not ${next[changed].element}. Only positions can change here.`);
      return;
    }
    if (next.every((atom, index) => atom.x === atoms[index].x && atom.y === atoms[index].y && atom.z === atoms[index].z)) { revert(); return; }
    setApplying(true);
    setError(null);
    // The owner reports its own refusals; anything it throws is shown here.
    const applied = await onApply(next.map(({ x, y, z }) => [x, y, z]))
      .catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : String(caught)); return false; });
    setApplying(false);
    if (applied) setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (IS_MAC ? event.metaKey : event.ctrlKey)) { event.preventDefault(); void apply(); }
  };
  // Selects the line of an error in the text.
  const showLine = (line: number) => {
    const area = text.current;
    if (!area) return;
    const lines = area.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, item) => sum + item.length + 1, 0);
    area.focus();
    area.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  };

  return (
    <div className="coordinate-editor">
      <div className="coordinate-editor-format">
        <NativeSelect size="sm" aria-label="Preset" value={presetId} disabled={busy} onChange={(event) => choosePreset(event.target.value)}>
          <NativeSelectOption value={CUSTOM}>Custom</NativeSelectOption>
          {presets.map((preset) => <NativeSelectOption key={preset.id} value={preset.id}>{preset.label}</NativeSelectOption>)}
        </NativeSelect>
        <SegmentedControl aria-label="Distance unit" value={unit} onValueChange={(next) => setUnit(next as CoordinateUnit)}>
          <SegmentedControlItem value="angstrom" aria-label="Ångström" disabled={busy}>Å</SegmentedControlItem>
          <SegmentedControlItem value="bohr" disabled={busy}>Bohr</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="coordinate-editor-format">
        <Input variant="compact" className="coordinate-editor-spec" aria-label="Format" value={spec} maxLength={64} spellCheck={false} autoComplete="off"
          disabled={busy} aria-invalid={Boolean(specError) || undefined} onChange={(event) => editSpec(event.target.value)} />
        <TooltipProvider><Tooltip><TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Format characters"><InfoCircle aria-hidden /></Button>
        </TooltipTrigger><TooltipContent>
          <dl className="coordinate-editor-tokens">{TOKENS.map(([token, meaning]) => <div key={token}><dt>{token}</dt><dd>{meaning}</dd></div>)}</dl>
        </TooltipContent></Tooltip></TooltipProvider>
      </div>
      {specError || generationError ? <p role="alert" className="workbench-error">{specError ?? generationError}</p> : null}
      <Textarea ref={text} className="coordinate-editor-text" aria-label="Coordinates" value={value} rows={12} wrap="off" spellCheck={false}
        autoComplete="off" autoCapitalize="off" readOnly={busy} aria-invalid={lineErrors.length ? true : undefined}
        aria-describedby={lineErrors.length ? errorsId : undefined} onChange={(event) => edit(event.target.value)} onKeyDown={onKeyDown} />
      {lineErrors.length ? (
        <ul id={errorsId} className="coordinate-editor-errors" aria-label="Invalid lines">
          {lineErrors.slice(0, SHOWN_ERRORS).map((item, index) => (
            <li key={index}>
              {item.line === null ? item.message : <><button type="button" onClick={() => showLine(item.line!)}>Line {item.line}</button> {item.message}</>}
            </li>
          ))}
          {lineErrors.length > SHOWN_ERRORS ? <li>{lineErrors.length - SHOWN_ERRORS} more invalid lines</li> : null}
        </ul>
      ) : null}
      {stale ? <p role="alert" className="workbench-error">The structure changed. Revert to edit its current coordinates.</p>
        : error ? <p role="alert" className="workbench-error">{error}</p> : null}
      <div className="coordinate-editor-actions">
        <Button type="button" variant="ghost" size="xs" onClick={() => void copy()}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}Copy</Button>
        <Button type="button" variant="ghost" size="xs" disabled={!draft || applying} onClick={revert}>Revert</Button>
        <Button type="button" variant="secondary" size="xs" className="ml-auto"
          disabled={!draft || busy || stale || Boolean(specError) || lineErrors.length > 0} onClick={() => void apply()}>
          {applying ? <Spinner aria-hidden className="size-3" /> : null}Apply
        </Button>
      </div>
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </div>
  );
}

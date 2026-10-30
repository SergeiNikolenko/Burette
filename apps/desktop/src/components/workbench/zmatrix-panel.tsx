import { summary, sceneReload, type OptimizationSummary } from "./zmatrix-session";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatZmatrixDocument, resolveZmatrixDocument, type ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { addZmatrixVariable, bindZmatrixCoordinate, removeZmatrixVariable, renameZmatrixVariable, setZmatrixReferences } from "../../../../../scripts/zmatrix-editing.mjs";
import { editZmatrixRows, type ZmatrixRowAction } from "../../../../../scripts/zmatrix-rows.mjs";
import { rendererXyzText } from "../../lib/geometry-source-text";
import { useLogicalSource } from "../../lib/science-session/state";
import { useGeometryBinding } from "../../hooks/use-geometry-binding";
import { useGeometryLivePreview } from "../../hooks/use-geometry-live-preview";
import { downloadTextFile } from "../../lib/file-export";
import { INTERNAL_COORDINATE_KINDS, formatInternalCoordinate, internalCoordinateUnit, type InternalCoordinateKind } from "../../lib/geometry-editing";
import type { MolecularForceField } from "../../lib/molecular-workbench/chemistry";
import { runChemistryTask, type ChemistryResults } from "../../lib/molecular-workbench/compute-client";
import type { MinimizerMethod } from "../../lib/molecular-workbench/minimizer";
import type { ScientificDocument } from "../../lib/molecular-workbench/quantum";
import { serializeXyz } from "../../lib/molecular-workbench/xyz";
import { useSourceEditing } from "../../lib/source-editing/context";
import { fileStem } from "../../lib/workbench/formats";
import { openWorkbenchDialog } from "../../lib/workbench/dialog-store";
import { isAbortError } from "../../lib/viewer-errors";
import { forgetViewerAtomSelection } from "../../lib/workbench/selection";
import { recordImportedRevision, revisionIndex, useImportedOriginal, useImportedRevisions, type ImportedRevision } from "../../lib/workbench/source";
import { isReferencePoint, nextVariableName, sameDefinition, variableUses, withReference, withRowValue, withVariable, zmatrixOptimizedRevision, zmatrixRevision, zmatrixRowLabels, zmatrixRowsRevision } from "../../lib/workbench/zmatrix-draft";
import { zmatrixConstraints, zmatrixLockKey, zmatrixRowStructure } from "../../lib/workbench/zmatrix-optimization";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ArrowCurvedRight, Download, FileCode, Undo } from "../ui/app-icons";
import { Button } from "../ui/button";
import { IconAction, ValueField } from "./geometry-fields";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ConstraintToggle } from "./constraint-toggle";
import { OptimizeButton } from "./optimize-button";
import { CoordinateDefinition, VariableName, variableToken } from "./zmatrix-definition-controls";
import { ZmatrixAddMenu, ZmatrixRowMenu } from "./zmatrix-row-controls";
import "./workbench-layout.css";
import "./geometry.css";

const COLUMN_LABELS: Record<InternalCoordinateKind, string> = { bond: "Bond", angle: "Angle", dihedral: "Dihedral" };
const STEP: Record<InternalCoordinateKind, number> = { bond: 0.01, angle: 1, dihedral: 1 };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
// Documents with an edit on its way, across every mounted Geometry surface: a second
// edit would start from a revision the first one is about to replace.
const applyingDocuments = new Set<string>();
const NONE: ReadonlySet<never> = new Set();
const CHANGED = "The structure changed while optimizing; the result was not applied.";

// Frozen rows and fixed coordinates ("row:slot") of the rows they were set on.
type HeldConstraints = { key: string; frozen: ReadonlySet<number>; locked: ReadonlySet<string> };
/**
 * Geometry of an imported Z-matrix through its own definition: named variables (each
 * edit moves every coordinate bound to it), literal values and reference points. Every
 * applied edit is a revision of the same document, so Undo and Redo keep the bindings;
 * an edit made elsewhere leaves the document without them. Variables can be added,
 * renamed and removed, coordinates bound to them and measured from other earlier rows.
 * Atoms and reference points are appended as rows, moved and removed; an edit that changes
 * the atoms or their order reloads the scene at the same camera, and its revision leaves
 * out data indexed by the previous atoms. Optimize minimizes the real atoms with MMFF94,
 * holding frozen atoms and fixed coordinates (never one a reference point carries), and
 * writes the result back through the same rows as one revision.
 */
export function ZmatrixPanel({ document, actions, science, text }: {
  document: ViewerDocument; actions: ShellActions; science: ScientificDocument & { internalCoordinates: ZmatrixDocument }; text: string;
}) {
  const definition = science.internalCoordinates;
  const sourceEditing = useSourceEditing();
  const session = sourceEditing?.sessionForDocument(document) ?? null;
  const revisions = useImportedRevisions(document.id, text) ?? [];
  const original = useImportedOriginal(document.id);
  const position = revisionIndex(revisions, text);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  // What the last reference change did to bindings it could not keep.
  const [notice, setNotice] = useState<string | null>(null);
  const logical = useLogicalSource(document.id);
  const runtimeText = (value: string) => logical ? value : rendererXyzText(value);
  const bindingIdentity = useMemo(() => ({ text, definition }), [text, definition]);
  const { binding, error: bindingError, key: bindingKey } = useGeometryBinding(document, actions.runStructureViewerAction, bindingIdentity, (value) => value.text === runtimeText(text));
  const live = useGeometryLivePreview(document, binding, actions.runStructureViewerAction, (caught) => setError(message(caught)));
  // An edit applies only to the panel, document and source text it started from.
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; }; }, [document.id, document.path]);
  const latestText = useRef(text);
  // The optimization running for the source text it started from; closing the panel or
  // the document, or any change of that text, stops it.
  const optimizeJob = useRef<{ controller: AbortController; text: string } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  useEffect(() => () => optimizeJob.current?.controller.abort(), []);
  useEffect(() => { optimizeJob.current?.controller.abort(); }, [bindingKey]);
  useEffect(() => {
    latestText.current = text;
    if (optimizeJob.current && optimizeJob.current.text !== text) optimizeJob.current.controller.abort();
  }, [text]);
  // The last optimization result, shown while the source is the revision it produced.
  const [optimized, setOptimized] = useState<{ text: string; summary: OptimizationSummary } | null>(null);
  const labels = zmatrixRowLabels(definition);
  const values = resolveZmatrixDocument(definition);
  const uses = variableUses(definition);
  const variableNames = definition.variables.map(({ name }) => name);
  // Frozen rows and fixed coordinates belong to these rows over these atoms: a row or
  // reference edit (or an atom reorder) leaves them with the rows they were set on, and
  // Undo back to those rows finds them again.
  const constraintKey = `${revisions[position]?.topology ?? 0}\n${zmatrixRowStructure(definition)}`;
  const [held, setHeld] = useState<HeldConstraints>({ key: constraintKey, frozen: NONE, locked: NONE });
  const constraints = held.key === constraintKey ? held : { key: constraintKey, frozen: NONE, locked: NONE };
  const constraintsLeft = held.key !== constraintKey && held.frozen.size + held.locked.size > 0;
  const constraintCount = constraints.frozen.size + constraints.locked.size;

  const place = (next: ZmatrixDocument) => zmatrixRevision(science, next, text, revisions);
  const preview = (next: ZmatrixDocument) => {
    if (!binding) return;
    try {
      live.preview(runtimeText(place(next).text), binding.text);
      setError(null);
    } catch (caught) {
      live.cancel();
      setError(message(caught));
    }
  };
  // Other atoms or another order: the draft reloads the scene at the current camera, its
  // 3D selection (of the previous atoms) is dropped, and the edit stands once the reloaded
  // scene shows it. A reload that fails returns the draft and revisions to where they were,
  // even when the panel closed meanwhile. One the source moved past (or closed) never showed:
  // its revision goes, so the Redo branch it replaced comes back, and the source keeps its text.
  const reload = (target: ImportedRevision, record: boolean, fromText: string, unchanged: () => boolean) => {
    if (!sourceEditing) throw new Error("This structure can only be edited from its source.");
    return live.replace(async () => {
      if (!unchanged()) return false;
      const rollback = record ? recordImportedRevision(document.id, fromText, target) : null;
      if (record && !rollback) throw new Error("The structure changed outside the Z-matrix.");
      sourceEditing.updateDraft(document, target.text, { view: "keep" });
      if (sourceEditing.sessionForDocument(document)?.content !== target.text) {
        rollback?.();
        throw new Error("The source did not take this edit.");
      }
      forgetViewerAtomSelection(document.id);
      const { outcome, diagnostic } = await sceneReload(sourceEditing, document, target.text);
      if (outcome === "moved") {
        // The rollback leaves revisions recorded since alone.
        rollback?.();
        return false;
      }
      if (outcome === "failed") {
        rollback?.();
        // The scene still shows the structure the draft came from.
        sourceEditing.updateDraft(document, fromText, { previewApplied: true });
        throw new Error(diagnostic ?? "The scene could not show this edit. The structure is unchanged.");
      }
      setError(null);
      return true;
    });
  };
  // Shows the revision `target` in the same document; `record` makes it the revision after
  // the current one (an edit), otherwise it is one already there (Undo, Redo). Within one
  // topology the scene moves its atoms and acknowledges; the revision is recorded only once
  // the scene has it, just before the draft (so the draft is recognised with its bindings),
  // and rolled back with its Redo branch if the draft does not take it; the scene then shows
  // the source again. Nothing is written after the panel closed, the document changed, or
  // the source moved on meanwhile.
  const show = async (target: ImportedRevision, record: boolean) => {
    if (!binding) return false;
    if (applyingDocuments.has(document.id)) return false;
    applyingDocuments.add(document.id);
    setApplying(true);
    setNotice(null);
    const started = lifetime.current;
    const fromText = text;
    const nextText = target.text;
    const unchanged = () => started === lifetime.current && latestText.current === fromText;
    const reloads = (target.topology ?? 0) !== (revisions[position]?.topology ?? 0);
    let shown = false;
    try {
      if (sourceEditing && !session) await sourceEditing.beginEditing(document, "geometry", { geometryBinding: binding });
      if (!unchanged()) return false;
      // Opening reports its own failure and resolves without a session.
      if (sourceEditing && !sourceEditing.sessionForDocument(document)) throw new Error("The source could not be opened for editing.");
      if (reloads) return await reload(target, record, fromText, unchanged);
      await live.commit(runtimeText(nextText), binding.text);
      shown = true;
      if (!unchanged()) {
        // The source moved on while the scene took this edit: show the source again.
        if (started === lifetime.current) void live.commit(runtimeText(latestText.current), runtimeText(latestText.current)).catch(() => {});
        return false;
      }
      const rollback = record ? recordImportedRevision(document.id, fromText, target) : null;
      if (record && !rollback) throw new Error("The structure changed outside the Z-matrix.");
      try {
        sourceEditing?.updateDraft(document, nextText, { previewApplied: true });
        // A session closing meanwhile ignores the draft.
        if (sourceEditing && sourceEditing.sessionForDocument(document)?.content !== nextText) throw new Error("The source did not take this edit.");
      } catch (caught) {
        rollback?.();
        throw caught;
      }
      setError(null);
      return true;
    } catch (caught) {
      if (started !== lifetime.current) return false;
      if (shown) void live.commit(runtimeText(fromText), runtimeText(fromText)).catch(() => {});
      else live.cancel();
      setError(message(caught));
      return false;
    } finally {
      applyingDocuments.delete(document.id);
      setApplying(false);
    }
  };
  const apply = (next: ZmatrixDocument) => {
    if (sameDefinition(definition, next)) { live.cancel(); return Promise.resolve(true); }
    let revision;
    try {
      revision = place(next);
    } catch (caught) {
      // Invalid values are reported before anything is applied; the source keeps its text.
      live.cancel();
      setError(message(caught));
      return Promise.resolve(false);
    }
    return show(revision, true);
  };
  // A definition edit from the editing module; a rejected one is reported and changes nothing.
  const edit = (make: () => ZmatrixDocument) => {
    let next;
    try {
      next = make();
    } catch (caught) {
      setError(message(caught));
      return Promise.resolve(false);
    }
    return apply(next);
  };
  const addVariable = (name: string, value: number) => {
    let next;
    try {
      next = addZmatrixVariable(definition, name, value);
    } catch (caught) {
      return message(caught);
    }
    void apply(next);
    return null;
  };
  // A rejected name is reported in the rename form and changes nothing.
  const renameVariable = (name: string, next: string) => {
    let renamed;
    try {
      renamed = renameZmatrixVariable(definition, name, next);
    } catch (caught) {
      return message(caught);
    }
    void apply(renamed);
    return null;
  };
  const canBind = (row: number, slot: number, binding: string) => {
    try {
      bindZmatrixCoordinate(definition, row, slot, binding);
      return true;
    } catch {
      return false;
    }
  };
  // A binding is kept only while the new references measure its value; the others say so.
  const changeReference = async (row: number, slot: number, reference: number) => {
    let result;
    try {
      result = setZmatrixReferences(definition, row, withReference(definition.rows[row].refs, slot, reference));
    } catch (caught) {
      setError(message(caught));
      return;
    }
    if (!await apply(result.document) || !result.detachedSlots.length) return;
    const left = result.detachedSlots.map((detached) => `${COLUMN_LABELS[INTERNAL_COORDINATE_KINDS[detached]]} of ${labels[row]} no longer follows ${variableToken(String(definition.rows[row].values[detached]))}`);
    setNotice(`${left.join("; ")}: the new references measure a different value.`);
  };
  // A row added, moved or removed; a rejected edit changes nothing and returns its reason.
  const editRows = (action: ZmatrixRowAction) => {
    let result;
    let revision;
    try {
      result = editZmatrixRows(definition, action, science.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] })));
      revision = zmatrixRowsRevision(science, result, text, revisions);
    } catch (caught) {
      return message(caught);
    }
    const { detachedBindings, document: next } = result;
    void show(revision, true).then((applied) => {
      if (!applied || !detachedBindings.length) return;
      const nextLabels = zmatrixRowLabels(next);
      setNotice(`${detachedBindings.map(({ row, slot, binding }) => `${COLUMN_LABELS[INTERNAL_COORDINATE_KINDS[slot]]} of ${nextLabels[row]} no longer follows ${variableToken(binding)}`).join("; ")}.`);
    });
    return null;
  };
  const rowAction = (action: ZmatrixRowAction) => {
    const rejected = editRows(action);
    if (rejected) setError(rejected);
  };
  const toggle = (change: (current: HeldConstraints) => Partial<HeldConstraints>) => setHeld((current) => {
    const base = current.key === constraintKey ? current : { key: constraintKey, frozen: NONE, locked: NONE };
    return { ...base, ...change(base) };
  });
  const toggleFrozen = (row: number) => toggle(({ frozen }) => {
    const next = new Set(frozen);
    if (!next.delete(row)) next.add(row);
    return { frozen: next };
  });
  const toggleLocked = (row: number, slot: number) => toggle(({ locked }) => {
    const next = new Set(locked);
    const key = zmatrixLockKey(row, slot);
    if (!next.delete(key)) next.add(key);
    return { locked: next };
  });
  const currentAtoms = () => science.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  // MMFF94 minimization of the real atoms, frozen rows and fixed coordinates held. The
  // optimized atoms are written back through the same rows; the result is one revision,
  // applied only to the source text it started from.
  const optimize = async (method: MinimizerMethod | undefined, forceField: MolecularForceField) => {
    if (!binding) return;
    if (applying || optimizeJob.current || applyingDocuments.has(document.id)) return;
    const controller = new AbortController();
    optimizeJob.current = { controller, text };
    const started = lifetime.current;
    const fromText = text;
    setOptimizing(true);
    setError(null);
    setNotice(null);
    let result: ChemistryResults["optimize-zmatrix"];
    try {
      const molecule = await runChemistryTask({ action: "parse", source: serializeXyz(science.atoms, "Z-matrix"), format: "xyz" }, { signal: controller.signal });
      result = await runChemistryTask({ action: "optimize-zmatrix", molecule, definition, options: { frozenRows: [...constraints.frozen], lockedCoordinates: [...constraints.locked], forceField, ...(method ? { method } : {}) } }, { signal: controller.signal, timeoutMs: 300_000 });
    } catch (caught) {
      if (started === lifetime.current) {
        if (latestText.current !== fromText) setError(CHANGED);
        else if (!isAbortError(caught) && !controller.signal.aborted) setError(message(caught));
      }
      return;
    } finally {
      if (optimizeJob.current?.controller === controller) {
        optimizeJob.current = null;
        setOptimizing(false);
      }
    }
    if (controller.signal.aborted || started !== lifetime.current) return;
    if (latestText.current !== fromText) { setError(CHANGED); return; }
    let revision;
    let detached;
    try {
      const after = result.molecule.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
      ({ revision, detachedBindings: detached } = zmatrixOptimizedRevision(science, definition, after, labels, text, revisions, result.definition));
    } catch (caught) {
      setError(message(caught));
      return;
    }
    const outcome = summary(result);
    // Already optimal: nothing moved and the definition is unchanged, so there is no new revision.
    if (revision.text === text && sameDefinition(definition, revision.document.internalCoordinates!)) {
      setOptimized({ text, summary: outcome });
      return;
    }
    if (!await show(revision, true)) {
      if (started === lifetime.current && latestText.current !== fromText && latestText.current !== revision.text) setError(CHANGED);
      return;
    }
    setOptimized({ text: revision.text, summary: outcome });
    if (detached.length) {
      setNotice(`${detached.map(({ row, slot, binding }) => `${COLUMN_LABELS[INTERNAL_COORDINATE_KINDS[slot]]} of ${labels[row]} no longer follows ${variableToken(binding)}`).join("; ")}: the optimized geometry measures different values.`);
    }
  };
  const cancelOptimize = () => {
    optimizeJob.current?.controller.abort();
    optimizeJob.current = null;
    setOptimizing(false);
  };
  // The real atoms and their constraints, as the quantum input export writes them.
  const exportInput = () => {
    try {
      const inputConstraints = zmatrixConstraints(definition, constraints.frozen, constraints.locked, labels);
      openWorkbenchDialog({ kind: "input", document, atoms: science.atoms.map((atom) => ({ ...atom })), constraints: inputConstraints.map(({ kind, atoms }) => ({ kind, atoms })) });
    } catch (caught) {
      setError(message(caught));
    }
  };
  const exportZmatrix = () => downloadTextFile(`${fileStem(original?.name ?? document.title)}.zmat`, formatZmatrixDocument(definition));
  const busy = applying || optimizing || !binding;
  const result = optimized?.text === text ? optimized.summary : null;

  return (
    <div className="dock-content geometry-panel zmatrix-panel">
      <div className="geometry-panel-toolbar">
        <IconAction label="Undo" disabled={busy || position <= 0} onClick={() => void show(revisions[position - 1], false)}><Undo aria-hidden /></IconAction>
        <IconAction label="Redo" disabled={busy || position < 0 || position >= revisions.length - 1} onClick={() => void show(revisions[position + 1], false)}><ArrowCurvedRight aria-hidden /></IconAction>
        <ZmatrixAddMenu disabled={busy} rowLabels={labels} variables={variableNames} suggestedName={nextVariableName(definition)}
          onAddRow={(row) => editRows({ type: "append", row })} onAddVariable={addVariable} />
        <IconAction label="Export Z-matrix" onClick={exportZmatrix}><Download aria-hidden /></IconAction>
        <IconAction label="Export input file" onClick={exportInput}><FileCode aria-hidden /></IconAction>
        {optimizing ? (
          <>
            <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Optimizing</span>
            <Button type="button" variant="ghost" size="xs" onClick={cancelOptimize}>Cancel</Button>
          </>
        ) : (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span><OptimizeButton atomCount={science.atoms.length} size="xs" variant="secondary" disabled={busy} onOptimize={(method, forceField) => void optimize(method, forceField)} /></span>
          </TooltipTrigger><TooltipContent>{constraintCount ? `Optimize with ${constraintCount} constraint${constraintCount === 1 ? "" : "s"}` : "Optimize geometry"}</TooltipContent></Tooltip></TooltipProvider>
        )}
      </div>
      {error || bindingError ? <p role="alert" className="geometry-panel-error">{error || bindingError}</p> : null}
      {result ? (
        <p className="geometry-panel-result" role="status">
          {result.forceField ?? "MMFF94"} {result.initialEnergy.toFixed(2)} → {result.energy.toFixed(2)} kcal/mol
          {result.residual ? ` · residual ${[result.residual.distance === null ? null : `${result.residual.distance.toFixed(3)} Å`, result.residual.angle === null ? null : `${result.residual.angle.toFixed(2)}°`].filter(Boolean).join(", ")}` : ""}
          {" · "}<span data-status={result.converged ? "success" : "failure"} className="workbench-value">{result.converged ? "Converged" : "Not converged"}</span>
        </p>
      ) : null}
      {notice ? <p role="status" className="geometry-panel-result">{notice}</p> : null}
      {constraintsLeft ? <p role="status" className="geometry-panel-result">Frozen atoms and fixed coordinates stay with the previous rows; Undo returns to them.</p> : null}
      <div className="zmatrix-scroll">
        {definition.variables.length ? (
          <table className="geometry-table zmatrix-variables" aria-label="Variables">
            <thead><tr><th scope="col">Variable</th><th scope="col">Value</th><th scope="col">Sets</th></tr></thead>
            <tbody>
              {definition.variables.map(({ name, value }) => {
                const bound = uses.get(name) ?? [];
                const kind = bound.length && bound.every((use) => use.slot === 0) ? "bond" : "angle";
                return (
                  <tr key={name}>
                    <th scope="row">
                      <VariableName name={name} disabled={busy}
                        onRename={(next) => renameVariable(name, next)}
                        onRemove={() => void edit(() => removeZmatrixVariable(definition, name))} />
                    </th>
                    <td>
                      <ValueField label={`Variable ${name}`} value={value} step={STEP[kind]} disabled={busy}
                        format={(next) => String(Number(next.toFixed(6)))}
                        onPreview={(next) => preview(withVariable(definition, name, next))} onCancel={live.cancel}
                        onCommit={(next) => apply(withVariable(definition, name, next))} />
                    </td>
                    <td className="zmatrix-uses">
                      {bound.map((use) => `${use.sign < 0 ? "−" : ""}${COLUMN_LABELS[INTERNAL_COORDINATE_KINDS[use.slot]].toLowerCase()} ${labels[use.row]}`).join(", ") || "Unused"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        <table className="geometry-table" aria-label="Z-matrix rows">
          <thead>
            <tr>
              <th scope="col">Row</th>
              {INTERNAL_COORDINATE_KINDS.map((kind) => <th key={kind} scope="col">{COLUMN_LABELS[kind]}, {internalCoordinateUnit(kind)}</th>)}
            </tr>
          </thead>
          <tbody>
            {definition.rows.map((row, index) => (
              <tr key={index} data-reference-point={isReferencePoint(row) || undefined}>
                <th scope="row">
                  <span className="geometry-atom">
                    <ZmatrixRowMenu label={labels[index]} referencePoint={isReferencePoint(row)} index={index} rowCount={definition.rows.length} disabled={busy}
                      onMove={(to) => rowAction({ type: "move", index, to })} onRemove={() => rowAction({ type: "remove", index })} />
                    {isReferencePoint(row) ? null : (
                      <ConstraintToggle label={`Freeze ${labels[index]}`} active={constraints.frozen.has(index)} disabled={busy} onToggle={() => toggleFrozen(index)} />
                    )}
                  </span>
                </th>
                {INTERNAL_COORDINATE_KINDS.map((kind, slot) => {
                  if (slot >= row.values.length) return <td key={kind} />;
                  const token = row.values[slot];
                  const label = `${COLUMN_LABELS[kind]} of ${labels[index]}`;
                  return (
                    <td key={kind}>
                      <div className="geometry-value">
                        <CoordinateDefinition label={label} slot={slot} refs={row.refs} earlierRows={labels.slice(0, index)}
                          token={token} variables={variableNames} disabled={busy} canBind={(binding) => canBind(index, slot, binding)}
                          onReference={(next) => void changeReference(index, slot, next)}
                          onBind={(binding) => void edit(() => bindZmatrixCoordinate(definition, index, slot, binding))} />
                        <ConstraintToggle label={`Keep ${label.toLowerCase()} fixed`} active={constraints.locked.has(zmatrixLockKey(index, slot))} disabled={busy}
                          unavailable={null} onToggle={() => toggleLocked(index, slot)} />
                        {typeof token === "string" ? (
                          <span className="zmatrix-bound" aria-label={`${label}, ${formatInternalCoordinate(kind, values[index].values[slot])} ${internalCoordinateUnit(kind)}, set by ${token}`}>
                            <span className="zmatrix-variable">{variableToken(token)}</span>
                            {formatInternalCoordinate(kind, values[index].values[slot])}
                          </span>
                        ) : (
                          <ValueField label={`${label}, ${internalCoordinateUnit(kind)}`} value={token} step={STEP[kind]} disabled={busy}
                            format={(next) => formatInternalCoordinate(kind, next)}
                            onPreview={(next) => preview(withRowValue(definition, index, slot, next))} onCancel={live.cancel}
                            onCommit={(next) => apply(withRowValue(definition, index, slot, next))} />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { scalarSourceIdentity } from "../../lib/workbench/scalar-source";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeQuantumGrid } from "../../lib/molecular-workbench/quantum-client";
import type { MolecularOrbital, ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import { HARTREE_EV, fileStem } from "../../lib/workbench/formats";
import { isAbortError } from "../../lib/viewer-errors";
import { serializeCube } from "../../lib/workbench/cube-task";
import { captureViewerActionTarget, type ViewerActionTarget } from "../../lib/viewer-bridge";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import "./workbench-layout.css";
import "./orbitals.css";

type FieldKind = "orbital" | "density" | "spin-density" | "file";
const FIELD_LABELS: Record<FieldKind, string> = { orbital: "Orbital", density: "Density", "spin-density": "Spin density", file: "Cube field" };
// Orbital amplitudes are bohr^-3/2; densities are electrons per bohr^3.
const FIELD_UNITS: Record<FieldKind, string> = { orbital: "a.u.", density: "e/bohr³", "spin-density": "e/bohr³", file: "" };
const DEFAULT_ISOVALUE: Record<FieldKind, number> = { orbital: 0.03, density: 0.02, "spin-density": 0.005, file: 0.02 };
const SPACINGS = [0.2, 0.3, 0.4, 0.5];

function frontierOrbitals(orbitals: MolecularOrbital[]) {
  const result = new Map<number, "HOMO" | "LUMO">();
  for (const spin of ["alpha", "beta"] as const) {
    const channel = orbitals.filter((orbital) => orbital.spin === spin);
    const occupied = channel.filter((orbital) => orbital.occupancy > 1e-6);
    const virtual = channel.filter((orbital) => orbital.occupancy <= 1e-6);
    const homo = occupied.reduce<MolecularOrbital | null>((best, orbital) => !best || orbital.energyHartree > best.energyHartree ? orbital : best, null);
    const lumo = virtual.reduce<MolecularOrbital | null>((best, orbital) => !best || orbital.energyHartree < best.energyHartree ? orbital : best, null);
    if (homo) result.set(homo.index, "HOMO");
    if (lumo) result.set(lumo.index, "LUMO");
  }
  return result;
}

export function OrbitalsPanel({ document, actions, science, sourceText, sourceKind }: {
  document: ViewerDocument;
  actions: ShellActions;
  science: ScientificDocument;
  sourceText: string;
  sourceKind: string;
}) {
  const hasBasis = Boolean(science.basis?.length && science.orbitals.some((orbital) => orbital.coefficients.length));
  const hasBeta = science.orbitals.some((orbital) => orbital.spin === "beta");
  const fieldKinds: FieldKind[] = [
    ...(hasBasis ? ["orbital", "density"] as const : []),
    ...(hasBasis && (hasBeta || science.orbitals.every(orbital => Number.isInteger(orbital.occupancy))) ? ["spin-density"] as const : []),
    ...(science.grid ? ["file"] as const : []),
  ];
  const [spin, setSpin] = useState<"alpha" | "beta">("alpha");
  const frontier = useMemo(() => frontierOrbitals(science.orbitals), [science]);
  const listed = science.orbitals.filter((orbital) => orbital.spin === spin);
  const [selected, setSelected] = useState<number | null>(() => {
    const homo = [...frontier].find(([index, label]) => label === "HOMO" && science.orbitals[index]?.spin === "alpha");
    return homo?.[0] ?? listed[0]?.index ?? null;
  });
  const [fieldKind, setFieldKind] = useState<FieldKind>(fieldKinds[0] ?? "orbital");
  const [isovalue, setIsovalue] = useState(DEFAULT_ISOVALUE[fieldKind]);
  const [spacing, setSpacing] = useState(0.3);
  const [shown, setShown] = useState<{ key: string; cube: string; lease: string; target: ViewerActionTarget; document: ViewerDocument; science: ScientificDocument } | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<AbortController | null>(null);
  const sender = useRef(actions.runStructureViewerAction);
  sender.current = actions.runStructureViewerAction;
  const binding = useRef<{ target: ViewerActionTarget; lease: string } | null>(null);
  const sceneTarget = useRef<{ target: ViewerActionTarget; lease: string } | null>(null);
  const mounted = useRef(true);
  const source = useRef({ document, science });
  source.current = { document, science };
  const sourceCurrent = () => mounted.current && source.current.document === document && source.current.science === science;
  const currentShown = shown?.document === document && shown.science === science ? shown : null;
  const [saving, setSaving] = useState(false);

  const fieldKey = fieldKind === "orbital" ? `orbital:${selected}:${spacing}` : `${fieldKind}:${spacing}`;
  const label = fieldKind === "orbital" && selected !== null ? `Orbital ${selected + 1}` : FIELD_LABELS[fieldKind];

  // Isovalue last sent with a visible field; a debounced resend is skipped when it already matches.
  const sentIsovalue = useRef<number | null>(null);
  const send = (cube: string, value: number, target: ViewerActionTarget, lease: string, signal?: AbortSignal) => {
    sentIsovalue.current = cube ? value : null;
    sceneTarget.current = cube ? { target, lease } : null;
    return sender.current(document, { type: "show_scalar_field", lease, label, cube, isovalue: value, signed: fieldKind !== "density", notify: false }, { target, signal });
  };

  // Clear through the retained frame; never acquire a new scene for an old computed grid.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      job.current?.abort();
      const target = sceneTarget.current; sceneTarget.current = null;
      if (target) void Promise.resolve(sender.current(document, { type: "show_scalar_field", lease: target.lease, label: "Scalar field", cube: "", isovalue: 1, signed: false, notify: false }, { target: target.target })).catch(() => {});
    };
  }, [document, science]);

  // The surface follows the desired field: each change of orbital, field or grid
  // aborts the calculation in flight, so a late result can never replace a newer choice.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (!wanted) return undefined;
    if (currentShown?.key === fieldKey) return undefined;
    const retained = binding.current?.target.isCurrent() ? binding.current : null;
    const target = retained?.target ?? captureViewerActionTarget(document.id);
    if (!target) { setError("Open the scene and wait for it to load."); setWanted(false); return undefined; }
    const controller = new AbortController();
    job.current = controller;
    setComputing(true);
    setError(null);
    void (async () => {
      try {
        let lease: string;
        if (retained) {
          try { await sender.current(document, { type: "scalar_field_validate", lease: retained.lease, label, notify: false }, { target, signal: controller.signal }); }
          catch (caught) { binding.current = null; throw caught; }
          lease = retained.lease;
        } else {
          const expected = await scalarSourceIdentity(science, sourceText, sourceKind);
          if (controller.signal.aborted || !sourceCurrent() || !target.isCurrent()) return;
          const result = await sender.current(document, { type: "scalar_field_binding", label, expected, notify: false }, { target, signal: controller.signal });
          if (!result || typeof result !== "object" || !("lease" in result) || typeof result.lease !== "string" || !result.lease || result.lease.length > 128) throw new Error("The scene could not bind the scientific source.");
          lease = result.lease;
          binding.current = { target, lease };
        }
        if (controller.signal.aborted || !sourceCurrent() || !target.isCurrent()) return;
        const grid = fieldKind === "file"
          ? science.grid!
          : await computeQuantumGrid(science, fieldKind === "orbital" ? { kind: "orbital", orbitalIndex: selected ?? 0 } : { kind: fieldKind }, { spacingAngstrom: spacing }, controller.signal);
        await sender.current(document, { type: "scalar_field_validate", lease, label, notify: false }, { target, signal: controller.signal });
        const cube = await serializeCube(grid, science.atoms, { signal: controller.signal });
        if (controller.signal.aborted || !sourceCurrent() || !target.isCurrent()) return;
        await send(cube, isovalue, target, lease, controller.signal);
        if (!controller.signal.aborted && sourceCurrent() && target.isCurrent()) setShown({ key: fieldKey, cube, lease, target, document, science });
      } catch (caught) {
        if (!isAbortError(caught) && !controller.signal.aborted && sourceCurrent()) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setWanted(false);
        }
      } finally {
        if (job.current === controller) { job.current = null; setComputing(false); }
      }
    })();
    return () => {
      controller.abort();
      if (job.current === controller) { job.current = null; setComputing(false); }
    };
  }, [wanted, fieldKey, document, science]);

  const hide = () => {
    job.current?.abort();
    setWanted(false);
    setShown(null);
    const target = sceneTarget.current;
    if (target) void Promise.resolve(send("", isovalue, target.target, target.lease)).catch((caught) => { if (sourceCurrent() && !isAbortError(caught)) setError(caught instanceof Error ? caught.message : String(caught)); });
  };

  // The isovalue reuses the calculated grid. Hide, a new field or unmount cancels a
  // pending resend, and the timer re-checks the live state before it sends.
  const live = useRef({ wanted, shown: currentShown, fieldKey });
  live.current = { wanted, shown: currentShown, fieldKey };
  useEffect(() => {
    if (!wanted || !currentShown || currentShown.key !== fieldKey || sentIsovalue.current === isovalue) return undefined;
    const target = currentShown;
    const timer = window.setTimeout(() => {
      const current = live.current;
      if (!sourceCurrent() || !target.target.isCurrent() || !current.wanted || current.shown !== target || current.fieldKey !== target.key) return;
      void Promise.resolve(send(target.cube, isovalue, target.target, target.lease)).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isovalue, wanted, shown, fieldKey]);

  const exportCube = async () => {
    const value = currentShown;
    if (!value || value.key !== fieldKey || !sourceCurrent() || !value.target.isCurrent()) return;
    setSaving(true); setError(null);
    try {
      // Native acceptance authorizes this immutable field snapshot, including its captured filename.
      // A later native edit while the ACK or save dialog is pending does not relabel the export.
      await sender.current(document, { type: "scalar_field_validate", lease: value.lease, label, notify: false }, { target: value.target });
      if (!sourceCurrent() || !value.target.isCurrent()) return;
      const result = await actions.saveKetcherExportFile({ title: `${fileStem(document.title)}-${fieldKind === "orbital" ? `orbital-${(selected ?? 0) + 1}` : fieldKind}.cube`, extension: "cube", text: value.cube });
      if (sourceCurrent() && result.status === "failed") setError(result.message);
    } catch (caught) { if (sourceCurrent()) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (sourceCurrent()) setSaving(false); }
  };

  const homo = science.orbitals.find((orbital) => orbital.spin === spin && frontier.get(orbital.index) === "HOMO");
  const lumo = science.orbitals.find((orbital) => orbital.spin === spin && frontier.get(orbital.index) === "LUMO");

  return (
    <div className="dock-content workbench-panel orbitals-panel">
      {fieldKinds.length > 0 ? (
        <div className="workbench-controls">
          {fieldKinds.length > 1 ? (
            <SegmentedControl aria-label="Field" value={fieldKind} onValueChange={(value) => {
              const next = value as FieldKind;
              setFieldKind(next);
              setIsovalue(DEFAULT_ISOVALUE[next]);
            }}>
              {fieldKinds.map((kind) => <SegmentedControlItem key={kind} value={kind}>{FIELD_LABELS[kind]}</SegmentedControlItem>)}
            </SegmentedControl>
          ) : null}
          <div className="workbench-row">
            <label className="workbench-field">
              <span>Isovalue{FIELD_UNITS[fieldKind] ? `, ${FIELD_UNITS[fieldKind]}` : ""}</span>
              <ScrubNumberField aria-label={`Isovalue${FIELD_UNITS[fieldKind] ? `, ${FIELD_UNITS[fieldKind]}` : ""}`} value={isovalue} min={0.0001} max={10}
                step={0.005} smallStep={0.0005} largeStep={0.05} formatValue={(value) => value.toPrecision(3)}
                onValueChange={setIsovalue} onValueCommitted={setIsovalue} />
            </label>
            {fieldKind !== "file" ? (
              <label className="workbench-field">
                <span>Grid, Å</span>
                <NativeSelect size="sm" aria-label="Grid spacing, Å" value={String(spacing)} onChange={(event) => setSpacing(Number(event.target.value))}>
                  {SPACINGS.map((value) => <NativeSelectOption key={value} value={String(value)}>{value.toFixed(1)}</NativeSelectOption>)}
                </NativeSelect>
              </label>
            ) : null}
            <div className="workbench-actions">
              <Button type="button" variant="ghost" size="xs" disabled={!currentShown || currentShown.key !== fieldKey || computing || saving} onClick={() => void exportCube()}>Export Cube</Button>
              {computing ? (
                <>
                  <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Calculating</span>
                  <Button type="button" variant="ghost" size="xs" onClick={hide}>Cancel</Button>
                </>
              ) : wanted ? (
                <Button type="button" variant="secondary" size="xs" onClick={hide}>Hide surface</Button>
              ) : (
                <Button type="button" size="xs" disabled={fieldKind === "orbital" && selected === null} onClick={() => setWanted(true)}>Show surface</Button>
              )}
            </div>
          </div>
          {error ? <p role="alert" className="workbench-error">{error}</p> : null}
        </div>
      ) : null}
      {science.orbitals.length ? (
        <>
          <div className="workbench-row">
            {hasBeta ? (
              <SegmentedControl aria-label="Spin" value={spin} onValueChange={(value) => setSpin(value as "alpha" | "beta")}>
                <SegmentedControlItem value="alpha">α</SegmentedControlItem>
                <SegmentedControlItem value="beta">β</SegmentedControlItem>
              </SegmentedControl>
            ) : null}
            {homo && lumo ? <span className="workbench-value">Gap {((lumo.energyHartree - homo.energyHartree) * HARTREE_EV).toFixed(3)} eV</span> : null}
          </div>
          <table className="workbench-table" aria-label="Molecular orbitals">
            <thead>
              <tr><th scope="col">Orbital</th><th scope="col">Occupancy</th><th scope="col">Energy, Eh</th><th scope="col">Energy, eV</th></tr>
            </thead>
            <tbody>
              {listed.map((orbital) => {
                const isSelected = fieldKind === "orbital" && hasBasis && orbital.index === selected;
                return (
                  <tr key={orbital.index} aria-selected={isSelected} data-selectable={hasBasis || undefined}
                    tabIndex={hasBasis ? 0 : undefined}
                    onClick={hasBasis ? () => { setSelected(orbital.index); setFieldKind("orbital"); } : undefined}
                    onKeyDown={hasBasis ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(orbital.index); setFieldKind("orbital"); } } : undefined}>
                    <th scope="row">{orbital.index + 1}{frontier.get(orbital.index) ? <span className="workbench-tag">{frontier.get(orbital.index)}</span> : null}{orbital.symmetry ? <span className="workbench-muted"> {orbital.symmetry}</span> : null}</th>
                    <td>{orbital.occupancy.toFixed(orbital.occupancy % 1 ? 3 : 0)}</td>
                    <td>{orbital.energyHartree.toFixed(5)}</td>
                    <td>{(orbital.energyHartree * HARTREE_EV).toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

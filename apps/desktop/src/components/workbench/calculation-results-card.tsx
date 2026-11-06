import { useEffect, useState, useSyncExternalStore } from "react";
import type { AtomicChargeSet, ScientificDocument, ScientificFrame, Thermochemistry } from "../../lib/molecular-workbench/scientific-types";
import { requestViewerAction } from "../../lib/viewer-bridge";
import { sourceExtension, useScientificDocument, useTrajectoryFrame } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import { Checkbox } from "../ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import "./calculation-results.css";

const MODEL_NAMES: Record<AtomicChargeSet["model"], string> = {
  mulliken: "Mulliken", lowdin: "Löwdin", hirshfeld: "Hirshfeld", cm5: "CM5", npa: "NPA", esp: "ESP", chelpg: "ChElPG", eeq: "EEQ", gasteiger: "Gasteiger",
};
type OverlayKind = "charge-colors" | "charges" | "dipole";
type Choice = { model: AtomicChargeSet["model"] | null; shown: Record<OverlayKind, boolean> };

// What each scene shows, kept while the dock switches documents: the overlays stay in that scene.
const choices = new Map<string, Choice>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const NONE: Choice = { model: null, shown: { "charge-colors": false, charges: false, dipole: false } };
// What each scene draws now, so a change redraws only the overlays it affects.
const drawn = new Map<string, Map<OverlayKind, { frame: ScientificFrame; model?: AtomicChargeSet["model"] }>>();
function setChoice(documentId: string, next: Choice) {
  choices.set(documentId, next);
  listeners.forEach(listener => listener());
}

/**
 * The frame the scene shows, as for spectra: a final import is one XYZ frame of the reference geometry,
 * a CJSON scene its active set, and a trajectory its current frame when it has the file's frames.
 */
function useSceneFrame(document: ViewerDocument, science: ScientificDocument | null, text: string | null): ScientificFrame | null {
  const trajectory = useTrajectoryFrame(document.id);
  if (!science) return null;
  const graph = science.format === "cjson" ? science.graph : undefined;
  if (graph) return sourceExtension(document) === "mol" && graph.molfile === text ? science.frames[graph.activeFrameIndex] ?? null : null;
  const lines = text?.replace(/\r\n?/gu, "\n").trimEnd().split("\n") ?? [];
  const final = sourceExtension(document) === "xyz" && lines.length === Number(lines[0]) + 2;
  const index = final || science.frames.length <= 1 ? science.referenceFrameIndex ?? 0
    : !trajectory ? 0 : trajectory.frameCount === science.frames.length ? trajectory.frameIndex : -1;
  return science.frames[index] ?? null;
}

const signed = (value: number, digits: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(digits)}`;
const hartree = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(6)} Eh`;

function overlayFor(kind: OverlayKind, frame: ScientificFrame, charges: AtomicChargeSet | undefined) {
  if (kind === "dipole") {
    const centre = [0, 1, 2].map(axis => frame.atoms.reduce((sum, atom) => sum + [atom.x, atom.y, atom.z][axis], 0) / frame.atoms.length);
    // One angstrom per debye, from the centre of the atoms.
    return { origin: centre, vector: frame.dipoleDebye, label: `${Math.hypot(...frame.dipoleDebye!).toFixed(2)} D` };
  }
  if (!charges) return null;
  if (kind === "charges") return { positions: frame.atoms.map(atom => [atom.x, atom.y, atom.z]), labels: charges.values.map(value => signed(value, 2)) };
  return { values: charges.values, source: `${MODEL_NAMES[charges.model]} charges` };
}

/**
 * Calculated properties of the geometry the scene shows: partial charges as atom colours or labels,
 * the dipole moment as an arrow, and the thermochemistry of the frequency job.
 */
export function CalculationResultsCard({ document }: { document: ViewerDocument }) {
  const { document: science, text } = useScientificDocument(document);
  const frame = useSceneFrame(document, science, text);
  const choice = useSyncExternalStore(subscribe, () => choices.get(document.id) ?? NONE, () => NONE);
  const [error, setError] = useState<string | null>(null);
  const sets = frame?.charges ?? [];
  const charges = sets.find(set => set.model === choice.model) ?? sets[0];
  const dipole = frame?.dipoleDebye ? Math.hypot(...frame.dipoleDebye) : null;
  const thermochemistry = frame?.thermochemistry ?? (science ? science.frames[science.referenceFrameIndex ?? 0]?.thermochemistry : undefined);

  // Each shown overlay follows the frame and the chosen charge model; a hidden one is removed once.
  useEffect(() => {
    if (!frame) return undefined;
    const controller = new AbortController();
    const scene = drawn.get(document.id) ?? new Map();
    drawn.set(document.id, scene);
    const kinds: OverlayKind[] = ["charge-colors", "charges", "dipole"];
    void Promise.all(kinds.map(async kind => {
      const overlay = choice.shown[kind] ? overlayFor(kind, frame, charges) : null;
      const current = scene.get(kind), model = kind === "dipole" ? undefined : charges?.model;
      if (overlay ? current?.frame === frame && current.model === model : !current) return;
      await requestViewerAction(document.id, { type: "calculation_overlay", kind, ...(overlay ? { overlay } : {}) }, 15_000, controller.signal);
      if (overlay) scene.set(kind, { frame, model }); else scene.delete(kind);
    })).then(() => setError(null), (caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => controller.abort();
  }, [document.id, frame, charges, choice]);

  if (!frame || (!sets.length && dipole === null && !thermochemistry)) return null;
  const toggle = (kind: OverlayKind, value: boolean) => setChoice(document.id, { ...choice, model: charges?.model ?? null, shown: { ...choice.shown, [kind]: value } });

  return (
    <>
      {sets.length || dipole !== null ? (
        <section className="structure-brief-card" aria-label="Charges and dipole">
          <div className="structure-brief-card-header">
            <h4>{sets.length ? "Charges" : "Dipole moment"}</h4>
            {sets.length > 1 ? (
              <NativeSelect size="sm" name="charge-model" aria-label="Charge model" value={charges!.model}
                onChange={event => setChoice(document.id, { ...choice, model: event.target.value as AtomicChargeSet["model"] })}>
                {sets.map(set => <NativeSelectOption key={set.model} value={set.model}>{MODEL_NAMES[set.model]}</NativeSelectOption>)}
              </NativeSelect>
            ) : sets.length ? <span className="calculation-results-value">{MODEL_NAMES[sets[0].model]}</span>
              : <span className="calculation-results-value">{`${dipole!.toFixed(2)} D`}</span>}
          </div>
          {sets.length && dipole !== null ? (
            <div className="structure-brief-row"><span>Dipole</span><strong>{`${dipole.toFixed(2)} D`}</strong></div>
          ) : null}
          <div className="calculation-results-toggles">
            {sets.length ? <>
              <label className="calculation-results-toggle" title="Negative charges are blue, positive orange.">
                <Checkbox checked={choice.shown["charge-colors"]} onCheckedChange={value => toggle("charge-colors", value === true)} />Color atoms
              </label>
              <label className="calculation-results-toggle">
                <Checkbox checked={choice.shown.charges} onCheckedChange={value => toggle("charges", value === true)} />Labels
              </label>
            </> : null}
            {dipole !== null ? (
              <label className="calculation-results-toggle">
                <Checkbox checked={choice.shown.dipole} disabled={dipole < 0.01} onCheckedChange={value => toggle("dipole", value === true)} />Dipole arrow
              </label>
            ) : null}
          </div>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </section>
      ) : null}
      {thermochemistry ? <ThermochemistryCard values={thermochemistry} /> : null}
    </>
  );
}

function ThermochemistryCard({ values }: { values: Thermochemistry }) {
  const rows: [string, string][] = [["Temperature", `${values.temperatureKelvin.toFixed(2)} K`]];
  if (values.zeroPointHartree !== undefined) rows.push(["Zero-point", hartree(values.zeroPointHartree)]);
  if (values.enthalpyHartree !== undefined) rows.push(["Enthalpy", hartree(values.enthalpyHartree)]);
  if (values.gibbsHartree !== undefined) rows.push(["Gibbs energy", hartree(values.gibbsHartree)]);
  if (values.entropyCalMolKelvin !== undefined) rows.push(["Entropy", `${values.entropyCalMolKelvin.toFixed(2)} cal/(mol·K)`]);
  return (
    <section className="structure-brief-card" aria-label="Thermochemistry">
      <div className="structure-brief-card-header"><h4>Thermochemistry</h4></div>
      <div className="structure-brief-rows">
        {rows.map(([label, value]) => <div key={label} className="structure-brief-row"><span>{label}</span><strong>{value}</strong></div>)}
      </div>
    </section>
  );
}

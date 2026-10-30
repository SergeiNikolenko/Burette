import { useEffect, useMemo, useRef, useState } from "react";
import { displaceNormalMode, type ScientificDocument, type VibrationalMode } from "../../lib/molecular-workbench/quantum";
import type { CartesianHessian } from "../../lib/molecular-workbench/hessian";
import type { MolecularAtom } from "../../lib/molecular-workbench/types";
import { hessianJson, spectrumCsv, spectrumJson, type SpectrumProvenance } from "../../lib/molecular-workbench/vibrational-spectrum";
import { useImportedOriginal, useTrajectoryFrame } from "../../lib/workbench/source";
import { vibrationalModes, formatFrequency } from "../../lib/workbench/vibrational-modes";
import { VibrationalSpectrum } from "./vibrational-spectrum";
import { parseXyz, serializeXyz } from "../../lib/molecular-workbench/xyz";
import { useGeometryBinding } from "../../hooks/use-geometry-binding";
import { useGeometryLivePreview } from "../../hooks/use-geometry-live-preview";
import { fileStem, multiFrameXyz } from "../../lib/workbench/formats";
import { openGeneratedStructure } from "../../lib/workbench/generated-document-open";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { ChevronDown, FileBlank, Play, Stop } from "../ui/app-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { PanelEmptyState } from "../ui/panel-empty-state";
import "./workbench-layout.css";
import "./vibrations.css";

const PERIOD_MS = 1000;
const TRAJECTORY_FRAMES = 20;

// `frame` is the one-based frame number users see; `key` stays stable for remounts and remembered choices.
// `modes` are the vibrations shown; `sourceModes` are every row the file gives this geometry, as saved.
type FrameModes = { key: string; frame: number | null; atoms: MolecularAtom[]; modes: VibrationalMode[]; sourceModes: VibrationalMode[]; hessian?: CartesianHessian };

/**
 * The modes of the geometry the scene shows. A single-geometry scene shows the
 * final structure, which the document's own modes describe. In a trajectory each
 * frame has only its own modes; when the scene's frames do not match the file's,
 * there is no frame whose modes could safely be shown.
 */
function useSceneModes(document: ViewerDocument, science: ScientificDocument, singleGeometry: boolean): FrameModes | null {
  const frame = useTrajectoryFrame(document.id);
  const perFrame = science.frames.some((item) => item.modes?.length);
  if (singleGeometry || science.frames.length <= 1 || !perFrame) {
    return { key: "final", frame: null, atoms: science.atoms, modes: vibrationalModes(science.modes), sourceModes: science.modes, hessian: science.frames.at(-1)?.hessian };
  }
  // The scene starts at the first frame and reports every later change.
  const index = !frame ? 0 : frame.frameCount === science.frames.length ? frame.frameIndex : null;
  if (index === null) return null;
  const active = science.frames[index];
  return { key: `frame-${index}`, frame: index + 1, atoms: active.atoms, modes: vibrationalModes(active.modes), sourceModes: active.modes ?? [], hessian: active.hessian };
}

// The chosen mode per document and frame, so switching tabs or files keeps it.
const chosenModes = new Map<string, number>();
const CHOSEN_LIMIT = 64;
function rememberMode(key: string, index: number) {
  chosenModes.delete(key);
  chosenModes.set(key, index);
  while (chosenModes.size > CHOSEN_LIMIT) chosenModes.delete(chosenModes.keys().next().value!);
}

export function VibrationsPanel({ document, actions, science, liveAnimation }: { document: ViewerDocument; actions: ShellActions; science: ScientificDocument; liveAnimation: boolean }) {
  const scene = useSceneModes(document, science, liveAnimation);
  if (!scene) {
    return <div className="dock-content dock-content-empty"><PanelEmptyState icon={<FileBlank />} title="No modes for this frame" description="The scene shows different frames than this file." /></div>;
  }
  if (!scene.modes.length) {
    return <div className="dock-content dock-content-empty"><PanelEmptyState icon={<FileBlank />} title={`No vibrational modes for ${scene.frame ? `Frame ${scene.frame}` : "this geometry"}`} /></div>;
  }
  // A new frame remounts the list: its animation stops and nothing of the previous geometry carries over.
  return <FrameVibrations key={scene.key} document={document} actions={actions} science={science} scene={scene} liveAnimation={liveAnimation} />;
}

function FrameVibrations({ document, actions, science, scene, liveAnimation }: { document: ViewerDocument; actions: ShellActions; science: ScientificDocument; scene: FrameModes; liveAnimation: boolean }) {
  const { modes, atoms: geometry } = scene;
  const memoryKey = `${document.id}\u0000${scene.key}`;
  const [selected, setSelected] = useState<number | null>(() => {
    const remembered = chosenModes.get(memoryKey);
    return modes.some((mode) => mode.index === remembered) ? remembered! : modes.find((mode) => mode.displacements)?.index ?? null;
  });
  const [amplitude, setAmplitude] = useState(0.3);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bindingIdentity = useMemo(() => ({ atoms: geometry, modes: science.modes, frame: scene.key }), [geometry, science.modes, scene.key]);
  const { binding, error: bindingError, key: bindingKey } = useGeometryBinding(document, actions.runStructureViewerAction, bindingIdentity, (value) => {
    const atoms = parseXyz(value.text).atoms;
    return atoms.length === geometry.length && atoms.every((atom, index) => atom.element === geometry[index].element
      && ["x", "y", "z"].every((axis) => Math.abs(atom[axis as "x" | "y" | "z"] - geometry[index][axis as "x" | "y" | "z"]) <= 1e-3));
  }, liveAnimation);
  const live = useGeometryLivePreview(document, binding, actions.runStructureViewerAction, (caught) => {
    setPlaying(false);
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const baseline = binding?.text ?? "";
  useEffect(() => { setPlaying(false); }, [bindingKey]);
  const mode = modes.find((candidate) => candidate.index === selected) ?? null;
  const settings = useRef({ mode, amplitude });
  settings.current = { mode, amplitude };

  useEffect(() => {
    if (!playing || !binding) return undefined;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const { mode: current, amplitude: value } = settings.current;
      if (!current?.displacements) return;
      try {
        live.preview(serializeXyz(displaceNormalMode(geometry, current, value, 2 * Math.PI * (now - start) / PERIOD_MS), ""), baseline);
      } catch (caught) {
        setPlaying(false);
        setError(caught instanceof Error ? caught.message : String(caught));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); live.cancel(); };
  }, [playing, baseline, binding]);

  // Choosing a mode shows it moving, as the mode list does in desktop editors;
  // reduced motion keeps the scene still until Animate is pressed.
  const choose = (index: number) => {
    setSelected(index);
    rememberMode(memoryKey, index);
    setError(null);
    const next = modes.find((candidate) => candidate.index === index);
    if (binding && liveAnimation && next?.displacements && !prefersReducedMotion()) setPlaying(true);
  };

  // Saved spectra name the uploaded file and the geometry their modes belong to.
  const original = useImportedOriginal(document.id);
  const save = (kind: "csv" | "json" | "hessian") => {
    setError(null);
    void Promise.resolve().then(() => {
      const provenance: SpectrumProvenance = { sourceName: original?.name ?? document.title, format: science.format, frame: scene.frame, frameCount: science.frames.length };
      const stem = `${fileStem(original?.name ?? document.title)}${scene.frame ? `-frame-${scene.frame}` : ""}`;
      const text = kind === "csv" ? spectrumCsv(scene.sourceModes, provenance)
        : kind === "json" ? spectrumJson(scene.sourceModes, provenance)
        : hessianJson(scene.hessian!, geometry, provenance);
      const extension = kind === "csv" ? "csv" : "json";
      return actions.saveKetcherExportFile({ title: `${stem}-${kind === "hessian" ? "hessian" : "spectrum"}.${extension}`, extension, text });
    }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  const open = (layout: "trajectory" | "plus" | "minus") => {
    if (!mode?.displacements) return;
    try {
      const stem = `${fileStem(document.title)}${scene.frame ? `-frame-${scene.frame}` : ""}-mode-${mode.index}`;
      // Each comment names the source frame, so the exported geometry keeps its provenance.
      const source = `${scene.frame ? `Frame ${scene.frame} ` : ""}Mode ${mode.index} ${formatFrequency(mode)} cm-1`;
      if (layout === "trajectory") {
        const frames = Array.from({ length: TRAJECTORY_FRAMES }, (_, step) => ({
          atoms: displaceNormalMode(geometry, mode, amplitude, 2 * Math.PI * step / TRAJECTORY_FRAMES),
          comment: `${source} phase ${step + 1}/${TRAJECTORY_FRAMES}`,
        }));
        void openGeneratedStructure(actions, stem, "xyz", multiFrameXyz(frames));
        return;
      }
      // A quarter period is the full amplitude along the mode; three quarters is the opposite turning point.
      const sign = layout === "plus" ? "+" : "-";
      const atoms = displaceNormalMode(geometry, mode, amplitude, layout === "plus" ? Math.PI / 2 : -Math.PI / 2);
      void openGeneratedStructure(actions, `${stem}${layout === "plus" ? "-plus" : "-minus"}`, "xyz",
        serializeXyz(atoms, `${source} displaced ${sign}${amplitude.toFixed(2)} A`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="dock-content workbench-panel">
      <VibrationalSpectrum modes={modes} sourceModes={scene.sourceModes} selected={selected} onSelect={choose} />
      <div className="workbench-row">
        <label className="workbench-field">
          <span>Amplitude, Å</span>
          <ScrubNumberField aria-label="Amplitude, Å" value={amplitude} min={0.01} max={2} step={0.05} smallStep={0.01} largeStep={0.25}
            formatValue={(value) => value.toFixed(2)} onValueChange={setAmplitude} onValueCommitted={setAmplitude} />
        </label>
        <div className="workbench-actions">
          {liveAnimation ? (
            <Button type="button" size="xs" variant={playing ? "secondary" : "default"} disabled={!binding || !mode?.displacements}
              onClick={() => { setError(null); setPlaying((value) => !value); }}>
              {playing ? <Stop aria-hidden /> : <Play aria-hidden />}{playing ? "Stop" : "Animate"}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="xs" variant={liveAnimation ? "ghost" : "default"} disabled={!mode?.displacements}>Open<ChevronDown aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => open("trajectory")}>Trajectory</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => open("plus")}>Displaced +{amplitude.toFixed(2)} Å</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => open("minus")}>Displaced −{amplitude.toFixed(2)} Å</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="xs" variant="ghost">Export<ChevronDown aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => save("csv")}>Spectrum as CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => save("json")}>Spectrum as JSON</DropdownMenuItem>
              {scene.hessian ? <DropdownMenuItem onSelect={() => save("hessian")}>Hessian as JSON</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error || bindingError ? <p role="alert" className="workbench-error">{error || bindingError}</p> : null}
      <table className="workbench-table" aria-label="Vibrational modes">
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Frequency, cm⁻¹</th>
            {modes.some((candidate) => candidate.symmetry) ? <th scope="col">Symmetry</th> : null}
            {modes.some((candidate) => candidate.intensityKmMol !== undefined) ? <th scope="col">IR, km/mol</th> : null}
            {modes.some((candidate) => candidate.intensityKmMol === undefined && candidate.transitionDipoleSquared !== undefined) ? <th scope="col">T², a.u.</th> : null}
            {modes.some((candidate) => candidate.ramanActivityAngstrom4Amu !== undefined) ? <th scope="col">Raman activity, Å⁴/amu</th> : null}
            {modes.some((candidate) => candidate.ramanDepolarizationRatio !== undefined) ? <th scope="col">Depolarization</th> : null}
          </tr>
        </thead>
        <tbody>
          {modes.map((candidate) => (
            <tr key={candidate.index} aria-selected={candidate.index === selected} data-selectable tabIndex={0}
              onClick={() => choose(candidate.index)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(candidate.index); } }}>
              <th scope="row">{candidate.index}</th>
              <td>{formatFrequency(candidate)}</td>
              {modes.some((item) => item.symmetry) ? <td>{candidate.symmetry ?? ""}</td> : null}
              {modes.some((item) => item.intensityKmMol !== undefined) ? <td>{candidate.intensityKmMol?.toFixed(2) ?? ""}</td> : null}
              {modes.some((item) => item.intensityKmMol === undefined && item.transitionDipoleSquared !== undefined) ? <td>{candidate.transitionDipoleSquared?.toExponential(2) ?? ""}</td> : null}
              {modes.some((item) => item.ramanActivityAngstrom4Amu !== undefined) ? <td>{candidate.ramanActivityAngstrom4Amu?.toFixed(2) ?? ""}</td> : null}
              {modes.some((item) => item.ramanDepolarizationRatio !== undefined) ? <td>{candidate.ramanDepolarizationRatio?.toFixed(3) ?? ""}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

import { useMemo, useRef, useState } from "react";
import { PEPTIDE_BACKBONE_PRESETS } from "../../lib/molecular-workbench/peptide-geometry";
import { runPeptideTask, type PeptideBuildRequest, type PeptideBuildResult } from "../../lib/workbench/peptide-task";
import { openGeneratedStructure } from "../../lib/workbench/generated-document-open";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import GridMolecule3D from "../grid-molecule-3d";
import { Button } from "../ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";
import { InsertBuiltStructureButton } from "./insert-built-structure";

const PRESETS = { extended: "Extended", alpha: "α helix", beta: "β sheet", helix310: "3₁₀ helix", pi: "π helix" };
// A D chain takes the mirror image of each conformation, e.g. a left-handed α helix.
const mirror = (angle: number) => angle === 180 ? 180 : -angle;

export function PeptideBuilderBody({ actions, document, isCurrent, onDone }: {
  actions: Pick<ShellActions, "openStructureRecords">; isCurrent: () => boolean; onDone: () => void;
  /** The active document: an editable MOL/SDF also offers Insert into it. */
  document: ViewerDocument | null;
}) {
  const [sequence, setSequence] = useState("");
  const [codes, setCodes] = useState<"one" | "three">("one");
  const [chirality, setChirality] = useState<"L" | "D">("L");
  const [phi, setPhi] = useState(180), [psi, setPsi] = useState(180);
  const [nTerminus, setNTerminus] = useState<"amine" | "ammonium">("amine");
  const [cTerminus, setCTerminus] = useState<"acid" | "carboxylate">("acid");
  const [chain, setChain] = useState("A");
  const request = useMemo<PeptideBuildRequest>(() => ({ sequence, codes, options: { chirality, phi, psi, nTerminus, cTerminus, chain } }),
    [sequence, codes, chirality, phi, psi, nTerminus, cTerminus, chain]);
  const latest = useRef(request); latest.current = request;
  const submission = useRef<object | null>(null);
  const [preview, setPreview] = useState<{ request: PeptideBuildRequest; result: PeptideBuildResult } | null>(null);
  const currentPreview = preview?.request === request ? preview.result : null;
  const job = useCancellableJob();
  const preferences = useSettingsStore(state => state.preferences);
  const theme = resolveThemeMode(preferences.theme, useSystemThemeMode());
  const oriented = (angle: number) => chirality === "D" ? mirror(angle) : angle;
  const preset = Object.entries(PEPTIDE_BACKBONE_PRESETS).find(([, angles]) => oriented(angles.phi) === phi && oriented(angles.psi) === psi)?.[0] ?? "custom";

  const build = async (create: boolean) => {
    if (submission.current || !isCurrent()) return;
    const own = {}; submission.current = own;
    try {
      await job.run(create ? "Creating peptide…" : "Building preview…", async signal => {
        const valid = () => !signal.aborted && latest.current === request && isCurrent();
        const result = currentPreview ?? await runPeptideTask(request, { signal });
        if (!valid()) return;
        setPreview({ request, result });
        if (!create) return;
        const opened = await openGeneratedStructure(actions, `Peptide ${result.sequence}`, "cif", result.cif, valid, { newDocument: true });
        if (!valid()) return;
        if (!opened.length) throw new Error("Could not open the peptide. Try Create again.");
        onDone();
      });
    } finally { if (submission.current === own) submission.current = null; }
  };
  // Insert reuses the preview of the current request, or builds it and shows it.
  const built = async () => {
    const result = currentPreview ?? await runPeptideTask(request);
    if (latest.current === request) setPreview({ request, result });
    return result.graph;
  };
  const cancel = () => { submission.current = null; job.cancel(); };
  return <>
    <DialogHeader><DialogTitle>Build peptide</DialogTitle></DialogHeader>
    <fieldset disabled={Boolean(job.running)} className="workbench-form min-w-0 border-0 p-0">
      <label className="workbench-field"><span>Sequence</span>
        <Input aria-label="Sequence" name="sequence" variant="compact" value={sequence} maxLength={1024} spellCheck={false} autoComplete="off" onChange={event => setSequence(event.target.value)} />
      </label>
      <div className="workbench-row">
        <SegmentedControl aria-label="Amino-acid codes" value={codes} onValueChange={value => setCodes(value as "one" | "three")}>
          <SegmentedControlItem value="one">One letter</SegmentedControlItem><SegmentedControlItem value="three">Three letters</SegmentedControlItem>
        </SegmentedControl>
        <SegmentedControl aria-label="Chirality" value={chirality} onValueChange={value => {
          if ((value !== "L" && value !== "D") || value === chirality) return;
          setChirality(value as "L" | "D"); setPhi(mirror(phi)); setPsi(mirror(psi));
        }}>
          <SegmentedControlItem value="L">L</SegmentedControlItem><SegmentedControlItem value="D">D</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="workbench-grid">
        <label className="workbench-field"><span>Backbone</span>
          <NativeSelect aria-label="Backbone" size="sm" value={preset} onChange={event => {
            const angles = PEPTIDE_BACKBONE_PRESETS[event.target.value as keyof typeof PEPTIDE_BACKBONE_PRESETS];
            if (angles) { setPhi(oriented(angles.phi)); setPsi(oriented(angles.psi)); }
          }}>
            {Object.entries(PRESETS).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            <NativeSelectOption value="custom" disabled>Custom</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="workbench-field"><span>φ, °</span><ScrubNumberField aria-label="Phi, degrees" value={phi} min={-180} max={180} step={1} onValueChange={setPhi} onValueCommitted={setPhi} /></label>
        <label className="workbench-field"><span>ψ, °</span><ScrubNumberField aria-label="Psi, degrees" value={psi} min={-180} max={180} step={1} onValueChange={setPsi} onValueCommitted={setPsi} /></label>
        <label className="workbench-field"><span>N-terminus</span><NativeSelect aria-label="N-terminus" size="sm" value={nTerminus} onChange={event => setNTerminus(event.target.value as typeof nTerminus)}>
          <NativeSelectOption value="amine">Amine</NativeSelectOption><NativeSelectOption value="ammonium">Ammonium (+)</NativeSelectOption>
        </NativeSelect></label>
        <label className="workbench-field"><span>C-terminus</span><NativeSelect aria-label="C-terminus" size="sm" value={cTerminus} onChange={event => setCTerminus(event.target.value as typeof cTerminus)}>
          <NativeSelectOption value="acid">Carboxylic acid</NativeSelectOption><NativeSelectOption value="carboxylate">Carboxylate (−)</NativeSelectOption>
        </NativeSelect></label>
        <label className="workbench-field"><span>Chain</span><Input aria-label="Chain" name="chain" autoComplete="off" spellCheck={false} variant="compact" maxLength={1} value={chain} onChange={event => setChain(event.target.value)} /></label>
      </div>
    </fieldset>
    {currentPreview ? <GridMolecule3D molblock={currentPreview.cif} format="mmcif" label="Peptide" height={240} theme={theme} hydrogenDisplay={preferences.hydrogenDisplay} onOpen={() => {}} /> : null}
    {job.error ? <p role="alert" className="text-sm text-destructive">{job.error}</p> : null}
    <DialogFooter>
      {job.running ? <span className="workbench-status" role="status" aria-live="polite"><Spinner aria-label={job.running} />{job.running}</span> : null}
      <Button type="button" variant="outline" onClick={() => { if (job.running) cancel(); else onDone(); }}>Cancel</Button>
      <Button type="button" variant="outline" disabled={Boolean(job.running) || !sequence.trim()} onClick={() => { void build(false); }}>Preview</Button>
      <InsertBuiltStructureButton document={document} name={`Peptide ${sequence.trim()}`} disabled={Boolean(job.running) || !sequence.trim()} build={built} />
      <Button type="button" disabled={Boolean(job.running) || !sequence.trim()} onClick={() => { void build(true); }}>Create</Button>
    </DialogFooter>
  </>;
}

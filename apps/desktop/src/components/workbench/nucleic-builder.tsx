import { useId, useMemo, useRef, useState } from "react";
import {
  NUCLEIC_ACID_FORMS, NUCLEIC_ACID_MAX_LENGTH, nucleicAcidAtomCount, nucleicFormUnavailable,
  type FivePrimeEnd, type HelixForm, type NucleicAcidType, type StrandCount,
} from "../../lib/molecular-workbench/nucleic";
import { runNucleicTask, type NucleicBuildRequest, type NucleicBuildResult } from "../../lib/workbench/nucleic-task";
import { openGeneratedStructure } from "../../lib/workbench/generated-document-open";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { MoleculeFilePreview } from "../molecule-file-preview";
import { Button } from "../ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useCancellableJob } from "./use-workbench-source";
import { InsertBuiltStructureButton } from "./insert-built-structure";

const FORMS: HelixForm[] = ["B", "A", "Z"];

export function NucleicBuilderBody({ actions, document, isCurrent, onDone }: {
  actions: Pick<ShellActions, "openStructureRecords">; isCurrent: () => boolean; onDone: () => void;
  /** The active document: an editable MOL/SDF also offers Insert into it. */
  document: ViewerDocument | null;
}) {
  const [sequence, setSequence] = useState("");
  const [type, setType] = useState<NucleicAcidType>("DNA");
  const [chosenForm, setForm] = useState<HelixForm>("B");
  const [strands, setStrands] = useState<StrandCount>("double");
  const [fivePrime, setFivePrime] = useState<FivePrimeEnd>("hydroxyl");
  // RNA offers only the A form; the user's DNA choice returns when DNA is chosen again.
  const form = NUCLEIC_ACID_FORMS[type].includes(chosenForm) ? chosenForm : NUCLEIC_ACID_FORMS[type][0];
  const request = useMemo<NucleicBuildRequest>(() => ({ sequence, options: { type, form, strands, fivePrime } }), [sequence, type, form, strands, fivePrime]);
  const latest = useRef(request); latest.current = request;
  const submission = useRef<object | null>(null);
  const [preview, setPreview] = useState<{ request: NucleicBuildRequest; result: NucleicBuildResult } | null>(null);
  const currentPreview = preview?.request === request ? preview.result : null;
  const job = useCancellableJob();
  const preferences = useSettingsStore(state => state.preferences);
  const theme = resolveThemeMode(preferences.theme, useSystemThemeMode());
  const formReason = useId(), problemId = useId();
  const unavailable = FORMS.map(value => nucleicFormUnavailable(type, value)).find(Boolean) ?? null;

  // Live validation: the same parser the worker runs, without building coordinates.
  const entered = sequence.trim() !== "";
  let atoms = 0, problem: string | null = null;
  if (entered) {
    try { atoms = nucleicAcidAtomCount(sequence, request.options); } catch (error) { problem = error instanceof Error ? error.message : String(error); }
  }
  const ready = entered && !problem && !job.running;

  const build = async (create: boolean) => {
    if (submission.current || !isCurrent() || !ready) return;
    const own = {}; submission.current = own;
    try {
      await job.run(create ? "Creating structure…" : "Building preview…", async signal => {
        const valid = () => !signal.aborted && latest.current === request && isCurrent();
        const result = currentPreview ?? await runNucleicTask(request, { signal });
        if (!valid()) return;
        setPreview({ request, result });
        if (!create) return;
        const opened = await openGeneratedStructure(actions, result.name, "cif", result.text, valid, { newDocument: true });
        if (!valid()) return;
        if (!opened.length) throw new Error("Could not open the structure. Try Create again.");
        onDone();
      });
    } finally { if (submission.current === own) submission.current = null; }
  };
  // Insert reuses the preview of the current request, or builds it and shows it.
  const built = async () => {
    const result = currentPreview ?? await runNucleicTask(request);
    if (latest.current === request) setPreview({ request, result });
    return result.graph;
  };
  const cancel = () => { submission.current = null; job.cancel(); };
  const set = <T,>(setter: (value: T) => void) => (value: string) => setter(value as T);
  return <>
    <DialogHeader><DialogTitle>Build DNA or RNA</DialogTitle></DialogHeader>
    <fieldset disabled={Boolean(job.running)} className="workbench-form min-w-0 border-0 p-0">
      <label className="workbench-field"><span>Sequence, 5′ to 3′</span>
        <Input aria-label="Sequence" name="sequence" variant="compact" value={sequence} spellCheck={false} autoComplete="off" autoCapitalize="characters"
          maxLength={8 * NUCLEIC_ACID_MAX_LENGTH} aria-invalid={Boolean(problem)} aria-describedby={problem ? problemId : undefined}
          onChange={event => setSequence(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void build(false); }} />
      </label>
      <div className="workbench-row">
        <SegmentedControl aria-label="Nucleic acid" value={type} onValueChange={set(setType)}>
          <SegmentedControlItem value="DNA">DNA</SegmentedControlItem><SegmentedControlItem value="RNA">RNA</SegmentedControlItem>
        </SegmentedControl>
        <TooltipProvider>
          <SegmentedControl aria-label="Helix" value={form} onValueChange={set(setForm)} aria-describedby={unavailable ? formReason : undefined}>
            {FORMS.map(value => {
              const reason = nucleicFormUnavailable(type, value);
              const item = <SegmentedControlItem key={value} value={value} disabled={Boolean(reason)}>{value}-form</SegmentedControlItem>;
              // A disabled item receives no pointer events; its wrapper shows the reason.
              return reason ? <Tooltip key={value}><TooltipTrigger asChild><span>{item}</span></TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip> : item;
            })}
          </SegmentedControl>
        </TooltipProvider>
        {unavailable ? <span id={formReason} className="sr-only">{unavailable}</span> : null}
        <SegmentedControl aria-label="Strands" value={strands} onValueChange={set(setStrands)}>
          <SegmentedControlItem value="single">Single strand</SegmentedControlItem><SegmentedControlItem value="double">Duplex</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className="workbench-row">
        <label className="workbench-field"><span>5′ end</span>
          <NativeSelect aria-label="5′ end" size="sm" value={fivePrime} onChange={event => setFivePrime(event.target.value as FivePrimeEnd)}>
            <NativeSelectOption value="hydroxyl">Hydroxyl</NativeSelectOption><NativeSelectOption value="phosphate">Phosphate (2−)</NativeSelectOption>
          </NativeSelect>
        </label>
        {entered && !problem ? <span className="workbench-value ml-auto" role="status" aria-live="polite">{atoms.toLocaleString("en-US")} atoms</span> : null}
      </div>
    </fieldset>
    {currentPreview ? <MoleculeFilePreview data={currentPreview.text} format="mmcif" label="Nucleic acid" height={240} theme={theme} hydrogenDisplay={preferences.hydrogenDisplay} onOpen={() => {}} /> : null}
    {problem ?? job.error ? <p id={problemId} role="alert" className="text-sm text-destructive">{problem ?? job.error}</p> : null}
    <DialogFooter>
      {job.running ? <span className="workbench-status" role="status" aria-live="polite"><Spinner aria-label={job.running} />{job.running}</span> : null}
      <Button type="button" variant="outline" onClick={() => { if (job.running) cancel(); else onDone(); }}>Cancel</Button>
      <Button type="button" variant="outline" disabled={!ready} onClick={() => { void build(false); }}>Preview</Button>
      <InsertBuiltStructureButton document={document} name={`${type} ${sequence.replace(/\s+/gu, "").toUpperCase()}`} disabled={!ready} build={built} />
      <Button type="button" disabled={!ready} onClick={() => { void build(true); }}>Create</Button>
    </DialogFooter>
  </>;
}

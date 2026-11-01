import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssemblyFormat } from "../../lib/molecular-workbench/biological-assembly";
import { pickBrowserFiles } from "../../lib/browser-file-picker";
import {
  ASSEMBLY_FILE_ACCEPT, ASSEMBLY_TEXT_LIMIT, ASSEMBLY_TOO_LARGE, assemblyFormatOfName, assemblySourceFormat, useAssemblySourceText,
} from "../../lib/workbench/assembly-source";
import { fileStem } from "../../lib/workbench/formats";
import { openGeneratedStructure } from "../../lib/workbench/open";
import { runAssemblyTask, type AssemblyResults } from "../../lib/workbench/assembly-task";
import { isAbortError } from "../../lib/viewer-errors";
import { useMoleculeStore } from "../../stores/molecule-store";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";

type Picked = { id: number; name: string; format: AssemblyFormat | null; text: string | null; error: string | null };
type Source = { key: string; name: string; format: AssemblyFormat | null; text: string | null; error: string | null };
type Listing = { revision: string; result: AssemblyResults["assemblies"] | null; error: string | null };
type Outcome = { key: string; name: string; result: AssemblyResults["assembly"] } | { key: string; error: string };

const assemblyMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return [ASSEMBLY_TOO_LARGE, "This file has no explicit biological assembly definition.", "Expanded biological assembly exceeds 250,000 atoms."].includes(message)
    ? message : "Could not build this assembly. Choose a PDB or mmCIF file with an explicit assembly and try again.";
};
let identities = 0;
const nextIdentity = () => ++identities;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/**
 * Builds a deposited biological assembly as a new mmCIF document. The source is the
 * open PDB or mmCIF document (its unsaved draft included) or a chosen file; the source
 * itself is never changed. A build belongs to the exact source text, assembly and model
 * it started from: changing any of them, closing the source or the dialog drops it, and
 * Cancel does too. That holds until its CIF is open: a build dropped while its document is
 * still being prepared opens nothing.
 */
export function AssemblyDialogBody({ document, actions, isCurrent, onDone }: { document: ViewerDocument | null; actions: Pick<ShellActions, "openStructureRecords">; isCurrent: () => boolean; onDone: () => void }) {
  const documentOpen = useMoleculeStore((state) => Boolean(document && state.documents.includes(document)));
  const usable = documentOpen && assemblySourceFormat(document) ? document : null;
  const documentText = useAssemblySourceText(usable);
  const [picked, setPicked] = useState<Picked | null>(null);
  const latestPick = useRef(0);
  const source: Source | null = picked ? { key: `file:${picked.id}`, ...picked }
    : usable ? { key: `document:${usable.id}`, name: usable.title, format: assemblySourceFormat(usable), text: documentText.text, error: documentText.error } : null;
  // One identity per exact source text; comparing texts themselves on every render would be O(size).
  const sourceKey = picked ? `file:${picked.id}` : usable ? `document:${usable.id}` : null;
  const sourceText = picked ? picked.text : usable ? documentText.text : null;
  const sourceFormat = picked ? picked.format : assemblySourceFormat(usable);
  const documentRevision = picked ? null : documentText.revision;
  const revision = useMemo(() => (sourceText !== null && sourceFormat ? `${sourceKey}:${nextIdentity()}` : null), [sourceKey, sourceText, sourceFormat, documentRevision]);

  const [listing, setListing] = useState<Listing | null>(null);
  useEffect(() => {
    if (!revision || sourceText === null || !sourceFormat) return undefined;
    const controller = new AbortController(), owner = picked ? null : documentText.capture();
    if (!picked && !owner) return;
    const valid = () => latestPick.current === (picked?.id ?? 0) && !controller.signal.aborted && isCurrent() && (!owner || owner.isCurrent());
    runAssemblyTask({ action: "assemblies", text: sourceText, format: sourceFormat }, { signal: controller.signal })
      .then((result) => { if (valid()) setListing({ revision, result, error: null }); })
      .catch((error) => { if (valid() && !isAbortError(error)) setListing({ revision, result: null, error: assemblyMessage(error) }); });
    return () => { controller.abort(); owner?.release(); };
  }, [revision]);
  const current = listing?.revision === revision ? listing : null;
  const assemblies = current?.result?.assemblies ?? [];
  const models = current?.result?.models ?? [];

  // Choices are the user's, made for one source: a single assembly or model needs none,
  // several always do, and another file starts without any.
  const [choice, setChoice] = useState<{ source: string | null; assembly: string | null; model: string | null }>({ source: null, assembly: null, model: null });
  const own = choice.source === sourceKey ? choice : { source: sourceKey, assembly: null, model: null };
  const assemblyChoice = own.assembly, modelChoice = own.model;
  const assemblyId = assemblies.length === 1 ? assemblies[0].id : assemblies.some(({ id }) => id === assemblyChoice) ? assemblyChoice : null;
  const modelNumber = models.length === 1 ? models[0] : modelChoice !== null && models.includes(modelChoice) ? modelChoice : null;
  const buildKey = revision && assemblyId && modelNumber ? `${revision}\u0000${assemblyId}\u0000${modelNumber}` : null;
  const job = useCancellableJob(buildKey);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const ownOutcome = outcome?.key === buildKey ? outcome : null;
  const shown = ownOutcome && "result" in ownOutcome ? ownOutcome : null;
  // The build whose CIF is being opened; the dialog stays busy, and cancellable, until it is open.
  const [openingFor, setOpeningFor] = useState<AbortSignal | null>(null);

  // An accepted file becomes the source at once, before it is read: the old source's
  // listing and build are dropped and nothing is offered until this text is listed.
  // A newer pick replaces one still being read; a failed read leaves only its error.
  const pickerRequest = useRef(0), submission = useRef<object | null>(null);
  const currentBuild = useRef(buildKey);
  useLayoutEffect(() => { currentBuild.current = buildKey; }, [buildKey]);
  useEffect(() => () => { latestPick.current = 0; pickerRequest.current++; }, []);
  const chooseFile = async () => {
    const request = ++pickerRequest.current;
    let file: File | undefined;
    try {
      [file] = await pickBrowserFiles({ accept: ASSEMBLY_FILE_ACCEPT });
    } catch (error) {
      if (request === pickerRequest.current && isCurrent()) job.setError("Could not choose a file. Try again.");
      return;
    }
    if (!file || request !== pickerRequest.current || !isCurrent()) return;
    const id = nextIdentity();
    latestPick.current = id;
    const format = assemblyFormatOfName(file.name);
    const settle = (text: string | null, error: string | null) => { if (latestPick.current === id && isCurrent()) setPicked({ id, name: file.name, format, text, error }); };
    if (!format) { settle(null, "Choose a PDB or mmCIF file."); return; }
    // The size is checked before anything is read.
    if (file.size > ASSEMBLY_TEXT_LIMIT) { settle(null, ASSEMBLY_TOO_LARGE); return; }
    settle(null, null);
    try {
      settle(await file.text(), null);
    } catch (error) {
      settle(null, `${file.name} could not be read. Choose the file again.`);
    }
  };

  const build = async () => {
    if (submission.current || latestPick.current !== (picked?.id ?? 0) || !isCurrent() || !buildKey || !source?.text || !source.format || !assemblyId || !modelNumber) return;
    const owner = picked ? null : documentText.capture();
    if (!picked && !owner) return;
    const token = {}; submission.current = token;
    const { text, format, name } = source;
    const key = buildKey;
    const fileName = `${fileStem(name)}-assembly-${assemblyId}${models.length > 1 ? `-model-${modelNumber}` : ""}`;
    // One job from the worker until the CIF is open, so Cancel, a changed source and a
    // closed dialog drop the document too while it is being prepared.
    await job.run("Building assembly", async (signal) => {
      const valid = () => latestPick.current === (picked?.id ?? 0) && !signal.aborted && currentBuild.current === key && isCurrent() && (!owner || owner.isCurrent());
      let result: AssemblyResults["assembly"];
      try { result = await runAssemblyTask({ action: "assembly", text, format, assemblyId, modelNumber }, { signal }); }
      catch (error) { if (isAbortError(error)) throw error; throw new Error(assemblyMessage(error)); }
      if (!valid()) return null;
      setOpeningFor(signal);
      const opening = await openGeneratedStructure(actions, fileName, "cif", result.cif, valid, { newDocument: true })
        .then(([opened]) => ({ opened, failure: null }), (error: unknown) => ({ opened: undefined, failure: "Try Build again." }));
      return valid() ? { result, ...opening } : null;
    }).then(done => {
    if (!done) return;
    const { result, opened, failure } = done;
    const unopened = failure === null ? "The assembly was built but could not be opened." : `The assembly was built but could not be opened: ${failure}`;
    setOutcome(opened ? { key, name: opened.title, result } : { key, error: unopened });
    }).catch(() => {
      if (isCurrent() && currentBuild.current === key) job.setError("Could not open the assembly. Try Build again.");
    }).finally(() => { owner?.release(); if (submission.current === token) submission.current = null; });
  };

  const reading = Boolean(source && !source.error && (source.text === null || (source.format && !current)));
  const problem = (source?.error ? (picked ? source.error : assemblyMessage(new Error(source.error))) : null) ?? current?.error ?? job.error ?? (ownOutcome && "error" in ownOutcome ? ownOutcome.error : null);
  const busy = Boolean(job.running);
  const opening = busy && openingFor !== null && !openingFor.aborted;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Build biological assembly</DialogTitle>
        <DialogDescription className="truncate" title={source?.name}>{source?.name ?? "Choose a PDB or mmCIF file"}</DialogDescription>
      </DialogHeader>
      {assemblies.length ? (
        <div className="workbench-form">
          <RadioGroup aria-label="Assembly" className="assembly-choices gap-2" value={assemblyId ?? ""} disabled={busy}
            onValueChange={(value) => setChoice({ ...own, assembly: value })}>
            {assemblies.map(({ id, details, copies }) => (
              <RadioGroupItem key={id} block value={id}>
                <span className="assembly-choice grid min-w-0 grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <span>Assembly {id}</span>
                  <span className="workbench-value">{plural(copies, "copy", "copies")}</span>
                  {details ? <span className="assembly-details col-span-2 text-sm">{details}</span> : null}
                </span>
              </RadioGroupItem>
            ))}
          </RadioGroup>
          {models.length > 1 ? (
            <label className="workbench-field">
              <span>Model</span>
              <NativeSelect size="sm" aria-label="Model" value={modelNumber ?? ""} disabled={busy} onChange={(event) => setChoice({ ...own, model: event.target.value })}>
                <NativeSelectOption value="" disabled>Choose a model</NativeSelectOption>
                {models.map((model) => <NativeSelectOption key={model} value={model}>Model {model}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          ) : null}
        </div>
      ) : null}
      {reading ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Reading assemblies</span> : null}
      {problem ? <p role="alert" className="workbench-error text-sm text-destructive">{problem}</p> : null}
      {shown ? (
        <div role="status" className="assembly-outcome grid gap-1 text-sm">
          <span className="workbench-value" data-status="success">
            Opened {shown.name}: {plural(shown.result.atomCount, "atom", "atoms")} in {plural(shown.result.chainCount, "chain", "chains")}, model {shown.result.modelNumber}
          </span>
          {shown.result.warnings.map((warning) => <span key={warning} className="workbench-value">{warning}</span>)}
        </div>
      ) : null}
      <DialogFooter>
        {busy ? (
          <>
            <span role="status" className="workbench-status mr-auto"><Spinner aria-hidden className="size-3" />{opening ? "Opening assembly" : job.running}</span>
            <Button type="button" variant="secondary" onClick={() => { submission.current = null; job.cancel(); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" className="mr-auto" onClick={() => void chooseFile()}>Choose file…</Button>
            {shown ? <Button type="button" onClick={onDone}>Done</Button>
              : <Button type="button" disabled={!buildKey} onClick={() => void build()}>Build</Button>}
          </>
        )}
      </DialogFooter>
    </>
  );
}

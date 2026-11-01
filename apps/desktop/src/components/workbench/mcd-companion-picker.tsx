import { useEffect, useRef, useState } from "react";
import { pickBrowserFiles } from "../../lib/browser-file-picker";
import { captureBrowserMcdAdmission } from "../../lib/workbench/browser-mcd-attachment";
import type { McdCompanionTarget } from "../../lib/workbench/mcd-companion-tool";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import "./workbench-layout.css";
import "./vibrations.css";

type Admission = ReturnType<typeof captureBrowserMcdAdmission>;
type Prepared = Awaited<ReturnType<Admission["prepare"]>>;
type Operation = { admission: Admission; target: McdCompanionTarget; applying?: boolean };

function failureText(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "";
  if (message.includes("original source file changed")) return "The original document changed. Reopen it before adding MCD.";
  if (caught instanceof Error && caught.name === "AbortError") return "The source changed. Choose the MCD file again.";
  if (message.includes("scientific source exceeds")) return "This document is too large to attach MCD.";
  if (message.startsWith("Save or discard source edits")) return "Save or discard source edits before adding MCD.";
  if (message.includes("16 MiB")) return "MCD files can be at most 16 MiB.";
  if (message.startsWith("Recover or discard")) return "Recover or discard the saved draft before adding MCD.";
  if (message.includes("storage is full")) return "Browser storage is full. Save your work before clearing site storage.";
  if (message.startsWith("Choose an .mcd")) return message;
  if (message.startsWith("Invalid ORCA circular spectrum")) return "The MCD file could not be read. Check the file and try again.";
  return "Could not add the MCD spectrum. Try again.";
}

/** The source is captured synchronously in the user's click, before the chooser opens. */
export function McdCompanionPicker({ target, onAttached }: {
  target: McdCompanionTarget | null; onAttached: (target: McdCompanionTarget) => void;
}) {
  const owner = useRef<Operation | null>(null);
  const [pending, setPending] = useState<{ operation: Operation; prepared: Prepared; name: string } | null>(null);
  const [block, setBlock] = useState("");
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const finish = (operation: Operation) => {
    operation.admission.release();
    if (owner.current !== operation) return;
    owner.current = null; setPending(null); setBlock(""); setBusy(null);
  };
  useEffect(() => {
    setPending(null); setBlock(""); setBusy(null); setError(null);
    return () => { if (owner.current?.target === target) { owner.current.admission.release(); owner.current = null; } };
  }, [target]);
  const failed = (operation: Operation, caught: unknown) => {
    if (owner.current !== operation) return;
    setError(failureText(caught));
  };
  const apply = async (operation: Operation, prepared: Prepared, index: number) => {
    if (owner.current !== operation || operation.applying) return;
    operation.applying = true;
    setBusy("Adding MCD…"); setError(null);
    try { await prepared.apply(index); onAttached(operation.target); }
    catch (caught) { failed(operation, caught); }
    finally { finish(operation); }
  };
  const choose = async () => {
    if (!target || owner.current) return;
    setError(null);
    let operation: Operation;
    try { operation = { admission: captureBrowserMcdAdmission(target), target }; }
    catch (caught) { setError(failureText(caught)); return; }
    owner.current = operation; setBusy("Choose an MCD file…");
    let choosingBlock = false;
    try {
      const [file] = await pickBrowserFiles({ accept: ".mcd,.mcd.gz" });
      if (owner.current !== operation || !file) return;
      if (!/\.mcd(?:\.gz)?$/iu.test(file.name)) throw new Error("Choose an .mcd or .mcd.gz file.");
      setBusy("Reading spectrum…");
      const prepared = await operation.admission.prepare(file);
      if (owner.current !== operation) return;
      if (prepared.blocks.length === 1) await apply(operation, prepared, 0);
      else { choosingBlock = true; setPending({ operation, prepared, name: file.name }); setBusy(null); }
    } catch (caught) { failed(operation, caught); }
    finally { if (!choosingBlock) finish(operation); }
  };
  if (!target) return null;
  return <div className="dock-content workbench-panel">
    {pending ? <>
      <label className="workbench-field"><span>{pending.name}</span>
        <NativeSelect size="sm" aria-label="MCD spectrum block" value={block} disabled={Boolean(busy)} onChange={event => setBlock(event.currentTarget.value)}>
          <NativeSelectOption value="" disabled>Select block</NativeSelectOption>
          {pending.prepared.blocks.map(value => <NativeSelectOption key={value.index} value={String(value.index)}>
            {`Block ${value.index + 1}: ${value.fromCm1}–${value.toCm1} cm⁻¹ (${value.rows} rows)`}
          </NativeSelectOption>)}
        </NativeSelect>
      </label>
      <div className="workbench-row"><Button size="sm" disabled={block === "" || Boolean(busy)} onClick={() => { void apply(pending.operation, pending.prepared, Number(block)); }}>Add</Button>
        <Button size="sm" variant="outline" onClick={() => finish(pending.operation)}>Cancel</Button></div>
    </> : <div className="workbench-row"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { void choose(); }}>Add MCD…</Button>
      {busy ? <Button size="sm" variant="outline" onClick={() => { if (owner.current) finish(owner.current); }}>Cancel</Button> : null}</div>}
    {busy ? <span role="status" aria-live="polite">{busy}</span> : null}
    {error ? <p role="alert" className="workbench-error">{error}</p> : null}
  </div>;
}

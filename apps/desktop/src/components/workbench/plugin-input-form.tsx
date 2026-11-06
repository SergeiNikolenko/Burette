import { useEffect, useMemo, useRef, useState } from "react";
import { readCommandOptions, type CommandOption, type CommandOptionValue } from "../../lib/extensions/avogadro-command-io";
import { generatorInput, readGeneratorOutput, type AvogadroGeneratorEntry, type GeneratedInput } from "../../lib/extensions/avogadro-input-generators";
import { avogadroPluginRunner } from "../../lib/extensions/avogadro-plugin-runner";
import { safeExportFileName } from "../../lib/file-export";
import type { MolecularAtom, MolecularBond, UnitCell } from "../../lib/molecular-workbench/types";
import { fileStem } from "../../lib/workbench/formats";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { DialogFooter } from "../ui/dialog";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { OptionField, validOption } from "./avogadro-command-host";

type Runner = ReturnType<typeof avogadroPluginRunner>;
type Molecule = { atoms: readonly MolecularAtom[]; bonds: readonly MolecularBond[]; cell?: UnitCell | null };
// Avogadro regenerates the preview as options change; a pause keeps each keystroke from starting the script.
const REGENERATE_DELAY_MS = 400;

/** One input-generator plugin in Export input file: its own options, a live preview, Copy and Save. */
export function PluginInputForm({ entry, document, molecule, actions, runner = avogadroPluginRunner() }: {
  entry: AvogadroGeneratorEntry; document: ViewerDocument; molecule: Molecule | null; actions: Pick<ShellActions, "saveKetcherExportFile">; runner?: Runner;
}) {
  const [fields, setFields] = useState<{ entry: AvogadroGeneratorEntry; options: CommandOption[] } | { entry: AvogadroGeneratorEntry; error: true } | null>(null);
  const [values, setValues] = useState<Record<string, CommandOptionValue>>({});
  const [tab, setTab] = useState("");
  const [output, setOutput] = useState<{ key: object; result?: GeneratedInput; error?: string } | null>(null);
  const [file, setFile] = useState("");
  const [copied, setCopied] = useState(false), [saving, setSaving] = useState(false), [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const path = entry.generator.userOptions;
    void (path ? runner.readOptions(entry.plugin.name, path).then(text => readCommandOptions(text, path)) : Promise.resolve([])).then(options => {
      if (!live) return;
      setFields({ entry, options });
      // Files are named after the document, as Burette's own generators name them.
      setValues(Object.fromEntries(options.map(option => [option.key, option.key === "Filename Base" && option.type === "string" ? fileStem(document.title) : option.value])));
      setTab(options.find(option => option.tab)?.tab ?? "");
    }, () => { if (live) setFields({ entry, error: true }); });
    return () => { live = false; };
  }, [entry, runner, document.title]);

  const options = fields?.entry === entry && "options" in fields ? fields.options : null;
  const ready = Boolean(options && molecule && options.every(option => validOption(option, values[option.key])));
  const key = useMemo(() => ({ entry, molecule, values }), [entry, molecule, values]);
  const latest = useRef(key); latest.current = key;
  // One script run at a time; options changed meanwhile are picked up once it ends.
  const running = useRef(false), [finished, setFinished] = useState(0);
  useEffect(() => {
    if (!ready || !molecule || output?.key === key) return;
    const timer = window.setTimeout(async () => {
      if (running.current) return;
      running.current = true;
      const request = key;
      try {
        const { job, stdout } = await runner.run(entry.plugin.name, `${entry.generator.programName} input`, {
          script: entry.script, identifier: entry.generator.identifier, operation: "command", input: generatorInput(molecule, values) });
        // A cancelled run waits for the next option change.
        if (job.status === "cancelled") { if (latest.current === request) setOutput({ key: request }); return; }
        if (job.status !== "success" || stdout === undefined) throw new Error(job.error ?? "The input file could not be generated.");
        const result = readGeneratorOutput(stdout, molecule, values);
        if (latest.current === request) { setOutput({ key: request, result }); setFile(current => result.files.some(item => item.name === current) ? current : result.mainFile); }
      } catch (error) {
        if (latest.current === request) setOutput({ key: request, error: error instanceof Error ? error.message : "The input file could not be generated." });
      } finally {
        running.current = false;
        setFinished(count => count + 1);
      }
    }, REGENERATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, ready, molecule, values, entry, runner, output, finished]);
  useEffect(() => { setCopied(false); setExportError(null); }, [output]);

  const result = output?.key === key ? output.result : undefined, pending = Boolean(ready && output?.key !== key);
  const shown = result?.files.find(item => item.name === file) ?? result?.files[0];
  const tabs = [...new Set(options?.flatMap(option => option.tab ? [option.tab] : []) ?? [])];
  const error = fields && "error" in fields ? "The options of this program could not be read." : output?.key === key ? output.error : undefined;
  return <>
    <div className="workbench-form">
      {tabs.length > 1 ? <div className="workbench-row">
        <SegmentedControl aria-label="Option group" value={tab} onValueChange={setTab}>
          {tabs.map(name => <SegmentedControlItem key={name} value={name}>{name}</SegmentedControlItem>)}
        </SegmentedControl>
      </div> : null}
      {options?.length ? <div className="workbench-grid">
        {options.filter(option => tabs.length < 2 || (option.tab ?? tabs[0]) === tab).map(option =>
          <OptionField key={option.key} option={option} value={values[option.key]} onChange={value => setValues(previous => ({ ...previous, [option.key]: value }))} />)}
      </div> : null}
      {result && result.files.length > 1 ? <div className="workbench-row">
        <SegmentedControl aria-label="Input file" value={shown?.name ?? ""} onValueChange={setFile}>
          {result.files.map(item => <SegmentedControlItem key={item.name} value={item.name}>{item.name}</SegmentedControlItem>)}
        </SegmentedControl>
      </div> : null}
      {shown ? <Textarea readOnly className="workbench-code" aria-label={`${shown.name} contents`} value={shown.text} rows={12} wrap="off" spellCheck={false} /> : null}
    </div>
    {!fields || pending && !result ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />{fields ? "Generating" : "Reading options"}</span> : null}
    {result?.warnings.map(warning => <p key={warning} className="workbench-status">{warning}</p>)}
    {error ?? exportError ? <p role="alert" className="workbench-error">{error ?? exportError}</p> : null}
    <DialogFooter>
      <Button type="button" variant="secondary" disabled={!shown} onClick={() => {
        if (!shown) return;
        setExportError(null);
        void navigator.clipboard?.writeText(shown.text).then(() => setCopied(true), () => setExportError("Could not copy. Select the input text and copy it manually."));
      }}>{copied ? "Copied" : "Copy"}</Button>
      <Button type="button" title={result ? result.files.map(item => item.name).join(", ") : undefined} disabled={!result || saving} onClick={async () => {
        if (!result) return;
        setExportError(null);
        setSaving(true);
        try {
          for (const item of result.files) {
            const name = safeExportFileName(item.name), extension = /\.([^.]+)$/u.exec(name)?.[1] ?? "inp";
            const outcome = await actions.saveKetcherExportFile({ title: name, extension, text: item.text });
            if (outcome.status === "failed") { setExportError("Could not save the input file. Try saving again."); break; }
            if (outcome.status !== "saved") break;
          }
        } catch { setExportError("Could not save the input file. Try saving again."); }
        finally { setSaving(false); }
      }}>{saving ? <><Spinner aria-hidden className="size-3" />Saving</> : result && result.files.length > 1 ? "Save all" : "Save"}</Button>
    </DialogFooter>
  </>;
}

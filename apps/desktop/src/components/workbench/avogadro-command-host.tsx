import { useEffect, useState } from "react";
import type { CommandOption, CommandOptionValue } from "../../lib/extensions/avogadro-command-io";
import { avogadroPluginRunner } from "../../lib/extensions/avogadro-plugin-runner";
import { requestAvogadroCommand, runAvogadroCommand, useAvogadroCommandRequest, type AvogadroCommandRequest } from "../../lib/extensions/avogadro-commands";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";
import "./workbench-layout.css";

type Actions = Pick<ShellActions, "openStructureRecords" | "runStructureViewerAction">;
type Runner = ReturnType<typeof avogadroPluginRunner>;

async function run(request: AvogadroCommandRequest, values: Record<string, CommandOptionValue>, actions: Actions, runner?: Runner) {
  for (const notice of await runAvogadroCommand(request, values, actions, runner)) toast.add({ ...notice, type: notice.kind });
}

export function OptionField({ option, value, onChange }: { option: CommandOption; value: CommandOptionValue; onChange: (value: CommandOptionValue) => void }) {
  if (option.type === "boolean") return <label className="workbench-field" title={option.tooltip}>
    <span>{option.label}</span>
    <Switch checked={value === true} onCheckedChange={onChange} aria-label={option.label} />
  </label>;
  if (option.type === "stringList") return <label className="workbench-field" title={option.tooltip}>
    <span>{option.label}</span>
    <NativeSelect size="sm" aria-label={option.label} value={String(value)} onChange={event => onChange(event.target.value)}>
      {option.values.map(entry => <NativeSelectOption key={entry} value={entry}>{entry || "None"}</NativeSelectOption>)}
    </NativeSelect>
  </label>;
  const numeric = option.type === "integer" || option.type === "float";
  return <label className="workbench-field" title={option.tooltip}>
    <span>{option.label}</span>
    <Input aria-label={option.label} type={numeric ? "number" : "text"} value={String(value)} maxLength={numeric ? undefined : 4096}
      step={option.type === "integer" ? 1 : option.type === "float" ? "any" : undefined}
      min={numeric ? option.minimum : undefined} max={numeric ? option.maximum : undefined}
      onChange={event => onChange(numeric ? event.target.value === "" ? Number.NaN : Number(event.target.value) : event.target.value)} />
  </label>;
}

export function validOption(option: CommandOption, value: CommandOptionValue) {
  if (option.type !== "integer" && option.type !== "float") return true;
  return typeof value === "number" && Number.isFinite(value) && (option.type === "float" || Number.isInteger(value))
    && (option.minimum === undefined || value >= option.minimum) && (option.maximum === undefined || value <= option.maximum);
}

/** Commands with declared user options ask for them first; others start right away. */
export function AvogadroCommandHost({ actions, runner }: { actions: Actions; runner?: Runner }) {
  const request = useAvogadroCommandRequest();
  const [options, setOptions] = useState<{ request: AvogadroCommandRequest; fields: CommandOption[] } | { request: AvogadroCommandRequest; error: true } | null>(null);
  const [values, setValues] = useState<Record<string, CommandOptionValue>>({});
  useEffect(() => {
    if (!request) { setOptions(null); return; }
    const path = request.entry.command.userOptions;
    if (!path) {
      requestAvogadroCommand(null);
      void run(request, {}, actions, runner);
      return;
    }
    let live = true;
    (runner ?? avogadroPluginRunner()).readOptions(request.entry.plugin.name, path)
      .then(async text => (await import("../../lib/extensions/avogadro-command-io")).readCommandOptions(text, path))
      .then(fields => { if (live) { setOptions({ request, fields }); setValues(Object.fromEntries(fields.map(field => [field.key, field.value]))); } },
        () => { if (live) setOptions({ request, error: true }); });
    return () => { live = false; };
  }, [request, actions, runner]);
  const shown = options && options.request === request ? options : null;
  const title = request?.entry.path.join(" › ") ?? "";
  const fields = shown && "fields" in shown ? shown.fields : [];
  const ready = shown && "fields" in shown && fields.every(field => validOption(field, values[field.key]));
  return <Dialog open={Boolean(shown)} onOpenChange={open => { if (!open) requestAvogadroCommand(null); }}>
    {shown ? <DialogContent variant="form">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="truncate">{shown.request.document.title}</DialogDescription>
      </DialogHeader>
      {"error" in shown ? <p role="alert" className="text-sm">The options of this command could not be read.</p>
        : <form id="avogadro-command-options" className="workbench-form" onSubmit={event => {
          event.preventDefault();
          if (!ready) return;
          requestAvogadroCommand(null);
          void run(shown.request, values, actions, runner);
        }}>
          {fields.map(field => <OptionField key={field.key} option={field} value={values[field.key]} onChange={value => setValues(previous => ({ ...previous, [field.key]: value }))} />)}
        </form>}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => requestAvogadroCommand(null)}>Cancel</Button>
        {"fields" in shown && <Button type="submit" form="avogadro-command-options" disabled={!ready}>Run</Button>}
      </DialogFooter>
    </DialogContent> : null}
  </Dialog>;
}

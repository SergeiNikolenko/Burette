import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { usePolymerBuilder, POLYMER_ROLES, type PolymerRole } from "../../hooks/use-polymer-builder";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settings-store";
import { atomLabel } from "../../lib/workbench/formats";
import { MoleculeFilePreview } from "../molecule-file-preview";
import { POLYMER_END_GROUPS, POLYMER_RELAXATION_ATOMS, type PolymerEndGroup } from "../../lib/workbench/polymer-task";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";

const END_LABELS: Record<PolymerEndGroup, string> = { hydrogen: "Hydrogen", methyl: "Methyl", hydroxyl: "Hydroxyl", phenyl: "Phenyl", "tert-butyl": "tert-Butyl" };

export function PolymerBuilderBody({ document, actions, isCurrent, onDone }: { document: ViewerDocument | null; actions: Pick<ShellActions, "openStructureRecords">; isCurrent: () => boolean; onDone: () => void }) {
  const form = usePolymerBuilder(document, actions, isCurrent, onDone), preferences = useSettingsStore(state => state.preferences);
  const theme = resolveThemeMode(preferences.theme, useSystemThemeMode());
  return <>
    <DialogHeader><DialogTitle>Build polymer</DialogTitle></DialogHeader>
    {document ? <div className="workbench-row"><span>Source</span><span className="min-w-0 truncate" title={document.title}>{document.title}</span></div> : null}
    <fieldset disabled={Boolean(form.busy) || !form.ready} className="workbench-form min-w-0 border-0 p-0">
      <div className="grid grid-cols-2 gap-2">{(Object.entries(POLYMER_ROLES) as [PolymerRole, string][]).map(([role, label]) => {
        const index = form.roles[role], value = index !== undefined && form.ready ? atomLabel(form.ready.graph.atoms, index) : null;
        return <Button key={role} variant="outline" size="sm" aria-pressed={form.armed === role} aria-label={`Pick ${label}${value ? ` (${value})` : ""}`}
          title="Pick this atom in the source view" onClick={() => void form.pick(role)}>{label}{value ? `: ${value}` : ""}{form.armed === role ? <Spinner aria-label="Picking atom" /> : null}</Button>;
      })}</div>
      <label className="workbench-field"><span>Repeats</span><ScrubNumberField aria-label="Repeat count" name="repeat-count" autoComplete="off" value={form.count} min={1} max={500} step={1} onValueChange={form.setCount} onValueCommitted={form.setCount} /></label>
      <label className="workbench-field"><span>Link length, Å</span><ScrubNumberField aria-label="Link length, angstrom" name="link-length" autoComplete="off" value={form.bondLength} min={.5} max={3} step={.01} onValueChange={form.setBondLength} onValueCommitted={form.setBondLength} /></label>
      <label className="workbench-field"><span>Tacticity</span><NativeSelect aria-label="Tacticity" name="tacticity" autoComplete="off" size="sm" value={form.tacticity} onChange={event => form.setTacticity(event.target.value as typeof form.tacticity)}>
        <NativeSelectOption value="picked">From picked H</NativeSelectOption><NativeSelectOption value="atactic">Atactic</NativeSelectOption><NativeSelectOption value="isotactic">Isotactic</NativeSelectOption><NativeSelectOption value="syndiotactic">Syndiotactic</NativeSelectOption>
      </NativeSelect></label>
      <div className="grid grid-cols-2 gap-2">{([["Head end", form.headEnd, form.setHeadEnd], ["Tail end", form.tailEnd, form.setTailEnd]] as const).map(([label, value, set]) =>
        <label key={label} className="workbench-field"><span>{label}</span><NativeSelect aria-label={label} autoComplete="off" size="sm" value={value} onChange={event => set(event.target.value as PolymerEndGroup)}>
          {(Object.keys(POLYMER_END_GROUPS) as PolymerEndGroup[]).map(group => <NativeSelectOption key={group} value={group}>{END_LABELS[group]}</NativeSelectOption>)}
        </NativeSelect></label>)}</div>
      <label className="flex cursor-pointer items-center gap-2 text-sm" title={`Up to ${POLYMER_RELAXATION_ATOMS} atoms`}>
        <Checkbox aria-label="Relax geometry" checked={form.relax} onCheckedChange={checked => form.setRelax(checked === true)} /><span>Relax geometry</span>
      </label>
    </fieldset>
    {form.preview ? <MoleculeFilePreview data={form.preview.sdf} format="sdf" label="Polymer" height={210} theme={theme} hydrogenDisplay={preferences.hydrogenDisplay} onOpen={() => void form.build(true)} /> : null}
    {form.preview ? <span role="status" aria-live="polite" className="workbench-status">{form.preview.atomCount.toLocaleString("en-US")} atoms
      {form.preview.relaxation ? <span className="workbench-value" data-status={form.preview.relaxation.converged ? "success" : "failure"}>{form.preview.relaxation.converged ? "Relaxed" : "Not converged"}</span> : null}</span> : null}
    {form.unavailable || form.error ? <p role="alert" className="text-sm text-destructive">{form.unavailable ?? form.error}</p> : null}
    {!form.ready && !form.unavailable && !form.error ? <Spinner aria-label="Reading repeat unit" /> : null}
    {!form.ready && !form.unavailable && form.error ? <Button variant="outline" size="sm" onClick={form.retry}>Retry</Button> : null}
    <DialogFooter>
      <Button variant="outline" onClick={onDone}>Cancel</Button>
      <Button variant="outline" disabled={!form.complete || Boolean(form.busy) || Boolean(form.armed)} onClick={() => void form.build(false)}>Preview</Button>
      <Button disabled={!form.complete || Boolean(form.busy) || Boolean(form.armed)} onClick={() => void form.build(true)}>{form.busy ? <Spinner aria-label={form.busy} /> : null}Create</Button>
    </DialogFooter>
  </>;
}

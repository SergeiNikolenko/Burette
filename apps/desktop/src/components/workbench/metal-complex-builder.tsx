import { useMemo, useRef, useState } from "react";
import { COORDINATION_GEOMETRIES, defaultDonorDistance, fittingSiteSets, ligandSiteCount, METAL_COVALENT_RADII, METAL_DONOR_DISTANCE_LIMITS, METAL_LIGANDS, OXIDATION_STATE_LIMITS,
  type CoordinationGeometry, type MetalLigandId } from "../../lib/molecular-workbench/metal-complex";
import { runMetalComplexTask, type MetalComplexBuildRequest, type MetalComplexBuildResult } from "../../lib/workbench/metal-complex-task";
import { openGeneratedStructure } from "../../lib/workbench/generated-document-open";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { InsertBuiltStructureButton } from "./insert-built-structure";
import GridMolecule3D from "../grid-molecule-3d";
import { Button } from "../ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";

/** One row per coordination site; a ligand on several sites stores itself and the whole site set on each of them. */
type SiteChoice = { ligand: MetalLigandId; group?: number[]; distance?: number };
const FILL: MetalLigandId = "aqua";
const LIGAND_IDS = Object.keys(METAL_LIGANDS) as MetalLigandId[];
const LIGAND_GROUPS: [string, (ligand: MetalLigandId) => boolean][] = [
  ["Monodentate", ligand => !METAL_LIGANDS[ligand].centroid && ligandSiteCount(ligand) === 1],
  ["Haptic", ligand => Boolean(METAL_LIGANDS[ligand].centroid)],
  ["Bidentate", ligand => ligandSiteCount(ligand) === 2], ["Tridentate", ligand => ligandSiteCount(ligand) === 3],
  ["Tetradentate", ligand => ligandSiteCount(ligand) === 4], ["Hexadentate", ligand => ligandSiteCount(ligand) === 6],
];
const setsAt = (ligand: MetalLigandId, geometry: CoordinationGeometry, site: number) => fittingSiteSets(ligand, geometry).filter(set => set.includes(site));
const siteLabel = (geometry: CoordinationGeometry, site: number) => {
  const position = COORDINATION_GEOMETRIES[geometry].sites[site][0];
  return `${position ? `${position[0].toUpperCase()}${position.slice(1)}` : "Site"} ${site + 1}`;
};
const formatCharge = (charge: number) => charge > 0 ? `+${charge}` : charge < 0 ? `−${-charge}` : "0";

function release(sites: SiteChoice[], site: number) {
  for (const other of sites[site].group ?? []) sites[other] = { ligand: FILL };
}

export function MetalComplexBuilderBody({ actions, document, isCurrent, onDone }: {
  actions: Pick<ShellActions, "openStructureRecords">;
  /** The active document: an editable MOL/SDF also offers Insert into it. */
  document: ViewerDocument | null; isCurrent: () => boolean; onDone: () => void;
}) {
  const [metal, setMetal] = useState("Pt");
  const [oxidationState, setOxidationState] = useState(2);
  const [geometry, setGeometry] = useState<CoordinationGeometry>("square-planar");
  const [sites, setSites] = useState<SiteChoice[]>([{ ligand: "chlorido" }, { ligand: "chlorido" }, { ligand: "ammine" }, { ligand: "ammine" }]);
  const request = useMemo<MetalComplexBuildRequest>(() => ({ metal, oxidationState, geometry, format: "sdf",
    ligands: sites.flatMap((choice, site) => !choice.group ? [{ ligand: choice.ligand, sites: [site], distance: choice.distance }]
      : choice.group[0] === site ? [{ ligand: choice.ligand, sites: choice.group, distance: choice.distance }] : []) }), [metal, oxidationState, geometry, sites]);
  const charge = request.ligands.reduce((sum, item) => sum + METAL_LIGANDS[item.ligand].atoms.reduce((total, atom) => total + atom[4], 0), oxidationState);
  const latest = useRef(request); latest.current = request;
  const submission = useRef<object | null>(null);
  const [preview, setPreview] = useState<{ request: MetalComplexBuildRequest; result: MetalComplexBuildResult } | null>(null);
  const currentPreview = preview?.request === request ? preview.result : null;
  const job = useCancellableJob();
  const preferences = useSettingsStore(state => state.preferences);
  const theme = resolveThemeMode(preferences.theme, useSystemThemeMode());

  const changeGeometry = (next: CoordinationGeometry) => {
    const count = COORDINATION_GEOMETRIES[next].sites.length;
    setGeometry(next);
    // Single-site choices keep their site number; ligands on several sites are re-placed by the user.
    setSites(Array.from({ length: count }, (_, site) => sites[site] && !sites[site].group ? sites[site] : { ligand: FILL }));
  };
  const place = (next: SiteChoice[], ligand: MetalLigandId, group: number[], distance?: number) => {
    for (const other of group) release(next, other);
    for (const other of group) next[other] = { ligand, group, distance };
  };
  const changeLigand = (site: number, ligand: MetalLigandId) => {
    const next = [...sites]; release(next, site);
    if (ligandSiteCount(ligand) === 1) { next[site] = { ligand }; setSites(next); return; }
    // The fitting site set that disturbs the fewest ligands already spanning several sites.
    const disturbed = (set: number[]) => set.filter(other => other !== site && next[other].group).length;
    const [group] = [...setsAt(ligand, geometry, site)].sort((a, b) => disturbed(a) - disturbed(b));
    if (!group) return;
    place(next, ligand, group);
    setSites(next);
  };
  const changeGroup = (site: number, group: number[]) => {
    const next = [...sites], { ligand, distance } = next[site];
    release(next, site); place(next, ligand, group, distance);
    setSites(next);
  };
  const changeDistance = (site: number, distance: number) => {
    const next = [...sites];
    for (const other of next[site].group ?? [site]) next[other] = { ...next[other], distance };
    setSites(next);
  };
  // Ligands that cannot fill any site set through a site are disabled in that site's list.
  const reachable = useMemo(() => COORDINATION_GEOMETRIES[geometry].sites.map((_, site) => new Set(LIGAND_IDS.filter(ligand => setsAt(ligand, geometry, site).length))), [geometry]);

  const build = async (create: boolean) => {
    if (submission.current || !isCurrent()) return;
    const own = {}; submission.current = own;
    try {
      await job.run(create ? "Creating complex…" : "Building preview…", async signal => {
        const valid = () => !signal.aborted && latest.current === request && isCurrent();
        const result = currentPreview ?? await runMetalComplexTask(request, { signal });
        if (!valid()) return;
        setPreview({ request, result });
        if (!create) return;
        const opened = await openGeneratedStructure(actions, result.name, "sdf", result.text, valid, { newDocument: true });
        if (!valid()) return;
        if (!opened.length) throw new Error("Could not open the complex. Try Create again.");
        onDone();
      });
    } finally { if (submission.current === own) submission.current = null; }
  };
  const cancel = () => { submission.current = null; job.cancel(); };
  // Insert reuses the preview of the current request, or builds it and shows it.
  // Coordination edges insert as dative bonds, as the SDF writes them.
  const built = async () => {
    const result = currentPreview ?? await runMetalComplexTask(request);
    if (latest.current === request) setPreview({ request, result });
    const { atoms, bonds, coordination } = result.graph;
    return { atoms, bonds: [...bonds, ...coordination.map(({ a, b }) => ({ a, b, order: 9 as const }))] };
  };
  return <>
    <DialogHeader><DialogTitle>Build metal complex</DialogTitle></DialogHeader>
    <fieldset disabled={Boolean(job.running)} className="workbench-form min-w-0 border-0 p-0">
      <div className="workbench-grid">
        <label className="workbench-field"><span>Metal</span>
          <NativeSelect aria-label="Metal" name="metal" size="sm" value={metal} onChange={event => { setMetal(event.target.value); setSites(sites.map(choice => ({ ...choice, distance: undefined }))); }}>
            {Object.keys(METAL_COVALENT_RADII).map(symbol => <NativeSelectOption key={symbol} value={symbol}>{symbol}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="workbench-field"><span>Oxidation state</span>
          <ScrubNumberField aria-label="Oxidation state" name="oxidation-state" autoComplete="off" value={oxidationState} min={OXIDATION_STATE_LIMITS.min} max={OXIDATION_STATE_LIMITS.max} step={1}
            onValueChange={setOxidationState} onValueCommitted={setOxidationState} />
        </label>
        <label className="workbench-field"><span>Geometry</span>
          <NativeSelect aria-label="Geometry" name="geometry" size="sm" value={geometry} onChange={event => changeGeometry(event.target.value as CoordinationGeometry)}>
            {Object.entries(COORDINATION_GEOMETRIES).map(([value, { label, sites: list }]) => <NativeSelectOption key={value} value={value}>{`${label} (${list.length})`}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>
      <div role="group" aria-label="Coordination sites" className="workbench-form">
        {sites.map((choice, site) => {
          const label = siteLabel(geometry, site), count = ligandSiteCount(choice.ligand), haptic = Boolean(METAL_LIGANDS[choice.ligand].centroid);
          const sets = choice.group ? setsAt(choice.ligand, geometry, site) : [];
          return <div key={site} className="workbench-row">
            <span className="w-24 shrink-0 self-center">{label}</span>
            <NativeSelect aria-label={`${label} ligand`} name={`site-${site + 1}-ligand`} size="sm" className="min-w-0 flex-1" value={choice.ligand}
              onChange={event => changeLigand(site, event.target.value as MetalLigandId)}>
              {LIGAND_GROUPS.map(([name, member]) => <NativeSelectOptGroup key={name} label={name}>
                {LIGAND_IDS.filter(member).map(id => <NativeSelectOption key={id} value={id} disabled={!reachable[site].has(id)}>{METAL_LIGANDS[id].label}</NativeSelectOption>)}
              </NativeSelectOptGroup>)}
            </NativeSelect>
            {choice.group && sets.length > 1 ? <NativeSelect aria-label={`${label} other sites`} name={`site-${site + 1}-sites`} size="sm" className="w-32" value={choice.group.join(",")}
              onChange={event => changeGroup(site, event.target.value.split(",").map(Number))}>
              {sets.map(set => <NativeSelectOption key={set.join(",")} value={set.join(",")}>{`With ${set.filter(other => other !== site).map(other => other + 1).join(", ")}`}</NativeSelectOption>)}
            </NativeSelect> : null}
            {count < 3 ? <ScrubNumberField aria-label={`${label} metal–${haptic ? "centroid" : "donor"} distance, angstrom`} name={`site-${site + 1}-distance`} autoComplete="off" className="w-24"
              value={choice.distance ?? defaultDonorDistance(metal, choice.ligand)} min={METAL_DONOR_DISTANCE_LIMITS.min} max={METAL_DONOR_DISTANCE_LIMITS.max} step={.01}
              onValueChange={value => changeDistance(site, value)} onValueCommitted={value => changeDistance(site, value)} /> : null}
          </div>;
        })}
      </div>
      <div className="workbench-row"><span>Charge</span><span className="workbench-value" aria-label="Total charge">{formatCharge(charge)}</span></div>
    </fieldset>
    {currentPreview ? <GridMolecule3D molblock={currentPreview.text} format="sdf" label="Metal complex" height={240} theme={theme} hydrogenDisplay={preferences.hydrogenDisplay} onOpen={() => {}} /> : null}
    {job.error ? <p role="alert" className="text-sm text-destructive">{job.error}</p> : null}
    <DialogFooter>
      {job.running ? <span className="workbench-status" role="status" aria-live="polite"><Spinner aria-label={job.running} />{job.running}</span> : null}
      <Button type="button" variant="outline" onClick={() => { if (job.running) cancel(); else onDone(); }}>Cancel</Button>
      <Button type="button" variant="outline" disabled={Boolean(job.running)} onClick={() => { void build(false); }}>Preview</Button>
      <InsertBuiltStructureButton document={document} name={currentPreview?.name ?? "Metal complex"} disabled={Boolean(job.running)} build={built} />
      <Button type="button" disabled={Boolean(job.running)} onClick={() => { void build(true); }}>Create</Button>
    </DialogFooter>
  </>;
}

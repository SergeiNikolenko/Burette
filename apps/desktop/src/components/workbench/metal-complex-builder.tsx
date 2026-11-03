import { useMemo, useRef, useState } from "react";
import { COORDINATION_GEOMETRIES, defaultDonorDistance, METAL_COVALENT_RADII, METAL_DONOR_DISTANCE_LIMITS, METAL_LIGANDS, OXIDATION_STATE_LIMITS,
  type CoordinationGeometry, type MetalLigandId } from "../../lib/molecular-workbench/metal-complex";
import { runMetalComplexTask, type MetalComplexBuildRequest, type MetalComplexBuildResult } from "../../lib/workbench/metal-complex-task";
import { openGeneratedStructure } from "../../lib/workbench/generated-document-open";
import { resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import GridMolecule3D from "../grid-molecule-3d";
import { Button } from "../ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";

/** One row per coordination site; a chelate stores its ligand and partner on both of its sites. */
type SiteChoice = { ligand: MetalLigandId; partner?: number; distance?: number };
const FILL: MetalLigandId = "aqua";
const LIGAND_IDS = Object.keys(METAL_LIGANDS) as MetalLigandId[];
const chelating = (ligand: MetalLigandId) => METAL_LIGANDS[ligand].donors.length === 2;
const cisSites = (geometry: CoordinationGeometry, site: number) => {
  const sites = COORDINATION_GEOMETRIES[geometry].sites, [x, y, z] = sites[site][1];
  return sites.flatMap((other, index) => index !== site && x * other[1][0] + y * other[1][1] + z * other[1][2] > Math.cos(135 * Math.PI / 180) ? [index] : []);
};
const siteLabel = (geometry: CoordinationGeometry, site: number) => {
  const position = COORDINATION_GEOMETRIES[geometry].sites[site][0];
  return `${position ? `${position[0].toUpperCase()}${position.slice(1)}` : "Site"} ${site + 1}`;
};
const formatCharge = (charge: number) => charge > 0 ? `+${charge}` : charge < 0 ? `−${-charge}` : "0";

function release(sites: SiteChoice[], site: number) {
  const partner = sites[site].partner;
  if (partner !== undefined) sites[partner] = { ligand: FILL };
}

export function MetalComplexBuilderBody({ actions, isCurrent, onDone }: {
  actions: Pick<ShellActions, "openStructureRecords">; isCurrent: () => boolean; onDone: () => void;
}) {
  const [metal, setMetal] = useState("Pt");
  const [oxidationState, setOxidationState] = useState(2);
  const [geometry, setGeometry] = useState<CoordinationGeometry>("square-planar");
  const [sites, setSites] = useState<SiteChoice[]>([{ ligand: "chlorido" }, { ligand: "chlorido" }, { ligand: "ammine" }, { ligand: "ammine" }]);
  const request = useMemo<MetalComplexBuildRequest>(() => ({ metal, oxidationState, geometry, format: "sdf",
    ligands: sites.flatMap((choice, site) => choice.partner === undefined ? [{ ligand: choice.ligand, sites: [site], distance: choice.distance }]
      : choice.partner > site ? [{ ligand: choice.ligand, sites: [site, choice.partner], distance: choice.distance }] : []) }), [metal, oxidationState, geometry, sites]);
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
    // Monodentate choices keep their site number; chelates are re-placed by the user.
    setSites(Array.from({ length: count }, (_, site) => sites[site] && sites[site].partner === undefined ? sites[site] : { ligand: FILL }));
  };
  const changeLigand = (site: number, ligand: MetalLigandId) => {
    const next = [...sites]; release(next, site);
    if (!chelating(ligand)) { next[site] = { ligand }; setSites(next); return; }
    const candidates = cisSites(geometry, site), partner = candidates.find(other => next[other].partner === undefined) ?? candidates[0];
    release(next, partner);
    next[site] = { ligand, partner }; next[partner] = { ligand, partner: site };
    setSites(next);
  };
  const changePartner = (site: number, partner: number) => {
    const next = [...sites], { ligand, distance } = next[site];
    release(next, site); release(next, partner);
    next[site] = { ligand, partner, distance }; next[partner] = { ligand, partner: site, distance };
    setSites(next);
  };
  const changeDistance = (site: number, distance: number) => {
    const next = [...sites], partner = next[site].partner;
    next[site] = { ...next[site], distance };
    if (partner !== undefined) next[partner] = { ...next[partner], distance };
    setSites(next);
  };

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
          const label = siteLabel(geometry, site), cis = cisSites(geometry, site);
          return <div key={site} className="workbench-row">
            <span className="w-24 shrink-0 self-center">{label}</span>
            <NativeSelect aria-label={`${label} ligand`} name={`site-${site + 1}-ligand`} size="sm" className="min-w-0 flex-1" value={choice.ligand}
              onChange={event => changeLigand(site, event.target.value as MetalLigandId)}>
              <NativeSelectOptGroup label="Monodentate">{LIGAND_IDS.filter(id => !chelating(id)).map(id => <NativeSelectOption key={id} value={id}>{METAL_LIGANDS[id].label}</NativeSelectOption>)}</NativeSelectOptGroup>
              <NativeSelectOptGroup label="Bidentate" disabled={!cis.length}>{LIGAND_IDS.filter(chelating).map(id => <NativeSelectOption key={id} value={id}>{METAL_LIGANDS[id].label}</NativeSelectOption>)}</NativeSelectOptGroup>
            </NativeSelect>
            {choice.partner !== undefined ? <NativeSelect aria-label={`${label} chelate partner`} name={`site-${site + 1}-partner`} size="sm" className="w-28" value={String(choice.partner)}
              onChange={event => changePartner(site, Number(event.target.value))}>
              {cis.map(other => <NativeSelectOption key={other} value={String(other)}>{`With ${other + 1}`}</NativeSelectOption>)}
            </NativeSelect> : null}
            <ScrubNumberField aria-label={`${label} metal–donor distance, angstrom`} name={`site-${site + 1}-distance`} autoComplete="off" className="w-24"
              value={choice.distance ?? defaultDonorDistance(metal, choice.ligand)} min={METAL_DONOR_DISTANCE_LIMITS.min} max={METAL_DONOR_DISTANCE_LIMITS.max} step={.01}
              onValueChange={value => changeDistance(site, value)} onValueCommitted={value => changeDistance(site, value)} />
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
      <Button type="button" disabled={Boolean(job.running)} onClick={() => { void build(true); }}>Create</Button>
    </DialogFooter>
  </>;
}

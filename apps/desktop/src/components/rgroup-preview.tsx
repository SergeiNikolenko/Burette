import { useEffect, useMemo, useState } from "react";
import { loadDerivedEngines, type RGroupDecomposition } from "../lib/derived-columns";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Button } from "./ui/button";
import { DARK_STRUCTURE_PALETTE } from "../lib/structure-palette";
import { depictionLongAxisAngle } from "../lib/depiction-axis";

type Rdkit = Awaited<ReturnType<typeof loadDerivedEngines>>["rdkit"];
type RdkitMol = NonNullable<ReturnType<Rdkit["get_mol"]>>;
type MolJson = { atoms: { z?: number }[]; bonds: { atoms: [number, number] }[] };
const molJson = (mol: RdkitMol): MolJson => JSON.parse(mol.get_json()).molecules[0];
const dummyAtoms = (json: MolJson) => json.atoms.flatMap((atom, index) => (atom.z === 0 ? [index] : []));

// RDKit keeps the SMILES atom order, so the n-th dummy atom is the n-th `[*:N]` in the text.
function attachmentLabels(smiles: string, json: MolJson) {
  const numbers = [...smiles.matchAll(/\[\*:(\d+)\]/g)].map((match) => match[1]);
  const dummies = dummyAtoms(json);
  return numbers.length === dummies.length ? Object.fromEntries(dummies.map((atom, index) => [atom, `R${numbers[index]}`])) : null;
}

// The atoms outside `constant`, plus the one its attachment point lands on.
function changedPart(rdkit: Rdkit, mol: RdkitMol, json: MolJson, constant: string) {
  const query = rdkit.get_qmol(constant);
  const reference = rdkit.get_mol(constant);
  try {
    if (!query || !reference) return null;
    const matched: number[] = JSON.parse(mol.get_substruct_match(query)).atoms ?? [];
    if (!matched.length) return null;
    const kept = new Set(matched);
    for (const dummy of dummyAtoms(molJson(reference))) kept.delete(matched[dummy]);
    const atoms = json.atoms.flatMap((_, index) => (kept.has(index) ? [] : [index]));
    const changed = new Set(atoms);
    const bonds = json.bonds.flatMap((bond, index) => (changed.has(bond.atoms[0]) && changed.has(bond.atoms[1]) ? [index] : []));
    return { atoms, bonds };
  } finally { query?.delete(); reference?.delete(); }
}

/** A 2D drawing of a SMILES or molblock in the current theme's ink; `label` names it when the source text is not readable.
 * `attachments` writes `[*:N]` points as RN; `constant` marks the atoms that differ from that fragment. */
export function Structure({ smiles, label = smiles, width = 260, height = 150, attachments = false, constant }: {
  smiles: string; label?: string; width?: number; height?: number; attachments?: boolean; constant?: string;
}) {
  const [image, setImage] = useState("");
  useEffect(() => {
    setImage("");
    let active = true;
    let version = 0;
    const draw = async () => {
      const current = ++version;
      try {
        const { rdkit } = await loadDerivedEngines();
        const mol = rdkit.get_mol(smiles);
        if (!mol) return;
        try {
          mol.set_new_coords();
          const dark = document.querySelector(".app-shell")?.getAttribute("data-effective-theme") === "dark";
          const ink = dark ? [0.87, 0.87, 0.87] : [0.12, 0.12, 0.12];
          const json = attachments || constant ? molJson(mol) : null;
          const labels = attachments && json ? attachmentLabels(smiles, json) : null;
          const changed = constant && json ? changedPart(rdkit, mol, json, constant) : null;
          // Every place this is drawn in is wider than tall: lay the molecule's long axis across it.
          // One bond length for every drawing keeps a lone substituent at the scale of the core
          // beside it instead of stretched across its cell; larger molecules still shrink to fit.
          const svg = mol.get_svg_with_highlights(JSON.stringify({ width, height, rotate: depictionLongAxisAngle(mol.get_molblock()),
            backgroundColour: [0, 0, 0, 0], atomColourPalette: { 0: ink, 1: ink, 6: ink, ...(dark ? DARK_STRUCTURE_PALETTE : {}) }, padding: 0.08,
            fixedBondLength: 18, minFontSize: 11, maxFontSize: 13, bondLineWidth: 1.2, dummiesAreAttachments: !labels,
            ...(labels ? { atomLabels: labels } : {}), ...(changed ? { atoms: changed.atoms, bonds: changed.bonds } : {}) }));
          if (active && version === current) setImage(svg);
        } finally { mol.delete(); }
      } catch { if (active && version === current) setImage(""); }
    };
    void draw();
    const observer = new MutationObserver(() => { void draw(); });
    observer.observe(document.querySelector(".app-shell") ?? document.documentElement, { attributes: true, attributeFilter: ["data-effective-theme"] });
    return () => { active = false; observer.disconnect(); };
  }, [smiles, width, height, attachments, constant]);
  return <div className="rgroup-structure" role="img" aria-label={label} title={label} dangerouslySetInnerHTML={{ __html: image }} />;
}

export function RGroupPreviewResults({ result, total }: { result: RGroupDecomposition; total: number }) {
  const [seriesId, setSeriesId] = useState(result.series[0]?.id ?? "");
  const [position, setPosition] = useState("");
  const [page, setPage] = useState(0);
  const series = result.series.find((item) => item.id === seriesId) ?? result.series[0];
  const label = series?.labels.includes(position) ? position : series?.labels[0];
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    if (series && label) for (const row of result.rows) {
      if (row.values.Series !== series.id) continue;
      const value = row.values[label];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [result, series, label]);
  const excluded = result.excludedRows.length;
  return <section className="rgroup-results" aria-label="Decomposition preview">
    <p className="rgroup-coverage"><strong>{result.rows.length.toLocaleString()} / {total.toLocaleString()} matched</strong>
      <span>{total > 0 ? `${Math.round(100 * result.rows.length / total)}% coverage` : ""}</span></p>
    {excluded > 0 && <p role="status">{excluded} excluded: {[
      result.unparsedRows && `${result.unparsedRows} invalid ${result.unparsedRows === 1 ? "structure" : "structures"}`,
      result.noScaffoldRows && `${result.noScaffoldRows} without rings`,
      result.unmatchedRows && `${result.unmatchedRows} without this core`,
    ].filter(Boolean).join("; ")}.</p>}
    {series && <>
      <label className="mb-3 flex flex-col gap-2 text-xs">Series
        <NativeSelect name="series" value={series.id} onChange={(event) => { setSeriesId(event.target.value); setPosition(""); setPage(0); }}>
          {result.series.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.id} · {item.matchedRows} molecules · {item.labels.length} variable {item.labels.length === 1 ? "position" : "positions"}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <div className="rgroup-core"><Structure smiles={series.core} width={360} height={180} />
        {series.coreVariantCount > 1 && <span>{series.coreVariantCount} core variants</span>}
        {!series.labels.length && <span>No variable substituents</span>}
      </div>
      {label && <>
        <label className="mb-3 flex flex-col gap-2 text-xs">Position
          <NativeSelect name="position" value={label} onChange={(event) => { setPosition(event.target.value); setPage(0); }}>
            {series.labels.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <div className="rgroup-substituents">{groups.slice(page * 6, page * 6 + 6).map(([smiles, count]) =>
          <figure key={smiles}><Structure smiles={smiles} width={200} height={110} /><figcaption>{count} {count === 1 ? "molecule" : "molecules"} · {Math.round(100 * count / series.matchedRows)}%</figcaption></figure>)}</div>
        {groups.length > 6 && <div className="rgroup-pagination">
          <Button type="button" variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs tabular-nums" role="status">{page * 6 + 1}–{Math.min(page * 6 + 6, groups.length)} of {groups.length}</span>
          <Button type="button" variant="secondary" size="sm" disabled={(page + 1) * 6 >= groups.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>}
      </>}
    </>}
  </section>;
}

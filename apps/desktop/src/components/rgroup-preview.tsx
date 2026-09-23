import { useEffect, useMemo, useState } from "react";
import { loadDerivedEngines, type RGroupDecomposition } from "../lib/derived-columns";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

function Structure({ smiles }: { smiles: string }) {
  const [image, setImage] = useState("");
  useEffect(() => {
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
          const svg = mol.get_svg_with_highlights(JSON.stringify({ width: 260, height: 150,
            backgroundColour: [0, 0, 0, 0], atomColourPalette: { 0: ink, 1: ink, 6: ink }, padding: 0.1 }));
          if (active && version === current) setImage(svg);
        } finally { mol.delete(); }
      } catch { if (active) setImage(""); }
    };
    void draw();
    const observer = new MutationObserver(() => { void draw(); });
    observer.observe(document.querySelector(".app-shell") ?? document.documentElement, { attributes: true, attributeFilter: ["data-effective-theme"] });
    return () => { active = false; observer.disconnect(); };
  }, [smiles]);
  return <div className="rgroup-structure" role="img" aria-label={smiles} title={smiles} dangerouslySetInnerHTML={{ __html: image }} />;
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
      <span>{Math.round(100 * result.rows.length / total)}% coverage · {result.series.length} series</span></p>
    {excluded > 0 && <p role="status">{excluded} excluded: {[
      result.unparsedRows && `${result.unparsedRows} invalid ${result.unparsedRows === 1 ? "structure" : "structures"}`,
      result.noScaffoldRows && `${result.noScaffoldRows} without rings`,
      result.unmatchedRows && `${result.unmatchedRows} without this core`,
    ].filter(Boolean).join("; ")}.</p>}
    {series && <>
      <label className="calculated-column-field">Series
        <NativeSelect value={series.id} onChange={(event) => { setSeriesId(event.target.value); setPosition(""); setPage(0); }}>
          {result.series.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.id} · {item.matchedRows} molecules · {item.labels.length} variable {item.labels.length === 1 ? "position" : "positions"}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <div className="rgroup-core"><Structure smiles={series.core} />
        {series.coreVariantCount > 1 && <span>{series.coreVariantCount} core variants</span>}
        {!series.labels.length && <span>No variable substituents</span>}
      </div>
      {label && <>
        <label className="calculated-column-field">Position
          <NativeSelect value={label} onChange={(event) => { setPosition(event.target.value); setPage(0); }}>
            {series.labels.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <div className="rgroup-substituents">{groups.slice(page * 6, page * 6 + 6).map(([smiles, count]) =>
          <figure key={smiles}><Structure smiles={smiles} /><figcaption>{count} {count === 1 ? "molecule" : "molecules"} · {Math.round(100 * count / series.matchedRows)}%</figcaption></figure>)}</div>
        {groups.length > 6 && <div className="rgroup-pagination">
          <button className="dock-action" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page * 6 + 1}–{Math.min(page * 6 + 6, groups.length)} of {groups.length}</span>
          <button className="dock-action" disabled={(page + 1) * 6 >= groups.length} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </>}
    </>}
  </section>;
}

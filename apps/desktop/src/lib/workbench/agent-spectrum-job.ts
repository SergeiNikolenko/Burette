import type { WorkbenchJobParams } from "../../../../../scripts/workbench-agent-contract.mjs";
import { scientificSpectraJson, scientificSpectrumCsv } from "../molecular-workbench/scientific-spectra";
import { spectralPlotDefaults, spectralPlotSettingsJson, type SpectralPlotSelection } from "../molecular-workbench/scientific-spectra-plot";
import { computeScientificSpectrum } from "./scientific-spectrum-task";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

function sourceFor(snapshot: Snapshot, params: WorkbenchJobParams<"spectrum">) {
  const science = snapshot.scientific;
  if (params.source === "file") return science?.spectra;
  const frame = science?.frames[params.frameIndex!];
  return params.source === "companion" ? frame?.mcdCompanion?.spectra : frame?.spectra;
}

export const spectrumJob: AgentJobRunner<"spectrum"> = {
  unavailable: snapshot => snapshot.scientific && (snapshot.scientific.spectra?.spectra.length
    || snapshot.scientific.frames.some(frame => frame.spectra?.spectra.length || frame.mcdCompanion?.spectra.spectra.length))
    ? null : "Open scientific data containing a supported spectrum.",
  paramsUnavailable(snapshot, params) {
    const data = sourceFor(snapshot, params);
    const spectrum = data?.spectra.find(item => item.kind === params.kind);
    if (!spectrum) return "The selected source does not contain this spectrum; choose its file, frame or companion explicitly.";
    if (spectrum.kind === "nmr" && !spectrum.atomIndices.some(atom => data!.atomicNumbers[atom] === params.atomicNumber)) return "No NMR source values exist for this element.";
    return null;
  },
  async run(snapshot, params, { signal, timeoutMs, stem, artifact }) {
    const data = sourceFor(snapshot, params)!;
    const selection: SpectralPlotSelection = params.kind === "nmr" ? { kind: "nmr", atomicNumber: params.atomicNumber! } : { kind: params.kind };
    const options = spectralPlotDefaults(selection);
    for (const key of ["scale", "offset", "fwhm", "axisStart", "axisEnd"] as const) if (params[key] !== undefined) options[key] = params[key];
    const plot = await computeScientificSpectrum({ data, selection, options }, { signal, timeoutMs });
    const selected = { ...data, spectra: data.spectra.filter(item => item.kind === params.kind) };
    const name = `${stem}-${params.source}${params.frameIndex === undefined ? "" : `-${params.frameIndex + 1}`}-${params.kind}`;
    // Full numeric grid, not the decimated rendering envelope. Raw CSV keeps
    // producer units and atom/transition identities; settings document conversions.
    const rows = [`position_${plot.xUnit},smoothed,stick`];
    for (let i = 0; i < plot.positions.length; i++) rows.push(`${plot.positions[i]},${plot.smoothed[i]},${plot.raw[i]}`);
    return {
      summary: { kind: params.kind, source: params.source, frameIndex: params.frameIndex ?? null,
        atomicNumber: params.atomicNumber ?? null, points: plot.positions.length, sourceRows: plot.sourceRowIndices.length,
        xUnit: plot.xUnit, settings: plot.settings },
      artifacts: [
        await artifact("source", `${name}-source.json`, "application/json", scientificSpectraJson(selected)),
        await artifact("source_csv", `${name}-source.csv`, "text/csv", scientificSpectrumCsv(data, params.kind)),
        await artifact("display", `${name}-display.csv`, "text/csv", `${rows.join("\n")}\n`),
        await artifact("settings", `${name}-settings.json`, "application/json", spectralPlotSettingsJson(plot)),
      ],
    };
  },
};

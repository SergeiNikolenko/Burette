import type { WorkbenchJobParams } from "../../../../../scripts/workbench-agent-contract.mjs";
import { spectrumCsv, spectrumJson } from "../molecular-workbench/vibrational-spectrum";
import { VIBRATIONAL_PLOT_DEFAULTS, vibrationalAxisRange } from "../molecular-workbench/vibrational-spectrum-plot";
import { computeVibrationalSpectrum } from "./vibrational-spectrum-task";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

function sourceModes(snapshot: Snapshot, params: WorkbenchJobParams<"vibrational_spectrum">) {
  return params.source === "file" ? snapshot.scientific?.modes : snapshot.scientific?.frames[params.frameIndex!]?.modes;
}

export const vibrationalSpectrumJob: AgentJobRunner<"vibrational_spectrum"> = {
  unavailable: snapshot => snapshot.scientific && (snapshot.scientific.modes.length || snapshot.scientific.frames.some(frame => frame.modes?.length))
    ? null : "Open scientific data containing source vibrational modes.",
  paramsUnavailable(snapshot, params) {
    const modes = sourceModes(snapshot, params);
    if (!modes?.length) return "The selected source has no modes; choose its file or frame explicitly.";
    const field = params.kind === "ir" ? "intensityKmMol" : "ramanActivityAngstrom4Amu";
    if (modes.some(mode => mode[field] === undefined)) return "Every source mode must carry the requested quantity; missing intensities or activities are not zero.";
    return null;
  },
  async run(snapshot, params, { signal, timeoutMs, stem, artifact }) {
    const modes = sourceModes(snapshot, params)!;
    const options = { ...VIBRATIONAL_PLOT_DEFAULTS[params.kind] };
    for (const key of ["scale", "offsetCm1", "fwhmCm1"] as const) if (params[key] !== undefined) options[key] = params[key];
    Object.assign(options, vibrationalAxisRange(modes, params.kind, options));
    for (const key of ["axisStartCm1", "axisEndCm1"] as const) if (params[key] !== undefined) options[key] = params[key];
    const plot = await computeVibrationalSpectrum({ modes, kind: params.kind, options }, { signal, timeoutMs });
    const provenance = { sourceName: snapshot.document.title, format: snapshot.scientific!.format,
      frame: params.source === "frame" ? params.frameIndex! + 1 : null, frameCount: snapshot.scientific!.frames.length };
    const settings = { kind: "vibrational-spectrum-display-settings", version: 1, spectrum: params.kind,
      source: { ...provenance, scope: params.source, frameIndex: params.frameIndex ?? null }, parameters: options,
      arithmetic: "float32-peak-height", xUnit: "cm^-1", yUnit: params.kind === "ir" ? "conventional display (not physical transmittance)" : "angstrom^4/amu",
      smoothedTransform: params.kind === "ir" ? "100*(1-sum/125)" : "sum", stickTransform: params.kind === "ir" ? "100*(1-sum/100)" : "sum" };
    const rows = ["wavenumber_cm-1,smoothed,stick"];
    for (let i = 0; i < plot.wavenumbers.length; i++) rows.push(`${plot.wavenumbers[i]},${plot.smoothed[i]},${plot.raw[i]}`);
    const name = `${stem}-${params.source}${params.frameIndex === undefined ? "" : `-${params.frameIndex + 1}`}-${params.kind}`;
    return {
      summary: { kind: params.kind, source: params.source, frameIndex: params.frameIndex ?? null, sourceRows: modes.length, points: plot.wavenumbers.length, settings },
      artifacts: [
        await artifact("source", `${name}-source.json`, "application/json", spectrumJson(modes, provenance)),
        await artifact("source_csv", `${name}-source.csv`, "text/csv", spectrumCsv(modes, provenance)),
        await artifact("display", `${name}-display.csv`, "text/csv", `${rows.join("\n")}\n`),
        await artifact("settings", `${name}-settings.json`, "application/json", `${JSON.stringify(settings, null, 2)}\n`),
      ],
    };
  },
};

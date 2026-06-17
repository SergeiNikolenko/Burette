export type ConformerPipelineStep =
  | "input"
  | "generation"
  | "optimization"
  | "deduplication"
  | "clustering"
  | "analytics"
  | "handoff";

export type ConformerRecord = {
  index: number;
  title: string;
  atomCount: number;
  energyHartree: number | null;
  relativeEnergyKcalMol: number | null;
  cluster: number | null;
  flags: string[];
};

export type ConformerEnsembleSummary = {
  title: string;
  path: string;
  format: string;
  source: "crest" | "prism" | "sdf" | "xyz" | "manual";
  conformerCount: number;
  atomCount: number | null;
  energyRangeKcalMol: number | null;
  pipeline: Array<{
    step: ConformerPipelineStep;
    label: string;
    status: "ready" | "available" | "missing";
    detail: string;
  }>;
  records: ConformerRecord[];
  recommendations: string[];
};

const HARTREE_TO_KCAL_MOL = 627.509474;
const CONFORMER_ENSEMBLE_EXTENSIONS = new Set(["xyz", "sdf", "sd"]);
const CONFORMER_WORKFLOW_EXTENSIONS = new Set(["xyz", "sdf", "sd", "mol", "mol2", "smi", "smiles", "pdb", "pdbqt", "ent", "cif", "mmcif", "mcif"]);

export function canInspectConformerEnsemble(extension: string) {
  return CONFORMER_ENSEMBLE_EXTENSIONS.has(normalizeExtension(extension));
}

export function canUseConformerWorkflow(extension: string) {
  return CONFORMER_WORKFLOW_EXTENSIONS.has(normalizeExtension(extension));
}

export function canShowConformerWorkflow(extension: string, renderer: string) {
  return canUseConformerWorkflow(extension) || renderer === "molstar";
}

export function summarizeConformerEnsemble(input: {
  title: string;
  path: string;
  extension: string;
  text: string;
}): ConformerEnsembleSummary {
  const extension = normalizeExtension(input.extension || input.path);
  const records = extension === "sdf" || extension === "sd"
    ? parseSdfConformers(input.text)
    : parseXyzConformers(input.text);
  const source = inferSource(input.path, input.text, extension);
  const normalizedRecords = withRelativeEnergies(records);
  const conformerCount = normalizedRecords.length;
  const atomCount = conformerCount > 0 ? normalizedRecords[0].atomCount : null;
  const energyRangeKcalMol = energyRange(normalizedRecords);
  return {
    title: input.title,
    path: input.path,
    format: extension || "unknown",
    source,
    conformerCount,
    atomCount,
    energyRangeKcalMol,
    pipeline: pipelineFor(source, conformerCount),
    records: normalizedRecords,
    recommendations: recommendationsFor(source, conformerCount, energyRangeKcalMol),
  };
}

export function conformerEnsembleManifest(summary: ConformerEnsembleSummary) {
  return {
    version: 1,
    surface: "conformer-ensemble",
    title: summary.title,
    sources: [{ label: "Input ensemble", path: summary.path, format: summary.format }],
    artifacts: [
      { kind: summary.format === "sdf" || summary.format === "sd" ? "sdf" : "xyz", path: summary.path },
    ],
    metrics: {
      source: summary.source,
      conformerCount: summary.conformerCount,
      atomCount: summary.atomCount,
      energyRangeKcalMol: summary.energyRangeKcalMol,
    },
  };
}

export function shouldShowConformerEnsemblePanel(summary: ConformerEnsembleSummary) {
  return summary.conformerCount > 1 || summary.source === "crest" || summary.source === "prism";
}

function parseXyzConformers(text: string): ConformerRecord[] {
  const lines = text.split(/\r?\n/u);
  const records: ConformerRecord[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const first = lines[cursor]?.trim();
    if (!first) {
      cursor += 1;
      continue;
    }
    const atomCount = Number.parseInt(first, 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) {
      cursor += 1;
      continue;
    }
    const title = lines[cursor + 1]?.trim() || `Conformer ${records.length + 1}`;
    const blockEnd = cursor + 2 + atomCount;
    if (blockEnd > lines.length) break;
    records.push({
      index: records.length + 1,
      title,
      atomCount,
      energyHartree: energyFromTitle(title),
      relativeEnergyKcalMol: null,
      cluster: clusterFromTitle(title),
      flags: flagsFromTitle(title),
    });
    cursor = blockEnd;
  }
  return records;
}

function parseSdfConformers(text: string): ConformerRecord[] {
  return text
    .split(/\n\$\$\$\$\s*(?:\r?\n|$)/u)
    .map((record) => record.trimEnd())
    .filter((record) => record.trim().length > 0)
    .map((record, index) => {
      const lines = record.split(/\r?\n/u);
      const title = lines[0]?.trim() || `Conformer ${index + 1}`;
      return {
        index: index + 1,
        title,
        atomCount: atomCountFromMolfile(lines),
        energyHartree: energyFromRecord(record),
        relativeEnergyKcalMol: null,
        cluster: clusterFromRecord(record),
        flags: flagsFromRecord(record),
      };
    });
}

function withRelativeEnergies(records: ConformerRecord[]) {
  const energies = records
    .map((record) => record.energyHartree)
    .filter((energy): energy is number => typeof energy === "number" && Number.isFinite(energy));
  if (energies.length === 0) return records;
  const minimum = Math.min(...energies);
  return records.map((record) => ({
    ...record,
    relativeEnergyKcalMol: record.energyHartree === null ? null : round((record.energyHartree - minimum) * HARTREE_TO_KCAL_MOL, 3),
  }));
}

function energyRange(records: ConformerRecord[]) {
  const values = records
    .map((record) => record.relativeEnergyKcalMol)
    .filter((energy): energy is number => typeof energy === "number" && Number.isFinite(energy));
  if (values.length === 0) return null;
  return round(Math.max(...values) - Math.min(...values), 3);
}

function pipelineFor(source: ConformerEnsembleSummary["source"], conformerCount: number): ConformerEnsembleSummary["pipeline"] {
  return [
    { step: "input", label: "Input ensemble", status: conformerCount > 0 ? "ready" : "missing", detail: `${conformerCount} conformer${conformerCount === 1 ? "" : "s"} detected` },
    { step: "generation", label: "Generation", status: source === "crest" ? "ready" : "available", detail: source === "crest" ? "CREST output detected" : "CREST, RDKit ETKDG, MCMM, or manual ensembles can feed this surface" },
    { step: "optimization", label: "Optimization", status: "available", detail: "Attach xTB, DFT, or force-field refinement outputs when they are produced outside Burrete" },
    { step: "deduplication", label: "Deduplication", status: source === "prism" ? "ready" : "available", detail: source === "prism" ? "PRISM-style pruning detected" : "Run PRISM Pruner or CREGEN before expensive downstream work" },
    { step: "clustering", label: "Clustering", status: "available", detail: "Use ReSCoSS-style cluster representatives for diverse output subsets" },
    { step: "analytics", label: "Analytics", status: conformerCount > 0 ? "ready" : "available", detail: "Energy, cluster, and coordinate analytics belong in this workspace" },
    { step: "handoff", label: "Handoff", status: "available", detail: "Export top, pruned, or cluster-representative conformers to docking, FEP, or property workflows" },
  ];
}

function recommendationsFor(source: ConformerEnsembleSummary["source"], conformerCount: number, energyRangeKcalMol: number | null) {
  const recommendations = [];
  if (conformerCount === 0) {
    recommendations.push("Open a multi-structure XYZ or SDF ensemble before running conformer analytics.");
    return recommendations;
  }
  if (source !== "prism" && conformerCount > 50) {
    recommendations.push("Prune duplicates and rotamers with PRISM Pruner before DFT, property prediction, docking, or FEP handoff.");
  }
  if (conformerCount > 15) {
    recommendations.push("Build a ReSCoSS-style diverse subset by clustering conformers and selecting the lowest-energy representatives per cluster.");
  }
  if (energyRangeKcalMol === null) {
    recommendations.push("Attach or parse conformer energies to enable Boltzmann weights, energy windows, and coordinate analytics.");
  }
  recommendations.push("Use this workspace as the review surface; keep CREST, PRISM, and high-level refinement as external producers.");
  return recommendations;
}

function inferSource(path: string, text: string, extension: string): ConformerEnsembleSummary["source"] {
  const normalized = `${path}\n${text.slice(0, 4000)}`.toLowerCase();
  if (normalized.includes("prism")) return "prism";
  if (normalized.includes("crest") || normalized.includes("cregen")) return "crest";
  if (extension === "sdf" || extension === "sd") return "sdf";
  if (extension === "xyz") return "xyz";
  return "manual";
}

function atomCountFromMolfile(lines: string[]) {
  const countsLine = lines[3] ?? "";
  const count = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function energyFromRecord(record: string) {
  const property = propertyValue(record, "energy") ?? propertyValue(record, "total_energy");
  if (property) {
    const value = Number.parseFloat(property);
    if (Number.isFinite(value)) return value;
  }
  const match = /(?:energy|total energy|e)\s*[=:]\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/iu.exec(record);
  return match ? Number.parseFloat(match[1]) : null;
}

function energyFromTitle(title: string) {
  const match = /(?:energy|e)\s*[=:]\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/iu.exec(title);
  return match ? Number.parseFloat(match[1]) : null;
}

function clusterFromRecord(record: string) {
  const property = propertyValue(record, "cluster") ?? propertyValue(record, "cluster_id");
  if (property) {
    const value = Number.parseInt(property, 10);
    if (Number.isFinite(value)) return value;
  }
  const match = /(?:cluster|cluster_id)\s*[=:]\s*(\d+)/iu.exec(record);
  return match ? Number.parseInt(match[1], 10) : null;
}

function clusterFromTitle(title: string) {
  const match = /(?:cluster|cluster_id)\s*[=:]\s*(\d+)/iu.exec(title);
  return match ? Number.parseInt(match[1], 10) : null;
}

function flagsFromRecord(record: string) {
  const flags = [];
  if (/representative/iu.test(record)) flags.push("representative");
  if (/duplicate|rotamer/iu.test(record)) flags.push("pruned");
  return flags;
}

function propertyValue(record: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`>\\s*<${escaped}>\\s*\\r?\\n([^\\r\\n]+)`, "iu").exec(record);
  return match?.[1]?.trim() ?? null;
}

function flagsFromTitle(title: string) {
  const flags = [];
  if (/representative/iu.test(title)) flags.push("representative");
  if (/duplicate|rotamer/iu.test(title)) flags.push("pruned");
  return flags;
}

function normalizeExtension(value: string) {
  const name = value.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? value;
  const index = name.lastIndexOf(".");
  return (index >= 0 ? name.slice(index + 1) : name).trim().toLowerCase();
}

function round(value: number, places: number) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

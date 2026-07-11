import { createWriteStream, existsSync, readFileSync, statSync, watch } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename as pathBasename, delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  deferKetcherCssPlugin,
  desktopManualChunks,
  ketcherRaphaelImportShimPlugin,
  resolveModulePreloadDependencies,
} from "./vite/build-plugins";
import {
  registerBrowserDevAppIconRoute,
  registerBrowserDevRdkitWasmRoute,
} from "./vite/browser-dev/assets";
import { registerBrowserDevAgentSessionRoute } from "./vite/browser-dev/agent-session";
import { registerBrowserDevConformerJobRoutes } from "./vite/browser-dev/conformer-jobs";
import { registerBrowserDevInlineConformerRoute } from "./vite/browser-dev/conformer-inline";
import { registerBrowserDevDescriptorRoutes } from "./vite/browser-dev/descriptors";
import { registerBrowserDevDesmondPreviewRoute } from "./vite/browser-dev/desmond";
import {
  registerBrowserDevFileContentRoutes,
  registerBrowserDevFileDiscoveryRoute,
} from "./vite/browser-dev/files";
import {
  isNumpyArtifactExtension,
  numpyArtifactTextSummary,
  registerBrowserDevFoldingResultRoute,
} from "./vite/browser-dev/folding-results";
import { registerBrowserDevMsbuddyRoutes } from "./vite/browser-dev/msbuddy";
import { registerBrowserDevRuntimeDoctorRoute } from "./vite/browser-dev/runtime-doctor";
import { registerBrowserDevXtbRoutes } from "./vite/browser-dev/xtb";
import { registerBrowserDevXyzrenderRoute } from "./vite/browser-dev/xyzrender";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const hostedMcpBuild = process.env.VITE_BURRETE_BUILD_IDENTIFIER === "hosted-mcp-widget";
const prebuiltAgentShellBuild = Boolean(process.env.BURRETE_AGENT_SHELL_OUT_DIR);
const browserRuntimeRepoRoot = hostedMcpBuild || prebuiltAgentShellBuild ? "" : repoRoot;
const desktopDist = process.env.BURRETE_AGENT_SHELL_OUT_DIR
  ? resolve(process.env.BURRETE_AGENT_SHELL_OUT_DIR)
  : fileURLToPath(new URL("dist", import.meta.url));
const previewFormatRegistry = JSON.parse(readFileSync(join(repoRoot, "config", "preview-formats.json"), "utf8"));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);
const defaultDevFileRoots = (process.env.BURRETE_DEV_DEFAULT_FILES ?? "").split(delimiter).filter(Boolean);
const defaultDesktopRoots = [
  join(homedir(), "Desktop", "BurettePreviewSamples"),
  join(homedir(), "Desktop", "BuretteMDAnalysisSamples"),
  join(homedir(), "Desktop", "xyzrender-main"),
].filter((path) => existsSync(path));
const defaultProjectFiles = [
  join(repoRoot, "samples", "large", "moses_10k.csv"),
].filter((path) => existsSync(path));
const defaultDevFileSources = defaultDevFileRoots.length > 0
  ? defaultDevFileRoots
  : [...defaultProjectFiles, ...defaultDesktopRoots];
const defaultFsAllow = defaultDevFileSources.map((path) => {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch (_) {
    return dirname(path);
  }
});
const execFileAsync = promisify(execFile);
const BROWSER_DEV_APP_ICONS: Record<string, string> = {
  finder: "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns",
  maestro: "/Applications/SchrodingerSuites2026-1/Maestro.app/Contents/Resources/Maestro.icns",
  chimerax: "/Applications/ChimeraX-1.10.app/Contents/Resources/chimerax-icon.icns",
  pymol: "/Applications/PyMOL.app/Contents/Resources/pymol.icns",
  avogadro2: "/Applications/Avogadro2.app/Contents/Resources/avogadro.icns",
  datawarrior: "/Applications/DataWarrior.app/Contents/Resources/datawarrior.icns",
  vesta: "/Applications/VESTA.app/Contents/Resources/VESTA.icns",
};
const DEV_FILE_SIZE_LIMIT = 75 * 1024 * 1024;
const TEXT_FILE_READ_LIMIT = 12 * 1024 * 1024;
const DESMOND_PREVIEW_TARGET_MB = 24;
const RDKIT_WASM_PATH = join(repoRoot, "PreviewExtension", "Web", "rdkit", "RDKit_minimal.wasm");
const RDKIT_CONFORMER_SCRIPT_PATH = join(repoRoot, "scripts", "rdkit_conformer.py");
const BROWSER_DEV_GENERATED_FILES_ROOT = process.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT
  ? resolve(process.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT)
  : join(homedir(), "Desktop", "Burrete Generated Files");
const BROWSER_DEV_XTB_JOBS_ROOT = join(BROWSER_DEV_GENERATED_FILES_ROOT, "xTB Jobs");
const BROWSER_DEV_CONFORMER_JOBS_ROOT = join(BROWSER_DEV_GENERATED_FILES_ROOT, "Conformer Jobs");
const browserDevGeneratedFileRoots = [BROWSER_DEV_GENERATED_FILES_ROOT];
const devFsAllowRoots = [repoRoot, ...defaultFsAllow, ...browserDevGeneratedFileRoots, ...extraFsAllow].map((path) => resolve(path));
const BROWSER_DEV_CCD_CACHE_ROOT = join(homedir(), ".cache", "burrete", "ccd-ligands");
const BROWSER_DEV_CHEMISTRY_PREP_PROJECT = join(repoRoot, "tools", "chemistry-prep");
const BROWSER_DEV_DESCRIPTOR_RUNTIME_DIR = process.env.BURRETE_DESCRIPTOR_RUNTIME_DIR
  ? resolve(process.env.BURRETE_DESCRIPTOR_RUNTIME_DIR)
  : join(homedir(), "Library", "Application Support", "Burrete", "descriptor-python");
const BROWSER_DEV_MSBUDDY_RUNTIME_DIR = process.env.BURRETE_MSBUDDY_RUNTIME_DIR
  ? resolve(process.env.BURRETE_MSBUDDY_RUNTIME_DIR)
  : join(homedir(), "Library", "Application Support", "Burrete", "msbuddy-python");
const XTB_RUN_METADATA_FILE = ".burrete-xtb-run.json";
const CONFORMER_RUN_METADATA_FILE = ".burrete-conformer-run.json";
const XTB_LOG_CAPTURE_BYTES = 128 * 1024;
const DIRECT_CHEMISTRY_JOB_ATOM_LIMIT = 300;
const DESCRIPTOR_INPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const DESCRIPTOR_GRID_BATCH_SIZE = 16;
const DESCRIPTOR_STATUS_TIMEOUT_MS = 10_000;
const DESCRIPTOR_RUN_TIMEOUT_MS = 30_000;
const DESCRIPTOR_GRID_BATCH_TIMEOUT_MS = 300_000;
const DESCRIPTOR_INSTALL_TIMEOUT_MS = 600_000;
const CONFORMER_PYTHON_STATUS_TIMEOUT_MS = 10_000;
const MSBUDDY_RUN_TIMEOUT_MS = 180_000;
const runningBrowserDevJobs = new Map<string, ChildProcess>();
const cancelledBrowserDevJobs = new Set<string>();
const browserDevDescriptorJobs = new Map<string, BrowserDevGridDescriptorJobStatus>();
type PythonCommand = {
  label: string;
  command: string;
  args: string[];
};
type ConformerPythonEngine = "datamol" | "rdkit";
type BrowserDevDescriptorCellValue = {
  id: string;
  label: string;
  value?: unknown;
  missingKind?: string | null;
  errorText?: string | null;
};

type BrowserDevGridRecord = {
  index: number;
  name: string;
  smiles?: string;
  molblock?: string;
};

type BrowserDevMsbuddyPeak = {
  index: number;
  mz: number;
  intensity: number;
  annotation?: string;
  annotations?: Record<string, unknown>;
};

type BrowserDevMsbuddyCandidate = {
  rank: number;
  formula: string;
  score: number | null;
  massErrorPpm: number | null;
  explainedPeakIndexes: number[];
  evidence: string;
  source: "msbuddy" | "spectrum";
};

type BrowserDevGridDescriptorResultRow = {
  index: number;
  rowId: number;
  descriptors: Record<string, BrowserDevDescriptorCellValue>;
};

type BrowserDevGridDescriptorRunSummary = {
  totalRows: number;
  calculatedRows: number;
  failedRows: number;
  descriptorIdCount: number;
  descriptorIds: string[];
};

type BrowserDevGridDescriptorJobStatus = {
  documentId: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  running: boolean;
  totalRows: number;
  processedRows: number;
  calculatedRows: number;
  failedRows: number;
  message: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  summary?: BrowserDevGridDescriptorRunSummary | null;
  rows?: BrowserDevGridDescriptorResultRow[];
};

type StructureAttachmentRole = "topology" | "trajectory" | "trajectoryPointer" | "configuration";
type StructureFileBundle = {
  kind: "desmond" | "md" | "single";
  primaryPath: string;
  inputPath: string;
  attachments: Array<{ role: StructureAttachmentRole; path: string }>;
};
const DEV_FILE_EXTENSIONS = new Set([
  ...previewFormatRegistry.documentTypes.extensions,
  "dtr",
  "magma",
  "md",
  "markdown",
  "mdx",
  "mgf",
  "ms",
  "msp",
  "mzml",
  "mzxml",
  "txt",
  "log",
  "err",
  "sh",
  "bash",
  "zsh",
  "py",
  "rs",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "npy",
  "npz",
  "pkl",
  "yaml",
  "yml",
  "toml",
  "html",
  "css",
]);
const MD_COORDINATE_EXTENSIONS = [
  "xtc", "trr", "dcd", "nctraj", "tng", "h5md", "gsd", "trz", "coor", "namdbin",
  "nc", "ncdf", "netcdf", "ncrst", "lammpstrj", "dump", "pos", "cfg", "trj", "mdcrd", "crdbox",
  "trc", "arc", "config", "history",
];
const MD_TOPOLOGY_EXTENSIONS = [
  "pdb", "ent", "pdbqt", "pqr", "xpdb", "gro", "cif", "mmcif", "mcif", "bcif",
  "mmtf", "mol2", "psf", "prmtop", "top", "tpr", "parm7", "parm", "itp", "data",
  "lammps", "lmp", "txyz", "xml", "inpcrd", "rst7", "crd", "rst", "state",
];
const MOLECULAR_BINARY_METADATA_EXTENSIONS = new Set([
  "chk", "checkpoint", "coor", "dcd", "dms", "edr", "gsd", "h5md", "namdbin", "nc",
  "ncdf", "ncrst", "nctraj", "netcdf", "tng", "tpr", "trr", "trz", "xtc",
]);
const SCHRODINGER_RUN = "/opt/schrodinger/suites2026-1/run";
const DESMOND_PREVIEW_EXTRACTOR = join(repoRoot, "scripts", "desmond_preview_extract.py");
const XYZRENDER_PRESET_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "flat", label: "Flat" },
  { value: "paton", label: "Paton" },
  { value: "pmol", label: "PMol" },
  { value: "skeletal", label: "Skeletal" },
  { value: "bubble", label: "Bubble" },
  { value: "tube", label: "Tube" },
  { value: "btube", label: "BTube" },
  { value: "mtube", label: "MTube" },
  { value: "wire", label: "Wire" },
  { value: "graph", label: "Graph" },
  { value: "vdw", label: "vdW" },
  { value: "custom", label: "Custom JSON" },
];
const BROWSER_DEV_DESCRIPTOR_RUNNER = `
import io
import json
import math
import sys
import traceback


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), file=sys.__stdout__, flush=True)


def import_engine():
    try:
        from rdkit import Chem
        import rdkit
        import mordred
        from mordred import Calculator, descriptors
        return {
            "ok": True,
            "Chem": Chem,
            "rdkit_version": getattr(rdkit, "__version__", None),
            "mordred_version": getattr(mordred, "__version__", None),
            "Calculator": Calculator,
            "descriptors": descriptors,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def molecule_from_payload(Chem, payload):
    fmt = (payload.get("format") or "").lower()
    text = payload.get("text") or ""
    if fmt in ("molfile", "mol"):
        return Chem.MolFromMolBlock(text, sanitize=True, removeHs=False), None
    if fmt in ("sdf", "sd"):
        supplier = Chem.ForwardSDMolSupplier(io.BytesIO(text.encode("utf-8")), sanitize=True, removeHs=False)
        for mol in supplier:
            if mol is not None:
                return mol, None
        return None, "SDF did not contain a readable molecule"
    if fmt in ("smiles", "smi"):
        first = text.strip().splitlines()[0].strip() if text.strip() else ""
        smiles = first.split()[0] if first else ""
        return Chem.MolFromSmiles(smiles), None
    return None, f"Unsupported descriptor payload format: {fmt or 'unknown'}"


PREFERRED_LABELS = {
    "MW": "Molecular weight",
    "AMW": "Average molecular weight",
    "nAtom": "Atoms",
    "nHeavyAtom": "Heavy atoms",
    "nHetero": "Hetero atoms",
    "nBonds": "Bonds",
    "nBondsO": "Order-sensitive bonds",
    "nBondsS": "Single bonds",
    "nRot": "Rotatable bonds",
    "nRing": "Rings",
    "nAromAtom": "Aromatic atoms",
    "nAromBond": "Aromatic bonds",
    "TopoPSA": "Topological polar surface area",
    "SLogP": "SLogP",
}


def normalize_value(value):
    module = type(value).__module__
    if module.startswith("mordred.error"):
        return {"value": None, "missingKind": type(value).__name__, "errorText": str(value)}
    if value is None:
        return {"value": None, "missingKind": "missing", "errorText": None}
    if isinstance(value, bool):
        return {"value": value, "missingKind": None, "errorText": None}
    if isinstance(value, int):
        return {"value": value, "missingKind": None, "errorText": None}
    if isinstance(value, float):
        if math.isfinite(value):
            return {"value": value, "missingKind": None, "errorText": None}
        return {"value": None, "missingKind": "nonFinite", "errorText": str(value)}
    try:
        numeric = float(value)
        if math.isfinite(numeric):
            return {"value": numeric, "missingKind": None, "errorText": None}
    except Exception:
        pass
    return {"value": str(value), "missingKind": None, "errorText": None}


def descriptor_values(calc, mol):
    result = calc(mol).asdict()
    values = []
    for descriptor in calc.descriptors:
        key = str(descriptor)
        if key not in result:
            continue
        normalized = normalize_value(result[key])
        values.append({
            "id": key,
            "label": PREFERRED_LABELS.get(key, key),
            "value": normalized["value"],
            "missingKind": normalized["missingKind"],
            "errorText": normalized["errorText"],
        })
    return values


def calculate_payload(payload, engine, calc):
    mol, error = molecule_from_payload(engine["Chem"], payload)
    if mol is None:
        return {"ok": False, "error": error or "Descriptor payload did not produce a molecule"}
    return {
        "ok": True,
        "descriptorSet": payload.get("descriptorSet") or "all-2d",
        "molecule": {"atomCount": int(mol.GetNumAtoms()), "bondCount": int(mol.GetNumBonds())},
        "engine": {"mordredVersion": engine["mordred_version"], "rdkitVersion": engine["rdkit_version"]},
        "values": descriptor_values(calc, mol),
    }


def calculate(payload, engine):
    calc = engine["Calculator"](engine["descriptors"], ignore_3D=True)
    emit(calculate_payload(payload, engine, calc))


def calculate_grid_batch(payload, engine):
    calc = engine["Calculator"](engine["descriptors"], ignore_3D=True)
    results = []
    for row in payload.get("rows") or []:
        row_payload = {
            "format": row.get("format"),
            "text": row.get("text"),
            "label": row.get("sourceLabel"),
            "descriptorSet": payload.get("descriptorSet") or "all-2d",
        }
        result = calculate_payload(row_payload, engine, calc)
        result["rowId"] = row.get("rowId")
        result["index"] = row.get("index")
        results.append(result)
    emit({"ok": True, "descriptorSet": payload.get("descriptorSet") or "all-2d", "rows": results})


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    engine = import_engine()
    if payload.get("mode") == "status":
        if not engine["ok"]:
            emit({"ok": False, "error": engine["error"]})
            return
        emit({"ok": True, "mordredVersion": engine["mordred_version"], "rdkitVersion": engine["rdkit_version"]})
        return
    if not engine["ok"]:
        emit({"ok": False, "error": engine["error"]})
        return
    if payload.get("mode") == "gridBatch":
        calculate_grid_batch(payload, engine)
        return
    calculate(payload, engine)


try:
    main()
except Exception as exc:
    emit({"ok": False, "error": str(exc), "traceback": traceback.format_exc(limit=8)})
`;
const BROWSER_DEV_MSBUDDY_RUNNER = `
import contextlib
import io
import json
import math
import sys
import traceback


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), file=sys.__stdout__, flush=True)


def finite_number(value):
    try:
        number = float(value)
    except Exception:
        return None
    return number if math.isfinite(number) else None


def adduct_charge(adduct):
    text = str(adduct or "").strip()
    if text.endswith("-") or "]-" in text:
        return -1
    return 1


def clean_adduct(value):
    text = str(value or "").strip()
    return text if text else "[M+H]+"


def normalize_peaks(peaks):
    mz_values = []
    intensity_values = []
    for peak in peaks or []:
        if not isinstance(peak, dict):
            continue
        mz = finite_number(peak.get("mz"))
        intensity = finite_number(peak.get("intensity"))
        if mz is None or intensity is None or mz <= 0 or intensity < 0:
            continue
        mz_values.append(mz)
        intensity_values.append(intensity)
    return mz_values, intensity_values


def best_precursor(input_payload, mz_values, intensity_values):
    precursor = finite_number(input_payload.get("precursorMz"))
    if precursor is not None and precursor > 0:
        return precursor, "metadata"
    if mz_values:
        base_index = max(range(len(mz_values)), key=lambda index: intensity_values[index])
        return mz_values[base_index], "base peak fallback"
    return None, "missing"


def summary_candidates(summary):
    candidates = []
    estimated_fdr = finite_number(summary.get("estimated_fdr"))
    for rank in range(1, 6):
        formula = summary.get(f"formula_rank_{rank}")
        if not formula:
            continue
        score = None
        if rank == 1 and estimated_fdr is not None:
            score = max(0.0, min(1.0, 1.0 - estimated_fdr))
        candidates.append({
            "rank": rank,
            "formula": str(formula),
            "score": score,
            "massErrorPpm": None,
            "explainedPeakIndexes": [],
            "evidence": "msbuddy annotate_formula",
            "source": "msbuddy",
        })
    return candidates


def mz_candidates(engine, precursor, adduct):
    candidates = []
    for rank, formula_result in enumerate(engine.mz_to_formula(precursor, adduct=adduct, mz_tol=10, ppm=True, halogen=True)[:5], start=1):
        candidates.append({
            "rank": rank,
            "formula": str(getattr(formula_result, "formula", "")),
            "score": None,
            "massErrorPpm": finite_number(getattr(formula_result, "mass_error_ppm", None)),
            "explainedPeakIndexes": [],
            "evidence": "msbuddy mz_to_formula",
            "source": "msbuddy",
        })
    return [candidate for candidate in candidates if candidate["formula"]]


def main():
    try:
        payload = json.load(sys.stdin)
        input_payload = payload.get("input") if isinstance(payload.get("input"), dict) else payload
        if not isinstance(input_payload, dict):
            raise ValueError("msbuddy input must be an object.")

        mz_values, intensity_values = normalize_peaks(input_payload.get("peaks"))
        if not mz_values:
            raise ValueError("Spectrum has no usable peaks.")

        precursor, precursor_source = best_precursor(input_payload, mz_values, intensity_values)
        if precursor is None:
            raise ValueError("Spectrum has no precursor or usable base peak.")

        adduct = clean_adduct(input_payload.get("candidateIon"))

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            import numpy as np
            from msbuddy import MetaFeature, Msbuddy, MsbuddyConfig, Spectrum

            config = MsbuddyConfig(
                ms_instr="orbitrap",
                ppm=True,
                ms1_tol=10,
                ms2_tol=10,
                halogen=True,
                parallel=False,
                timeout_secs=90,
                batch_size=1,
            )
            engine = Msbuddy(config)
            feature = MetaFeature(
                str(input_payload.get("title") or "spectrum"),
                mz=float(precursor),
                charge=adduct_charge(adduct),
                adduct=adduct,
                ms2=Spectrum(np.array(mz_values, dtype=float), np.array(intensity_values, dtype=float)),
            )
            engine.add_data([feature])
            engine.annotate_formula()
            summary = engine.get_summary()[0]
            candidates = summary_candidates(summary)
            if not candidates:
                candidates = mz_candidates(engine, precursor, adduct)

        emit({
            "ok": True,
            "runtime": "msbuddy",
            "message": f"msbuddy annotated this spectrum using {adduct}; precursor from {precursor_source}.",
            "precursorMz": precursor,
            "adduct": adduct,
            "candidates": candidates,
        })
    except Exception as exc:
        emit({
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(limit=4),
        })


if __name__ == "__main__":
    main()
`;

function readOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readOptionalNonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readOptionalFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readOptionalInteger(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : null;
}

function readOptionalBoolean(value: unknown) {
  if (value === true || value === false) return value;
  return null;
}

function readOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function readFieldMode(value: unknown) {
  const text = readOptionalText(value);
  return text && ["auto", "off", "density", "mo", "esp", "nci"].includes(text) ? text : null;
}

function readFieldSurfaceStyle(value: unknown) {
  const text = readOptionalText(value);
  return text && ["solid", "mesh", "contour", "dot"].includes(text) ? text : null;
}

function readDisplayHydrogens(value: unknown) {
  const text = readOptionalText(value);
  return text && ["all", "auto", "none"].includes(text) ? text : null;
}

function readBondNotation(value: unknown) {
  const text = readOptionalText(value);
  return text && ["aromatic", "kekule"].includes(text) ? text : null;
}

function readHullMode(value: unknown) {
  const text = readOptionalText(value);
  return text && ["off", "benzene-ring", "anthracene-rings", "auto-rings", "faces", "pore", "mof5-faces", "mof5-pore", "faces-pore"].includes(text) ? text : null;
}

function xyzrenderHullArgument(mode: string | null | undefined) {
  if (mode === "benzene-ring" || mode === "anthracene-rings" || mode === "auto-rings") return "rings";
  if (mode === "faces" || mode === "mof5-faces" || mode === "faces-pore") return "faces";
  return null;
}

function xyzrenderPoreEnabled(mode: string | null | undefined) {
  return mode === "pore" || mode === "mof5-pore" || mode === "faces-pore";
}

function normalizeSupercell(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map((item) => readOptionalInteger(item));
  if (parsed.some((item) => !item || item < 1)) return null;
  return parsed as [number, number, number];
}

function normalizeXyzrenderAtomSelector(value: unknown) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u.test(text)) return null;
  const parts: string[] = [];
  for (const part of text.split(",")) {
    const [rawStart, rawEnd] = part.split("-");
    const start = Number(rawStart);
    const end = rawEnd == null ? start : Number(rawEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) return null;
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return parts.join(",");
}

function normalizeXyzrenderRegions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((region) => {
    if (!region || typeof region !== "object") return null;
    const source = region as Record<string, unknown>;
    const atoms = normalizeXyzrenderAtomSelector(source.atoms);
    if (!atoms) return null;
    return { atoms, preset: normalizeXyzrenderPreset(readOptionalText(source.preset)) };
  }).filter((region): region is { atoms: string; preset: string } => Boolean(region));
}

function normalizeXyzrenderControls(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    transparentBackground: readOptionalBoolean(source.transparentBackground),
    canvasSize: readOptionalNumber(source.canvasSize),
    atomScale: readOptionalNumber(source.atomScale),
    bondWidth: readOptionalNumber(source.bondWidth),
    atomStrokeWidth: readOptionalNumber(source.atomStrokeWidth),
    molColor: readOptionalText(source.molColor),
    gradients: readOptionalBoolean(source.gradients),
    fog: readOptionalBoolean(source.fog),
    fogStrength: readOptionalNumber(source.fogStrength),
    showVdw: readOptionalBoolean(source.showVdw),
    vdwAtoms: normalizeXyzrenderAtomSelector(source.vdwAtoms),
    vdwOpacity: readOptionalNumber(source.vdwOpacity),
    vdwScale: readOptionalNumber(source.vdwScale),
    hullMode: readHullMode(source.hullMode),
    hullAtoms: normalizeXyzrenderAtomSelector(source.hullAtoms),
    hullOpacity: readOptionalNonNegativeNumber(source.hullOpacity),
    poreOpacity: readOptionalNonNegativeNumber(source.poreOpacity),
    hideBonds: readOptionalBoolean(source.hideBonds),
    displayHydrogens: readDisplayHydrogens(source.displayHydrogens),
    bondNotation: readBondNotation(source.bondNotation),
    showCell: readOptionalBoolean(source.showCell),
    showGhosts: readOptionalBoolean(source.showGhosts),
    showAxes: readOptionalBoolean(source.showAxes),
    cellWidth: readOptionalNumber(source.cellWidth),
    supercell: normalizeSupercell(source.supercell),
    fieldMode: readFieldMode(source.fieldMode),
    fieldIso: readOptionalNumber(source.fieldIso),
    fieldOpacity: readOptionalNonNegativeNumber(source.fieldOpacity),
    fieldSurfaceStyle: readFieldSurfaceStyle(source.fieldSurfaceStyle),
    fieldMoPositiveColor: readOptionalText(source.fieldMoPositiveColor),
    fieldMoNegativeColor: readOptionalText(source.fieldMoNegativeColor),
    fieldDensityColor: readOptionalText(source.fieldDensityColor),
    fieldCmapPalette: readOptionalText(source.fieldCmapPalette),
    fieldCmapMin: readOptionalFiniteNumber(source.fieldCmapMin),
    fieldCmapMax: readOptionalFiniteNumber(source.fieldCmapMax),
    customConfigPath: readOptionalText(source.customConfigPath),
    extraArguments: readOptionalText(source.extraArguments),
    regions: normalizeXyzrenderRegions(source.regions),
  };
}

function splitCommandLine(value: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

function sanitizedExtraArguments(value: string | null, stripFieldArguments = false) {
  if (!value) return [];
  const blockedValueFlags = new Set(["-o", "--output", "-go", "--gif-output", "--config", "--ref"]);
  const blocked = new Set(blockedValueFlags);
  const blockedValueCounts = new Map<string, number>();
  blocked.add("--region");
  blockedValueCounts.set("--region", 2);
  blocked.add("--hull");
  ["--hull-color", "--hull-opacity", "--hull-color-type", "--hull-edge-width-ratio", "--ring-max-size", "--ring-min-size", "--face-planarity", "--pore-color", "--pore-opacity"].forEach((flag) => {
    blocked.add(flag);
    blockedValueFlags.add(flag);
  });
  ["--pore", "--hull-edge", "--no-hull-edge"].forEach((flag) => blocked.add(flag));
  ["--hy", "--no-hy", "--bo", "--no-bo", "-k"].forEach((flag) => blocked.add(flag));
  if (stripFieldArguments) {
    ["--esp", "--nci-surf", "--iso", "--opacity", "--surface-style", "--dens-color", "--cmap-palette"].forEach((flag) => {
      blocked.add(flag);
      blockedValueFlags.add(flag);
    });
    [["--mo-colors", 2], ["--cmap-range", 2]].forEach(([flag, count]) => {
      blocked.add(String(flag));
      blockedValueCounts.set(String(flag), Number(count));
    });
    ["--mo", "--dens"].forEach((flag) => blocked.add(flag));
  }
  const blockedPrefixes = [...blocked].map((flag) => `${flag}=`);
  const result: string[] = [];
  let skipNext = 0;
  for (const token of splitCommandLine(value)) {
    if (skipNext > 0) {
      skipNext -= 1;
      continue;
    }
    if (blocked.has(token)) {
      skipNext = blockedValueCounts.get(token) ?? (blockedValueFlags.has(token) ? 1 : 0);
      continue;
    }
    if (blockedPrefixes.some((flag) => token.startsWith(flag))) continue;
    result.push(token);
  }
  return result;
}

function resolveConfigArgument(preset: string, controls: ReturnType<typeof normalizeXyzrenderControls>) {
  if (preset !== "custom") return preset;
  return controls.customConfigPath || "default";
}

function resolveEffectivePreset(preset: string, controls: ReturnType<typeof normalizeXyzrenderControls>) {
  return preset === "custom" && resolveConfigArgument(preset, controls) === "default" ? "default" : preset;
}

function buildXyzrenderArgs(
  inputPath: string,
  outputPath: string,
  preset: string,
  orientationRefPath: string | null,
  controls: ReturnType<typeof normalizeXyzrenderControls>,
) {
  const args = ["-o", outputPath, "--config", resolveConfigArgument(preset, controls)];
  if (orientationRefPath) args.push("--ref", orientationRefPath);
  args.push(inputPath);
  if (controls.transparentBackground === true) args.push("--transparent");
  if (controls.canvasSize) args.push("-S", String(controls.canvasSize));
  if (controls.atomScale) args.push("-a", String(controls.atomScale));
  if (controls.bondWidth) args.push("-b", String(controls.bondWidth));
  if (controls.atomStrokeWidth) args.push("-s", String(controls.atomStrokeWidth));
  if (controls.molColor) args.push("--mol-color", controls.molColor);
  if (controls.gradients === true) args.push("--grad");
  if (controls.gradients === false) args.push("--no-grad");
  if (controls.fog === true) args.push("--fog");
  if (controls.fog === false) args.push("--no-fog");
  if (controls.fogStrength) args.push("-F", String(controls.fogStrength));
  if (preset !== "vdw" && controls.showVdw === true) {
    args.push("--vdw");
    if (controls.vdwAtoms) args.push(controls.vdwAtoms);
  }
  if (controls.vdwOpacity) args.push("--vdw-opacity", String(controls.vdwOpacity));
  if (controls.vdwScale) args.push("--vdw-scale", String(controls.vdwScale));
  const hullArgument = controls.hullAtoms || xyzrenderHullArgument(controls.hullMode);
  if (hullArgument) {
    args.push("--hull");
    args.push(hullArgument);
  }
  if (controls.hullOpacity != null) args.push("--hull-opacity", String(controls.hullOpacity));
  if (xyzrenderPoreEnabled(controls.hullMode)) args.push("--pore");
  if (controls.poreOpacity != null) args.push("--pore-opacity", String(controls.poreOpacity));
  if (controls.hideBonds === true) args.push("--no-bonds");
  if (controls.displayHydrogens === "all") args.push("--hy");
  if (controls.displayHydrogens === "none") args.push("--no-hy");
  if (controls.bondNotation === "aromatic") args.push("--bo");
  if (controls.bondNotation === "kekule") args.push("--bo", "-k");
  if (controls.showCell === true) args.push("--cell");
  if (controls.showCell === false) args.push("--no-cell");
  if (controls.showGhosts === true) args.push("--ghosts");
  if (controls.showGhosts === false) args.push("--no-ghosts");
  if (controls.showAxes === true) args.push("--axes");
  if (controls.showAxes === false) args.push("--no-axes");
  if (controls.cellWidth) args.push("--cell-width", String(controls.cellWidth));
  if (controls.supercell) args.push("--supercell", ...controls.supercell.map(String));
  for (const region of controls.regions) args.push("--region", region.atoms, region.preset);
  args.push(...sanitizedExtraArguments(controls.extraArguments, Boolean(controls.fieldMode)));
  if (controls.fieldMode && controls.fieldMode !== "auto") {
    if (controls.fieldMode === "density") args.push("--dens");
    else if (controls.fieldMode === "mo") args.push("--mo");
    else if (controls.fieldMode === "esp") args.push("--esp", inputPath);
    else if (controls.fieldMode === "nci") args.push("--nci-surf", inputPath);
  }
  if (controls.fieldMode && controls.fieldMode !== "auto") {
    if (controls.fieldIso != null && controls.fieldIso > 0) args.push("--iso", String(controls.fieldIso));
    if (controls.fieldOpacity != null) args.push("--opacity", String(controls.fieldOpacity));
    if (controls.fieldSurfaceStyle) args.push("--surface-style", controls.fieldSurfaceStyle);
    if (controls.fieldMoPositiveColor && controls.fieldMoNegativeColor) args.push("--mo-colors", controls.fieldMoPositiveColor, controls.fieldMoNegativeColor);
    if (controls.fieldDensityColor) args.push("--dens-color", controls.fieldDensityColor);
    if (controls.fieldCmapPalette) args.push("--cmap-palette", controls.fieldCmapPalette);
    if (controls.fieldCmapMin != null && controls.fieldCmapMax != null) args.push("--cmap-range", String(controls.fieldCmapMin), String(controls.fieldCmapMax));
  }
  return args;
}

function normalizeXyzrenderPreset(value: string | null) {
  const normalized = String(value || "default").trim().toLowerCase();
  return XYZRENDER_PRESET_OPTIONS.some((option) => option.value === normalized) ? normalized : "default";
}

function normalizeXyzrenderInputExtension(value: string | null) {
  const normalized = String(value || "xyz").trim().toLowerCase().replace(/^\./, "");
  return ["xyz", "sdf", "sd", "smi", "smiles", "pdb", "cif"].includes(normalized) ? normalized : "xyz";
}

function resolveXyzrenderExecutable() {
  const candidates = [
    process.env.HOME ? join(process.env.HOME, ".local/bin/xyzrender") : "",
    "/opt/homebrew/bin/xyzrender",
    "/usr/local/bin/xyzrender",
  ].filter(Boolean);
  const pathRows = String(process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const row of pathRows) candidates.push(join(row, "xyzrender"));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sourceForRuntimePath(path: string) {
  if (path.includes("xyzrender-runtime")) return "bundled";
  if (path.includes(".local/bin") || path.includes(".local/share")) return "user-local";
  if (path.includes("/opt/") || path.includes("/usr/local/") || path.includes("/opt/homebrew/")) return "system";
  return "resolved-path";
}

function browserDevXyzrenderStatus() {
  const executable = resolveXyzrenderExecutable();
  return executable
    ? {
        installed: true,
        executablePath: executable,
        source: sourceForRuntimePath(executable),
        installHint: "Install xyzrender in ~/.local/bin or make it available on PATH.",
        message: "External xyzrender runtime is available",
      }
    : {
        installed: false,
        executablePath: null,
        source: null,
        installHint: "Install xyzrender in ~/.local/bin or make it available on PATH.",
        message: "External xyzrender executable was not found.",
      };
}

function browserDevSchrodingerStatus() {
  const configuredRun = process.env.SCHRODINGER ? join(process.env.SCHRODINGER, "run") : "";
  const executable = [configuredRun, SCHRODINGER_RUN].filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
  return executable
    ? {
        installed: true,
        executablePath: executable,
        source: sourceForRuntimePath(executable),
        installHint: "Schrodinger runtime is available.",
        message: "Schrodinger runtime is available",
      }
    : {
        installed: false,
        executablePath: null,
        source: null,
        installHint: "Install Schrodinger or set SCHRODINGER to a suite directory that contains run.",
        message: "Schrodinger runtime was not found",
      };
}

function conformerPythonCandidates(engine: string) {
  const candidates: PythonCommand[] = [];
  const configuredPython = String(engine === "datamol" ? process.env.BURRETE_DATAMOL_PYTHON || "" : process.env.BURRETE_RDKIT_PYTHON || "").trim();
  if (configuredPython) candidates.push({ label: configuredPython, command: configuredPython, args: [] });
  const packageName = engine === "datamol" ? "datamol" : "rdkit";
  const uvx = resolveExecutable("uvx", [
    process.env.HOME ? join(process.env.HOME, ".local/bin/uvx") : "",
    "/opt/homebrew/bin/uvx",
    "/usr/local/bin/uvx",
  ]);
  if (uvx) candidates.push({ label: `${uvx} --from ${packageName} python`, command: uvx, args: ["--from", packageName, "python"] });
  candidates.push(
    { label: "python3", command: "python3", args: [] },
    { label: "python", command: "python", args: [] },
  );
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [candidate.command, ...candidate.args].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conformerPythonStatusCandidates(engine: ConformerPythonEngine) {
  return conformerPythonCandidates(engine).filter((candidate) => !isUvxFromPythonCandidate(candidate));
}

function isUvxFromPythonCandidate(candidate: PythonCommand) {
  return candidate.args[0] === "--from" && candidate.args.at(-1) === "python";
}

function conformerPythonRuntimeSpec(engine: ConformerPythonEngine) {
  return engine === "datamol"
    ? {
        engine,
        packageName: "datamol",
        envName: "BURRETE_DATAMOL_PYTHON",
        label: "Datamol",
        script: "import datamol as dm\nprint(getattr(dm, '__version__', 'unknown'))",
      }
    : {
        engine,
        packageName: "rdkit",
        envName: "BURRETE_RDKIT_PYTHON",
        label: "RDKit",
        script: "import rdkit\nprint(getattr(rdkit, '__version__', 'unknown'))",
      };
}

async function browserDevConformerPythonStatus(engine: ConformerPythonEngine) {
  const spec = conformerPythonRuntimeSpec(engine);
  let lastError: string | null = null;
  for (const python of conformerPythonStatusCandidates(engine)) {
    try {
      const version = await browserDevConformerPythonVersion(python, spec.script);
      return {
        available: true,
        engine: spec.engine,
        packageName: spec.packageName,
        pythonLabel: python.label,
        executablePath: python.command,
        command: [python.command, ...python.args],
        version,
        message: `${spec.label} conformer Python is available`,
        installHint: null,
        lastError: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? `${python.label}: ${error.message}` : `${python.label}: ${String(error)}`;
    }
  }
  return {
    available: false,
    engine: spec.engine,
    packageName: spec.packageName,
    pythonLabel: null,
    executablePath: null,
    command: null,
    version: null,
    message: lastError ? `${spec.label} conformer Python was not found: ${lastError}` : `${spec.label} conformer Python was not found`,
    installHint: `Set ${spec.envName} to a Python executable with ${spec.packageName} installed, or install ${spec.packageName} into python3.`,
    lastError,
  };
}

async function browserDevConformerPythonVersion(python: PythonCommand, script: string) {
  const { stdout } = await execFileAsync(python.command, [...python.args, "-c", script], {
    timeout: CONFORMER_PYTHON_STATUS_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  });
  return String(stdout || "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

function resolveExecutable(name: string, preferredPaths: string[] = []) {
  const candidates = [
    ...preferredPaths,
    process.env.HOME ? join(process.env.HOME, ".pixi/bin", name) : "",
    process.env.HOME ? join(process.env.HOME, ".local/bin", name) : "",
    process.env.HOME ? join(process.env.HOME, ".cargo/bin", name) : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean).map((candidate) => (candidate.endsWith(`/${name}`) || candidate.endsWith(`\\${name}`) ? candidate : join(candidate, name)));
  for (const row of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const candidate = join(row, name);
    candidates.push(candidate);
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function browserDevDescriptorInstallHint() {
  return "Install a uv-managed descriptor runtime from the Descriptors panel, or set BURRETE_DESCRIPTOR_PYTHON to a Python interpreter with RDKit and mordredcommunity.";
}

function browserDevDescriptorPythonCandidates() {
  const candidates = [
    process.env.BURRETE_DESCRIPTOR_PYTHON || "",
    join(BROWSER_DEV_DESCRIPTOR_RUNTIME_DIR, "bin", "python3"),
    join(homedir(), ".local", "share", "burrete", "descriptor-python", "bin", "python3"),
    resolveExecutable("python3") || "",
    resolveExecutable("python") || "",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ].filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = resolve(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return existsSync(candidate);
  });
}

function browserDevMsbuddyPythonCandidates() {
  const candidates = [
    process.env.BURRETE_MSBUDDY_PYTHON || "",
    join(BROWSER_DEV_MSBUDDY_RUNTIME_DIR, "bin", "python3"),
    ...browserDevDescriptorPythonCandidates(),
  ].filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = resolve(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return existsSync(candidate);
  });
}

async function browserDevDescriptorStatus() {
  for (const pythonPath of browserDevDescriptorPythonCandidates()) {
    try {
      const output = await runBrowserDevDescriptorRunner(pythonPath, { mode: "status" }, DESCRIPTOR_STATUS_TIMEOUT_MS);
      const payload = parseBrowserDevDescriptorRunnerOutput(output);
      if (payload.ok === true) {
        return {
          available: true,
          pythonPath,
          mordredVersion: typeof payload.mordredVersion === "string" ? payload.mordredVersion : null,
          rdkitVersion: typeof payload.rdkitVersion === "string" ? payload.rdkitVersion : null,
          installHint: null,
        };
      }
    } catch (_) {
      // Try the next interpreter candidate.
    }
  }
  return {
    available: false,
    pythonPath: browserDevDescriptorPythonCandidates()[0] ?? null,
    mordredVersion: null,
    rdkitVersion: null,
    installHint: browserDevDescriptorInstallHint(),
  };
}

async function installBrowserDevDescriptorRuntime() {
  const uv = resolveExecutable("uv");
  if (!uv) {
    throw new Error("uv is required to install the browser-dev descriptor runtime.");
  }
  await mkdir(BROWSER_DEV_DESCRIPTOR_RUNTIME_DIR, { recursive: true });
  await execFileAsync(uv, ["venv", BROWSER_DEV_DESCRIPTOR_RUNTIME_DIR], {
    timeout: DESCRIPTOR_INSTALL_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  const pythonPath = join(BROWSER_DEV_DESCRIPTOR_RUNTIME_DIR, "bin", "python3");
  await execFileAsync(uv, ["pip", "install", "--python", pythonPath, "rdkit", "mordredcommunity"], {
    timeout: DESCRIPTOR_INSTALL_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const status = await browserDevDescriptorStatus();
  return {
    ok: status.available,
    pythonPath,
    message: status.available ? "Descriptor runtime installed." : browserDevDescriptorInstallHint(),
  };
}

function runBrowserDevDescriptorRunner(pythonPath: string, payload: Record<string, unknown>, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, ["-c", BROWSER_DEV_DESCRIPTOR_RUNNER], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("Descriptor calculation timed out."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code === 0 && stdout) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(new Error(stderr || `Descriptor runner exited with ${signal || code}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseBrowserDevDescriptorRunnerOutput(output: string) {
  const lastLine = output.trim().split(/\r?\n/u).filter(Boolean).at(-1) || "{}";
  const payload = JSON.parse(lastLine) as Record<string, unknown>;
  if (payload.ok === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Descriptor calculation failed.");
  }
  return payload;
}

function runBrowserDevMsbuddyRunner(pythonPath: string, payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, ["-c", BROWSER_DEV_MSBUDDY_RUNNER], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("msbuddy annotation timed out."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0 || !stdout) {
        rejectPromise(new Error(stderr || `msbuddy runner exited with ${signal || code}`));
        return;
      }
      try {
        const payload = parseBrowserDevMsbuddyRunnerOutput(stdout);
        resolvePromise(payload);
      } catch (error) {
        rejectPromise(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseBrowserDevMsbuddyRunnerOutput(output: string) {
  const lastLine = output.trim().split(/\r?\n/u).filter(Boolean).at(-1) || "{}";
  const payload = JSON.parse(lastLine) as Record<string, unknown>;
  if (payload.ok === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "msbuddy annotation failed.");
  }
  return payload;
}

async function browserDevMsbuddyStatus() {
  for (const pythonPath of browserDevMsbuddyPythonCandidates()) {
    try {
      await execFileAsync(pythonPath, ["-c", "import msbuddy"], { timeout: 20_000, maxBuffer: 128 * 1024 });
      return { available: true, pythonPath };
    } catch (_) {
      // Try the next interpreter candidate.
    }
  }
  return { available: false, pythonPath: browserDevMsbuddyPythonCandidates()[0] ?? null };
}

async function annotateBrowserDevSpectrumWithMsbuddy(body: Record<string, unknown>) {
  const input = body.input && typeof body.input === "object" ? body.input as Record<string, unknown> : {};
  const status = await browserDevMsbuddyStatus();
  const fallbackCandidates = buildBrowserDevSpectrumFormulaCandidates(input);
  if (!status.available) {
    return {
      ok: true,
      runtime: "fallback",
      message: "msbuddy Python package is not available in this browser-dev runtime; showing formula candidates from spectrum annotations.",
      candidates: fallbackCandidates,
    };
  }
  const pythonPath = status.pythonPath;
  if (!pythonPath) {
    return {
      ok: true,
      runtime: "fallback",
      message: "msbuddy Python interpreter was not resolved; showing formula candidates from spectrum annotations.",
      candidates: fallbackCandidates,
    };
  }
  try {
    const result = await runBrowserDevMsbuddyRunner(pythonPath, { input }, MSBUDDY_RUN_TIMEOUT_MS);
    const candidates = mergeBrowserDevMsbuddyCandidates(result.candidates, fallbackCandidates);
    return {
      ok: true,
      runtime: "msbuddy",
      message: typeof result.message === "string" ? result.message : "msbuddy annotated this spectrum.",
      precursorMz: result.precursorMz ?? null,
      adduct: result.adduct ?? null,
      candidates: candidates.length > 0 ? candidates : fallbackCandidates,
    };
  } catch (error) {
    return {
      ok: true,
      runtime: "fallback",
      message: `msbuddy runtime failed (${error instanceof Error ? error.message : String(error)}); showing formula candidates from spectrum annotations.`,
      candidates: fallbackCandidates,
    };
  }
}

function mergeBrowserDevMsbuddyCandidates(rawCandidates: unknown, fallbackCandidates: BrowserDevMsbuddyCandidate[]) {
  if (!Array.isArray(rawCandidates)) return [];
  const fallbackByFormula = new Map(fallbackCandidates.map((candidate) => [candidate.formula, candidate]));
  const merged: BrowserDevMsbuddyCandidate[] = [];
  for (const rawCandidate of rawCandidates) {
    if (!rawCandidate || typeof rawCandidate !== "object") continue;
    const row = rawCandidate as Record<string, unknown>;
    const formula = typeof row.formula === "string" ? row.formula.trim() : "";
    if (!formula) continue;
    const fallback = fallbackByFormula.get(formula);
    const rank = Number(row.rank);
    const score = numericAnnotation(row.score);
    const massErrorPpm = numericAnnotation(row.massErrorPpm);
    const explainedPeakIndexes = Array.isArray(row.explainedPeakIndexes)
      ? row.explainedPeakIndexes.filter((index): index is number => Number.isInteger(index))
      : [];
    const fallbackIndexes = fallback?.explainedPeakIndexes ?? [];
    const allIndexes = [...new Set([...explainedPeakIndexes, ...fallbackIndexes])].sort((left, right) => left - right);
    const evidence = typeof row.evidence === "string" && row.evidence.trim()
      ? row.evidence.trim()
      : "msbuddy";
    merged.push({
      rank: Number.isFinite(rank) && rank > 0 ? rank : merged.length + 1,
      formula,
      score: score ?? fallback?.score ?? null,
      massErrorPpm: massErrorPpm ?? fallback?.massErrorPpm ?? null,
      explainedPeakIndexes: allIndexes,
      evidence: fallback && !evidence.includes(fallback.evidence) ? `${evidence}, ${fallback.evidence}` : evidence,
      source: "msbuddy",
    });
  }
  return merged.sort((left, right) => left.rank - right.rank).slice(0, 16);
}

function buildBrowserDevSpectrumFormulaCandidates(input: Record<string, unknown>) {
  const peaks = Array.isArray(input.peaks) ? input.peaks.filter((peak): peak is BrowserDevMsbuddyPeak => Boolean(peak && typeof peak === "object")) : [];
  const formulas = new Map<string, BrowserDevMsbuddyCandidate>();
  const addFormula = (rawFormula: unknown, evidence: string, peakIndex: number | null, score: number | null, massErrorPpm: number | null) => {
    if (typeof rawFormula !== "string") return;
    for (const formula of extractChemicalFormulas(rawFormula)) {
      const current = formulas.get(formula);
      if (current) {
        current.score = Math.max(current.score ?? 0, score ?? 0);
        if (massErrorPpm !== null && (current.massErrorPpm === null || Math.abs(massErrorPpm) < Math.abs(current.massErrorPpm))) {
          current.massErrorPpm = massErrorPpm;
        }
        if (peakIndex !== null && !current.explainedPeakIndexes.includes(peakIndex)) current.explainedPeakIndexes.push(peakIndex);
        if (!current.evidence.includes(evidence)) current.evidence = `${current.evidence}, ${evidence}`;
        continue;
      }
      formulas.set(formula, {
        rank: 0,
        formula,
        score,
        massErrorPpm,
        explainedPeakIndexes: peakIndex === null ? [] : [peakIndex],
        evidence,
        source: "spectrum",
      });
    }
  };
  addFormula(input.candidateFormula, "candidate formula", null, 1, null);
  if (Array.isArray(input.fragmentFormulas)) {
    for (const formula of input.fragmentFormulas) addFormula(formula, "fragment formula", null, 0.8, null);
  }
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/formula|cand_form|parent|precursor/iu.test(key)) addFormula(String(value), key, null, 0.75, null);
  }
  for (const peak of peaks) {
    const peakIndex = Number.isInteger(peak.index) ? peak.index : null;
    const annotations = peak.annotations && typeof peak.annotations === "object" ? peak.annotations : {};
    const massErrorPpm = numericAnnotation(annotations.ppm_diff);
    const intensityScore = Number.isFinite(peak.intensity) ? Math.max(0.1, Math.min(1, peak.intensity / 100)) : 0.25;
    addFormula(peak.annotation, "peak annotation", peakIndex, intensityScore, massErrorPpm);
    addFormula(annotations.frag_base_form, "fragment base formula", peakIndex, intensityScore, massErrorPpm);
    addFormula(annotations.formula, "peak formula", peakIndex, intensityScore, massErrorPpm);
  }
  return [...formulas.values()]
    .sort((left, right) => {
      const scoreDiff = (right.score ?? 0) - (left.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return right.explainedPeakIndexes.length - left.explainedPeakIndexes.length;
    })
    .slice(0, 16)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      explainedPeakIndexes: candidate.explainedPeakIndexes.sort((left, right) => left - right),
    }));
}

function extractChemicalFormulas(value: string) {
  const formulas = new Set<string>();
  for (const match of value.matchAll(/\b(?:[A-Z][a-z]?\d*){2,}\b/gu)) {
    const formula = match[0];
    if (!/[A-Z][a-z]?\d*/u.test(formula)) continue;
    if (/^[A-Z]{2,}$/u.test(formula)) continue;
    formulas.add(formula);
  }
  return formulas;
}

function numericAnnotation(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

async function calculateBrowserDevDescriptors(body: Record<string, unknown>) {
  const source = body.source && typeof body.source === "object" ? body.source as Record<string, unknown> : body;
  const format = typeof source.format === "string" ? source.format : "";
  const text = typeof source.text === "string" ? source.text : "";
  if (![
    "molfile",
    "mol",
    "sdf",
    "sd",
    "smiles",
    "smi",
  ].includes(format.toLowerCase())) {
    throw new Error("Descriptors support MOL, SDF, and SMILES input.");
  }
  if (!text.trim()) throw new Error("Descriptor input is empty.");
  if (Buffer.byteLength(text, "utf8") > DESCRIPTOR_INPUT_LIMIT_BYTES) {
    throw new Error("Descriptor input is too large for browser-dev calculation.");
  }
  const pythonPath = browserDevDescriptorPythonCandidates()[0];
  if (!pythonPath) throw new Error(browserDevDescriptorInstallHint());
  return parseBrowserDevDescriptorRunnerOutput(await runBrowserDevDescriptorRunner(pythonPath, {
    format,
    text,
    label: typeof source.label === "string" ? source.label : null,
    descriptorSet: typeof body.descriptorSet === "string" ? body.descriptorSet : "all-2d",
  }, DESCRIPTOR_RUN_TIMEOUT_MS));
}

async function calculateBrowserDevGridDescriptors(body: Record<string, unknown>) {
  const documentId = typeof body.documentId === "string" && body.documentId ? body.documentId : "browser-dev-grid";
  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : typeof body.path === "string" ? body.path : "";
  const rowIndexes = normalizeBrowserDevDescriptorRowIndexes(body.rowIndexes);
  const startedAtMs = Date.now();
  const allRecords = await browserDevDescriptorGridRecords(sourcePath);
  const selectedRecords = rowIndexes.length > 0
    ? allRecords.filter((record) => rowIndexes.includes(record.index))
    : allRecords;
  const pythonPath = browserDevDescriptorPythonCandidates()[0];
  if (!pythonPath) {
    const failed = browserDevDescriptorJobStatus(
      documentId,
      "failed",
      allRecords.length,
      [],
      startedAtMs,
      browserDevDescriptorInstallHint(),
    );
    browserDevDescriptorJobs.set(documentId, failed);
    return failed;
  }
  let processedRows = 0;
  const rows: BrowserDevGridDescriptorResultRow[] = [];
  browserDevDescriptorJobs.set(documentId, {
    documentId,
    status: "running",
    running: true,
    totalRows: allRecords.length,
    processedRows,
    calculatedRows: 0,
    failedRows: 0,
    message: "Calculating descriptors...",
    startedAtMs,
    finishedAtMs: null,
    summary: null,
    rows: [],
  });
  for (const chunk of chunkArray(selectedRecords, DESCRIPTOR_GRID_BATCH_SIZE)) {
    const current = browserDevDescriptorJobs.get(documentId);
    if (current?.status === "cancelled") return current;
    const result = parseBrowserDevDescriptorRunnerOutput(await runBrowserDevDescriptorRunner(pythonPath, {
      mode: "gridBatch",
      descriptorSet: "all-2d",
      rows: chunk.map((record) => ({
        rowId: record.index,
        index: record.index,
        format: record.molblock ? "sdf" : "smiles",
        text: record.molblock || record.smiles || "",
        sourceLabel: record.name,
      })),
    }, DESCRIPTOR_GRID_BATCH_TIMEOUT_MS));
    const resultRows = Array.isArray(result.rows) ? result.rows as Array<Record<string, unknown>> : [];
    for (const resultRow of resultRows) {
      const index = Number(resultRow.index);
      const descriptorValues = browserDevDescriptorValuesFromResult(resultRow);
      rows.push({
        index,
        rowId: Number.isFinite(Number(resultRow.rowId)) ? Number(resultRow.rowId) : index,
        descriptors: descriptorValues,
      });
    }
    processedRows += chunk.length;
    const running = browserDevDescriptorJobStatus(documentId, "running", allRecords.length, rows, startedAtMs, `Calculated ${processedRows} of ${selectedRecords.length} selected rows.`);
    running.running = true;
    running.processedRows = processedRows;
    running.finishedAtMs = null;
    browserDevDescriptorJobs.set(documentId, running);
  }
  const completed = browserDevDescriptorJobStatus(documentId, "completed", allRecords.length, rows, startedAtMs, `Calculated descriptors for ${rows.length} rows.`);
  browserDevDescriptorJobs.set(documentId, completed);
  return completed;
}

function browserDevDescriptorJobStatus(
  documentId: string,
  status: BrowserDevGridDescriptorJobStatus["status"],
  totalRows: number,
  rows: BrowserDevGridDescriptorResultRow[],
  startedAtMs: number,
  message: string,
): BrowserDevGridDescriptorJobStatus {
  const descriptorIds = Array.from(new Set(rows.flatMap((row) => Object.keys(row.descriptors))));
  const failedRows = rows.filter((row) => Boolean(row.descriptors.error?.errorText)).length;
  return {
    documentId,
    status,
    running: status === "running",
    totalRows,
    processedRows: rows.length,
    calculatedRows: rows.length,
    failedRows,
    message,
    startedAtMs,
    finishedAtMs: status === "running" ? null : Date.now(),
    summary: {
      totalRows,
      calculatedRows: rows.length,
      failedRows,
      descriptorIdCount: descriptorIds.length,
      descriptorIds,
    },
    rows,
  };
}

function browserDevDescriptorValuesFromResult(resultRow: Record<string, unknown>) {
  if (resultRow.ok !== true || !Array.isArray(resultRow.values)) {
    return {
      error: {
        id: "error",
        label: "Error",
        value: null,
        missingKind: "error",
        errorText: typeof resultRow.error === "string" ? resultRow.error : "Descriptor calculation failed.",
      },
    };
  }
  const values: Record<string, BrowserDevDescriptorCellValue> = {};
  for (const value of resultRow.values as Array<Record<string, unknown>>) {
    const id = typeof value.id === "string" ? value.id : "";
    if (!id) continue;
    values[id] = {
      id,
      label: typeof value.label === "string" ? value.label : id,
      value: value.value,
      missingKind: typeof value.missingKind === "string" ? value.missingKind : null,
      errorText: typeof value.errorText === "string" ? value.errorText : null,
    };
  }
  return values;
}

function normalizeBrowserDevDescriptorRowIndexes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => Math.trunc(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 0)))
    .sort((left, right) => left - right);
}

async function browserDevDescriptorGridSummary(documentId: string, path: string) {
  const rows = path ? await browserDevDescriptorGridRecords(path) : [];
  const existing = browserDevDescriptorJobs.get(documentId);
  const descriptorIds = existing?.summary?.descriptorIds ?? [];
  return {
    totalRows: rows.length,
    calculatedRows: existing?.summary?.calculatedRows ?? 0,
    failedRows: existing?.summary?.failedRows ?? 0,
    descriptorIdCount: descriptorIds.length,
    descriptorIds,
  };
}

async function browserDevDescriptorGridRecords(path: string) {
  const filePath = resolve(path);
  if (!filePath || !isDevFileReadAllowed(filePath)) throw new Error("Forbidden descriptor source path.");
  const info = await stat(filePath);
  if (!info.isFile() || info.size > TEXT_FILE_READ_LIMIT) throw new Error("Descriptor source file is too large.");
  const text = await readFile(filePath, "utf8");
  const extension = fileExtension(filePath);
  if (extension === "smi" || extension === "smiles") return parseBrowserDevDescriptorSmiles(text);
  if (extension === "sdf" || extension === "sd") return parseBrowserDevDescriptorSdf(text);
  if (extension === "tsv") return parseBrowserDevDescriptorDelimited(text, "\t");
  if (extension === "csv") return parseBrowserDevDescriptorDelimited(text, ",");
  throw new Error("Descriptor grid supports CSV, TSV, SMILES, and SDF files.");
}

function parseBrowserDevDescriptorSmiles(text: string) {
  const records: BrowserDevGridRecord[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [smiles, ...labelParts] = trimmed.split(/\s+/u);
    if (!descriptorLooksLikeSmiles(smiles)) continue;
    const index = records.length;
    records.push({ index, name: labelParts.join(" ") || `Molecule ${index + 1}`, smiles });
  }
  return records;
}

function parseBrowserDevDescriptorSdf(text: string) {
  return text.split(/\n\$\$\$\$\s*(?:\r?\n|$)/u)
    .map((record, index): BrowserDevGridRecord | null => {
      const molblock = record.trim();
      if (!molblock) return null;
      const name = molblock.split(/\r?\n/u)[0]?.trim() || `Molecule ${index + 1}`;
      return { index, name, molblock: `${molblock}\n$$$$\n` };
    })
    .filter((record): record is BrowserDevGridRecord => Boolean(record));
}

function parseBrowserDevDescriptorDelimited(text: string, separator: "," | "\t") {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = parseBrowserDevDescriptorDelimitedLine(lines[0], separator).map((cell) => cell.trim().toLowerCase());
  const smilesColumn = header.findIndex((cell) => ["smiles", "smile", "canonical_smiles", "canonical smiles"].includes(cell));
  const nameColumn = header.findIndex((cell) => ["name", "id", "title", "molecule", "compound"].includes(cell));
  const dataStart = smilesColumn >= 0 ? 1 : 0;
  return lines.slice(dataStart)
    .map((line, offset): BrowserDevGridRecord | null => {
      const cells = parseBrowserDevDescriptorDelimitedLine(line, separator);
      const rowIndex = offset;
      const smiles = (smilesColumn >= 0 ? cells[smilesColumn] : cells.find(descriptorLooksLikeSmiles) || "").trim();
      if (!descriptorLooksLikeSmiles(smiles)) return null;
      const name = (nameColumn >= 0 ? cells[nameColumn] : "").trim() || `Molecule ${offset + 1}`;
      return { index: rowIndex, name, smiles };
    })
    .filter((record): record is BrowserDevGridRecord => Boolean(record));
}

function parseBrowserDevDescriptorDelimitedLine(line: string, separator: "," | "\t") {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === separator) {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

function descriptorLooksLikeSmiles(value: string | undefined) {
  const text = (value || "").trim();
  if (!text || /\s/u.test(text)) return false;
  return /[A-Za-z0-9@+\-[\]()=#\\/.%]/u.test(text) && !/^https?:/iu.test(text);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function safeTextStructureFileName(title: string, extension: string) {
  const rawName = title.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "ketcher-sketch";
  const dotIndex = rawName.lastIndexOf(".");
  const rawStem = dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
  const stem = rawStem
    .replace(/[^A-Za-z0-9_.-]/gu, "-")
    .replace(/^[-_.]+|[-_.]+$/gu, "")
    || "ketcher-sketch";
  return `${stem}.${extension}`;
}

function generatedConformerTitle(title: string) {
  const fileName = safeTextStructureFileName(title, "sdf");
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : "ketcher-sketch";
  return `${stem}-3d.sdf`;
}

function generatedConformerSetTitle(title: string) {
  const fileName = safeTextStructureFileName(title, "sdf");
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : "ketcher-sketch";
  return `${stem}-3d-conformers.sdf`;
}

function readConformerRequestBody(body: unknown) {
  const source = body && typeof body === "object" && "request" in body
    ? (body as { request?: unknown }).request
    : body;
  if (!source || typeof source !== "object") {
    throw new Error("Missing conformer generation request");
  }
  const request = source as Record<string, unknown>;
  const title = typeof request.title === "string" && request.title.trim() ? request.title : "ketcher-sketch.sdf";
  const extension = String(request.extension || "").trim().replace(/^\./u, "").toLowerCase();
  const text = typeof request.text === "string" ? request.text : "";
  const engine = String(request.engine || "datamol").trim().toLowerCase();
  const mode = String(request.mode || "single").trim().toLowerCase() === "ensemble" ? "ensemble" : "single";
  const candidateCount = boundedNumber(request.candidateCount, 128, 1, 512);
  const rmsdCutoff = boundedNumber(request.rmsdCutoff, 0.75, 0, 5);
  const source3d = request.source3d && typeof request.source3d === "object"
    ? request.source3d as Record<string, unknown>
    : null;
  const source3dRequest = source3d
    ? {
        title: typeof source3d.title === "string" ? source3d.title : "",
        extension: typeof source3d.extension === "string" ? source3d.extension : "",
        text: typeof source3d.text === "string" ? source3d.text : "",
      }
    : null;

  if (!["sdf", "sd", "mol", "smi", "smiles"].includes(extension)) {
    throw new Error("3D conformer generation currently supports MOL, SDF, and SMILES input.");
  }
  if (!["datamol", "rdkit"].includes(engine)) {
    throw new Error("3D conformer generation supports Datamol and RDKit engines.");
  }
  if (!text.trim()) {
    throw new Error("Draw a molecule first");
  }
  if (Buffer.byteLength(text, "utf8") > TEXT_FILE_READ_LIMIT) {
    throw new Error("Structure text is too large");
  }
  if (text.includes("$RXN")) {
    throw new Error("3D conformer generation supports single small molecules, not reactions.");
  }
  if (source3dRequest) {
    const sourceExtension = source3dRequest.extension.trim().replace(/^\./u, "").toLowerCase();
    if (!["sdf", "sd", "mol"].includes(sourceExtension)) {
      throw new Error("3D pose preservation currently supports MOL and SDF sources.");
    }
    if (Buffer.byteLength(source3dRequest.text, "utf8") > TEXT_FILE_READ_LIMIT) {
      throw new Error("Source 3D structure text is too large");
    }
  }

  return { title, extension, text, engine, mode, candidateCount, rmsdCutoff, source3d: source3dRequest };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

async function generate3DConformerForBrowserDev(body: unknown) {
  const request = readConformerRequestBody(body);
  const script = await readFile(RDKIT_CONFORMER_SCRIPT_PATH, "utf8");
  const input = JSON.stringify({
    text: request.text,
    extension: request.extension,
    engine: request.engine,
    mode: request.mode,
    candidateCount: request.candidateCount,
    rmsdCutoff: request.rmsdCutoff,
    source3d: request.source3d,
  });
  const errors: string[] = [];
  for (const python of conformerPythonCandidates(request.engine)) {
    try {
      const outputText = await runPythonWithStdin(python, script, input, conformerGenerationTimeoutMs(request.candidateCount));
      const generated = JSON.parse(outputText) as { text?: unknown; method?: unknown; conformerCount?: unknown };
      if (typeof generated.text !== "string" || !generated.text.trim()) {
        throw new Error("3D conformer generator returned an empty structure.");
      }
      return {
        title: request.mode === "ensemble" ? generatedConformerSetTitle(request.title) : generatedConformerTitle(request.title),
        extension: "sdf",
        text: generated.text,
        method: typeof generated.method === "string" && generated.method.trim() ? generated.method : "ETKDG",
        conformerCount: typeof generated.conformerCount === "number" ? generated.conformerCount : undefined,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${python.label}: ${String(error)}`);
    }
  }
  const engineLabel = request.engine === "datamol" ? "Datamol" : "RDKit";
  const envName = request.engine === "datamol" ? "BURRETE_DATAMOL_PYTHON" : "BURRETE_RDKIT_PYTHON";
  throw new Error(errors.length
    ? `${engineLabel} conformer generation failed: ${errors.join("; ")}`
    : `${engineLabel} Python is required for 3D conformer generation. Set ${envName} to a Python executable with ${request.engine} installed.`);
}

function conformerGenerationTimeoutMs(candidateCount: number) {
  return Math.max(30_000, candidateCount * 1_000);
}

function runPythonWithStdin(python: PythonCommand, script: string, input: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(python.command, [...python.args, "-c", script], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`${python.label}: conformer generator timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(new Error(`${python.label}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code === 0) {
        resolvePromise(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      rejectPromise(new Error(stderr || `${python.label}: conformer generator exited with ${signal || code}`));
    });
    child.stdin.end(input);
  });
}

async function browserDevXtbStatus() {
  const executable = resolveExecutable("xtb");
  if (!executable) {
    return {
      installed: false,
      executablePath: null,
      version: null,
      installer: resolveExecutable("pixi") ? "pixi" : null,
      installHint: "Install xTB with `pixi global install xtb` or from conda-forge. Browser dev can run the pixi installer when pixi is available.",
    };
  }
  let version: string | null = null;
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    const lines = `${stdout || ""}${stderr || ""}`.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    version = lines.find((line) => /\bxtb version\b/iu.test(line)) ?? lines.find((line) => /version/iu.test(line)) ?? null;
  } catch (_) {
    version = null;
  }
  return {
    installed: true,
    executablePath: executable,
    version,
    installer: executable.includes("/.pixi/") ? "pixi" : executable.includes("/.local/bin/") ? "uv-or-local" : "path",
    installHint: "xTB is available. Browser dev will use this executable for local xTB jobs.",
  };
}

async function installBrowserDevXtb() {
  if ((await browserDevXtbStatus()).installed) return browserDevXtbStatus();
  const pixi = resolveExecutable("pixi");
  if (pixi) {
    await execFileAsync(pixi, ["global", "install", "xtb"], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    return browserDevXtbStatus();
  }
  throw new Error("Automatic xTB installation requires pixi. Install pixi and run `pixi global install xtb`, or install xTB from conda-forge and make it available on PATH.");
}

type BrowserDevConformerRunRequest = {
  operation?: unknown;
  jobId?: unknown;
  path?: unknown;
  title?: unknown;
  extension?: unknown;
  inputDataBase64?: unknown;
  outputDirectory?: unknown;
  workDir?: unknown;
  method?: unknown;
  solvent?: unknown;
  charge?: unknown;
  uhf?: unknown;
  threads?: unknown;
  timeoutSeconds?: unknown;
  energyWindowKcalMol?: unknown;
  rmsdThresholdAngstrom?: unknown;
  samplingMode?: unknown;
  prismEnergySort?: unknown;
};

async function browserDevConformerStatus() {
  const crest = resolveExecutable("crest");
  const prism = resolveExecutable("prism_pruner") ?? resolveExecutable("prism-pruner");
  return {
    crest: crest
      ? {
          installed: true,
          executable: crest,
          version: await browserDevExecutableVersion(crest, ["--version"]),
          installHint: "CREST is available. Browser dev will use this executable for conformer generation.",
        }
      : {
          installed: false,
          executable: null,
          version: null,
          installHint: "Install CREST with pixi global install crest, conda-forge, or expose crest on PATH.",
        },
    prism: prism
      ? {
          installed: true,
          executable: prism,
          version: await browserDevExecutableVersion(prism, ["--help"]),
          installHint: "PRISM Pruner is available. Browser dev will use this executable for ensemble pruning.",
        }
      : {
          installed: false,
          executable: null,
          version: null,
          installHint: "Install PRISM Pruner with uv tool install prism_pruner, or expose prism_pruner on PATH.",
        },
  };
}

async function browserDevExecutableVersion(executable: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { timeout: 8_000, maxBuffer: 1024 * 1024 });
    return `${stdout || ""}\n${stderr || ""}`.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
  } catch (_) {
    return null;
  }
}

function browserDevJobKey(kind: "xtb" | "conformer", jobId: unknown) {
  const id = typeof jobId === "string" ? jobId.trim() : "";
  return id ? `${kind}:${id}` : null;
}

function registerBrowserDevJobProcess(jobKey: string | null, child: ChildProcess) {
  if (!jobKey) return;
  runningBrowserDevJobs.set(jobKey, child);
  child.once("close", () => {
    if (runningBrowserDevJobs.get(jobKey) === child) runningBrowserDevJobs.delete(jobKey);
  });
}

function cancelBrowserDevJob(kind: "xtb" | "conformer", jobId: unknown) {
  const jobKey = browserDevJobKey(kind, jobId);
  if (!jobKey) return { ok: false, cancelled: false, message: "Missing job id." };
  cancelledBrowserDevJobs.add(jobKey);
  const child = runningBrowserDevJobs.get(jobKey);
  if (!child) return { ok: true, cancelled: false, message: "No running process was attached to this job." };
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 1500);
  child.once("close", () => clearTimeout(forceKill));
  forceKill.unref();
  return { ok: true, cancelled: true };
}

function browserDevJobWasCancelled(jobKey: string | null) {
  return Boolean(jobKey && cancelledBrowserDevJobs.has(jobKey));
}

function finishBrowserDevJob(jobKey: string | null) {
  if (!jobKey) return;
  runningBrowserDevJobs.delete(jobKey);
  cancelledBrowserDevJobs.delete(jobKey);
}

async function prepareBrowserDevConformerJob(request: BrowserDevConformerRunRequest) {
  const operation = browserDevConformerOperation(request.operation);
  const outputRoot = browserDevConformerOutputRoot(request);
  const workDir = await createBrowserDevConformerRunDir(outputRoot, operation);
  const logPath = join(workDir, `${operation}.log`);
  const reportPath = join(workDir, `${operation}-report.md`);
  await writeBrowserDevConformerRunMetadata(workDir, request, operation, Date.now());
  await writeFile(logPath, "Waiting for job to start...\n", "utf8");
  await writeFile(reportPath, "# Conformer Job\n\nStatus: waiting for job to start.\n", "utf8");
  return { operation, workDir, logPath, reportPath, outputRoot };
}

async function runBrowserDevConformerJob(request: BrowserDevConformerRunRequest) {
  const jobKey = browserDevJobKey("conformer", request.jobId);
  try {
    return await runBrowserDevConformerJobImpl(request, jobKey);
  } finally {
    finishBrowserDevJob(jobKey);
  }
}

async function runBrowserDevConformerJobImpl(request: BrowserDevConformerRunRequest, jobKey: string | null) {
  const operation = browserDevConformerOperation(request.operation);
  const executable = operation === "crest-generate"
    ? resolveExecutable("crest")
    : resolveExecutable("prism_pruner") ?? resolveExecutable("prism-pruner");
  if (!executable) {
    throw new Error(operation === "crest-generate"
      ? "CREST executable was not found. Install it with pixi global install crest or expose crest on PATH."
      : "PRISM Pruner executable was not found. Install it with uv tool install prism_pruner or expose prism_pruner on PATH.");
  }
  const startedAt = Date.now();
  const outputRoot = browserDevConformerOutputRoot(request);
  const requestedWorkDir = typeof request.workDir === "string" && request.workDir.trim() ? resolve(request.workDir) : "";
  const workDir = requestedWorkDir && isPathAtOrUnder(requestedWorkDir, outputRoot)
    ? requestedWorkDir
    : await createBrowserDevConformerRunDir(outputRoot, operation);
  await mkdir(workDir, { recursive: true });
  await writeBrowserDevConformerRunMetadata(workDir, request, operation, startedAt);
  const logPath = join(workDir, `${operation}.log`);
  const reportPath = join(workDir, `${operation}-report.md`);
  const timeout = Math.max(5, Math.min(86_400, Number(request.timeoutSeconds) || (operation === "crest-generate" ? 3600 : 300))) * 1000;
  const copiedInput = await browserDevConformerInputPath(request, workDir);
  const inputBytes = await readFile(copiedInput.inputPath);
  const inputText = inputBytes.toString("utf8");
  assertBrowserDevDirectChemistryInput(inputText, copiedInput.inputExtension, operation === "crest-generate" ? "CREST" : "PRISM");
  let preparedInput = operation === "crest-generate"
    ? await prepareBrowserDevCrestInput(copiedInput.inputPath, inputText, workDir, jobKey)
    : { path: copiedInput.inputPath, text: inputText, source: "input" };
  let runRequest = request;
  let args = operation === "crest-generate"
    ? browserDevCrestArgs(runRequest, preparedInput.path, inputText, preparedInput.text, preparedInput.source)
    : browserDevPrismArgs(runRequest, copiedInput.inputPath);
  let exitCode = 1;
  let log = "";
  const recoveries: string[] = [];
  try {
    const result = await runBrowserDevLoggedExecutable(executable, args, workDir, logPath, timeout, jobKey);
    exitCode = result.status;
    log = result.log;
    if (operation === "crest-generate" && shouldRetryCrestWithXtbPreopt(request, exitCode, log)) {
      const xtb = resolveExecutable("xtb");
      if (xtb) {
        const recovery = "xTB pre-optimization after CREST initial geometry optimization failure";
        const xtbLogPath = join(workDir, `${operation}-xtb-preopt.log`);
        const preoptCharge = effectiveConformerCharge(request, preparedInput.text, preparedInput.source);
        const xtbArgs = browserDevXtbPreoptArgs(request, preparedInput.path, preparedInput.text, preparedInput.source);
        const xtbResult = await runBrowserDevLoggedExecutable(xtb, xtbArgs, workDir, xtbLogPath, timeout, jobKey);
        log = `${log}\n\n--- ${recovery} ---\n\n${xtbResult.log}`;
        const xtbOptPath = await browserDevXtbPreoptResultPath(workDir);
        if (xtbResult.status === 0 && xtbOptPath) {
          const xtbOptText = await readFile(xtbOptPath, "utf8");
          preparedInput = { path: xtbOptPath, text: xtbOptText, source: "xtb:preopt" };
          const retryLogPath = join(workDir, `${operation}-xtb-preopt-retry.log`);
          runRequest = { ...request, charge: preoptCharge ?? request.charge };
          const retryArgs = browserDevCrestArgs(runRequest, preparedInput.path, inputText, preparedInput.text, preparedInput.source);
          const retry = await runBrowserDevLoggedExecutable(executable, retryArgs, workDir, retryLogPath, timeout, jobKey);
          recoveries.push(recovery);
          log = `${log}\n\n--- CREST retry after xTB pre-optimization ---\n\n${retry.log}`;
          await writeFile(logPath, log || "(no output)\n", "utf8");
          exitCode = retry.status;
          args = retryArgs;
          if (shouldRetryCrestWithoutSolventAfterPreopt(runRequest, exitCode, retry.log)) {
            const solventRecovery = "CREST retry without implicit solvent after xTB pre-optimization";
            const solventRetryLogPath = join(workDir, `${operation}-xtb-preopt-vacuum-retry.log`);
            const solventRetryRequest = { ...runRequest, solvent: "none" };
            const solventRetryArgs = browserDevCrestArgs(solventRetryRequest, preparedInput.path, inputText, preparedInput.text, preparedInput.source);
            const solventRetry = await runBrowserDevLoggedExecutable(executable, solventRetryArgs, workDir, solventRetryLogPath, timeout, jobKey);
            recoveries.push(solventRecovery);
            log = `${log}\n\n--- ${solventRecovery} ---\n\n${solventRetry.log}`;
            await writeFile(logPath, log || "(no output)\n", "utf8");
            exitCode = solventRetry.status;
            args = solventRetryArgs;
            runRequest = solventRetryRequest;
          }
        } else {
          await writeFile(logPath, log || "(no output)\n", "utf8");
        }
      }
    }
    if (operation === "crest-generate" && shouldRetryCrestWithGfnff(request, exitCode, log)) {
      const recovery = "GFN-FF retry after initial geometry optimization failure";
      const retryLogPath = join(workDir, `${operation}-gfnff-retry.log`);
      const retryArgs = browserDevCrestArgs(
        { ...runRequest, method: "gfnff" },
        preparedInput.path,
        inputText,
        preparedInput.text,
        preparedInput.source,
      );
      const retry = await runBrowserDevLoggedExecutable(executable, retryArgs, workDir, retryLogPath, timeout, jobKey);
      recoveries.push(recovery);
      log = `${log}\n\n--- ${recovery} ---\n\n${retry.log}`;
      await writeFile(logPath, log || "(no output)\n", "utf8");
      exitCode = retry.status;
      args = retryArgs;
    }
  } catch (error) {
    exitCode = 1;
    log = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeFile(logPath, `${log}\n`, "utf8");
  }
  const cancelled = browserDevJobWasCancelled(jobKey);
  if (cancelled) {
    exitCode = 130;
    log = log || "Conformer job cancelled.\n";
    await writeFile(logPath, log, "utf8");
  }
  const artifacts = cancelled ? [] : await collectBrowserDevConformerArtifacts(workDir);
  const recoveredPrimaryOpenPath = exitCode !== 0 && exitCode !== 124
    ? primaryBrowserDevConformerOpenPath(operation, artifacts, true)
    : null;
  const primaryOpenPath = primaryBrowserDevConformerOpenPath(operation, artifacts, exitCode === 0) ?? recoveredPrimaryOpenPath;
  const ok = !cancelled && (exitCode === 0 || recoveredPrimaryOpenPath !== null);
  const result = {
    ok,
    operation,
    title: copiedInput.inputTitle,
    inputPath: copiedInput.sourcePath,
    workDir,
    logPath,
    reportPath,
    exitCode,
    errorSummary: cancelled
      ? "Conformer job cancelled."
      : recoveredPrimaryOpenPath
      ? browserDevConformerRecoverySummary(operation, recoveredPrimaryOpenPath, exitCode)
      : browserDevConformerErrorSummary(operation, exitCode, log, preparedInput.source, inputText),
    elapsedMs: Date.now() - startedAt,
    command: [executable, ...args],
    preparation: { path: preparedInput.path, source: preparedInput.source },
    recovery: recoveries.length > 0 ? recoveries.join("; ") : null,
    artifacts,
    primaryOpenPath,
  };
  await writeBrowserDevConformerReport(reportPath, result, log);
  return result;
}

function browserDevConformerOperation(value: unknown): "crest-generate" | "prism-prune" {
  if (value === "crest-generate" || value === "prism-prune") return value;
  throw new Error(`Unsupported conformer operation: ${String(value || "missing")}`);
}

function browserDevConformerOutputRoot(request: BrowserDevConformerRunRequest) {
  const requested = typeof request.outputDirectory === "string" && request.outputDirectory.trim()
    ? resolve(request.outputDirectory)
    : "";
  if (requested && isDevFileReadAllowed(requested)) return requested;
  const inputPath = typeof request.path === "string" && request.path.trim() ? resolve(request.path) : "";
  if (inputPath && isDevFileReadAllowed(inputPath)) return dirname(inputPath);
  return BROWSER_DEV_CONFORMER_JOBS_ROOT;
}

function isPathAtOrUnder(path: string, root: string) {
  const relation = relative(root, path);
  return relation === "" || (relation && !relation.startsWith("..") && !relation.startsWith("/"));
}

async function createBrowserDevConformerRunDir(parentDir: string, operation: "crest-generate" | "prism-prune") {
  const prefix = operation === "prism-prune" ? "prism_run" : "crest_run";
  await mkdir(parentDir, { recursive: true });
  for (let index = 1; index <= 9999; index += 1) {
    const workDir = join(parentDir, `${prefix}_${index}`);
    try {
      await mkdir(workDir);
      return workDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`Could not create a ${prefix}_N directory in ${parentDir}.`);
}

async function writeBrowserDevConformerRunMetadata(workDir: string, request: BrowserDevConformerRunRequest, operation: "crest-generate" | "prism-prune", startedAt: number) {
  const operationLabel = operation === "prism-prune" ? "PRISM Prune" : "CREST Generate";
  const inputLabel = typeof request.title === "string" && request.title.trim()
    ? request.title.trim()
    : pathBasename(typeof request.path === "string" ? request.path : operation);
  await writeFile(join(workDir, CONFORMER_RUN_METADATA_FILE), `${JSON.stringify({
    kind: "conformer-run",
    operation,
    operationLabel,
    inputLabel,
    title: `${operationLabel} · ${inputLabel}`,
    createdAt: new Date(startedAt).toISOString(),
  }, null, 2)}\n`, "utf8");
}

async function browserDevConformerInputPath(request: BrowserDevConformerRunRequest, workDir: string) {
  const sourcePath = typeof request.path === "string" && request.path.trim() ? resolve(request.path) : "";
  const title = typeof request.title === "string" && request.title.trim()
    ? request.title.trim()
    : (sourcePath ? pathBasename(sourcePath) : "input");
  const extension = browserDevConformerInputExtension(request);
  const inputPath = join(workDir, `input.${extension}`);
  if (typeof request.inputDataBase64 === "string" && request.inputDataBase64.trim()) {
    const bytes = Buffer.from(request.inputDataBase64, "base64");
    if (bytes.length === 0 || bytes.length > DEV_FILE_SIZE_LIMIT) throw new Error("Inline conformer input is empty or too large.");
    await writeFile(inputPath, bytes);
    return { inputPath, sourcePath: inputPath, inputTitle: title, inputExtension: extension };
  }
  if (!sourcePath || !isDevFileReadAllowed(sourcePath)) throw new Error("Input path is not available to browser dev.");
  const bytes = await readFile(sourcePath);
  await writeFile(inputPath, bytes);
  return { inputPath, sourcePath, inputTitle: title, inputExtension: extension };
}

function browserDevConformerInputExtension(request: BrowserDevConformerRunRequest) {
  const raw = typeof request.extension === "string" && request.extension.trim()
    ? request.extension
    : typeof request.path === "string" ? fileExtension(request.path) : "xyz";
  const extension = raw.toLowerCase().replace(/^\./u, "");
  return ["xyz", "sdf", "sd", "mol", "mol2", "pdb", "pdbqt", "ent", "cif", "mcif", "mmcif"].includes(extension) ? extension : "xyz";
}

async function prepareBrowserDevCrestInput(inputPath: string, inputText: string, workDir: string, jobKey: string | null) {
  const rawPdbLigandSelection = isRawPdbLigandSelection(inputText);
  if (!rawPdbLigandSelection && shouldUsePreparedSdfDirectly(inputPath, inputText)) {
    const datamolPrepared = await prepareBrowserDevCrestInputWithDatamol(inputPath, workDir, "input:prepared_sdf", jobKey);
    if (datamolPrepared) return datamolPrepared;
    return { path: inputPath, text: inputText, source: "input:prepared_sdf" };
  }
  const ligandCode = rawPdbLigandSelection ? rawPdbLigandCode(inputText) : null;
  if (ligandCode) {
    const ccdSdf = await fetchBrowserDevCcdIdealSdf(ligandCode);
    if (ccdSdf) {
      const preparedPath = join(workDir, `prepared_${ligandCode.toLowerCase()}_ccd.sdf`);
      await writeFile(preparedPath, ccdSdf.text, "utf8");
      const datamolPrepared = await prepareBrowserDevCrestInputWithDatamol(preparedPath, workDir, ccdSdf.source, jobKey);
      if (datamolPrepared) return datamolPrepared;
      return { path: preparedPath, text: ccdSdf.text, source: ccdSdf.source };
    }
  }
  if (rawPdbLigandSelection || shouldPrepareBrowserDevCrestInputWithOpenBabel(inputPath)) {
    const obabel = resolveExecutable("obabel");
    if (!obabel) return { path: inputPath, text: inputText, source: "input" };
    const preparedPath = join(workDir, "prepared_obabel.sdf");
    const prepLogPath = join(workDir, "ligand-prep.log");
    const prepArgs = [inputPath, "-O", preparedPath, "-h"];
    if (shouldGenerateBrowserDevCrestInput3d(inputText)) prepArgs.push("--gen3d");
    const { status } = await runBrowserDevLoggedExecutable(obabel, prepArgs, workDir, prepLogPath, 120_000, jobKey);
    if (status === 0 && existsSync(preparedPath)) {
      const preparedText = await readFile(preparedPath, "utf8");
      const source = prepArgs.includes("--gen3d") ? "obabel:gen3d_add_h" : "obabel:add_h";
      const datamolPrepared = await prepareBrowserDevCrestInputWithDatamol(preparedPath, workDir, source, jobKey);
      if (datamolPrepared) return datamolPrepared;
      return { path: preparedPath, text: preparedText, source };
    }
  }
  const xTbPreparedPath = await prepareBrowserDevXtbInputWithHydrogens(inputPath, workDir, "input-with-h");
  if (xTbPreparedPath !== inputPath) {
    const preparedText = await readFile(xTbPreparedPath, "utf8");
    const datamolPrepared = await prepareBrowserDevCrestInputWithDatamol(xTbPreparedPath, workDir, "obabel:add_h", jobKey);
    if (datamolPrepared) return datamolPrepared;
    return { path: xTbPreparedPath, text: preparedText, source: "obabel:add_h" };
  }
  const datamolPrepared = await prepareBrowserDevCrestInputWithDatamol(inputPath, workDir, "input", jobKey);
  if (datamolPrepared) return datamolPrepared;
  return { path: inputPath, text: inputText, source: "input" };
}

function shouldUsePreparedSdfDirectly(inputPath: string, inputText: string) {
  const extension = fileExtension(inputPath);
  if (extension !== "sdf" && extension !== "sd") return false;
  if (!isValidSdfText(inputText)) return false;
  const stats = sdfAtomBlockStats(inputText);
  return stats.atomCount > 0 && stats.hasExplicitHydrogen && stats.hasNonPlanar3dCoordinates;
}

function shouldPrepareBrowserDevCrestInputWithOpenBabel(inputPath: string) {
  const extension = fileExtension(inputPath);
  return ["sdf", "sd", "mol", "mol2", "pdb", "pdbqt", "ent", "cif", "mcif", "mmcif"].includes(extension);
}

function shouldGenerateBrowserDevCrestInput3d(inputText: string) {
  const stats = sdfAtomBlockStats(inputText);
  if (stats.atomCount > 0) return !stats.hasNonPlanar3dCoordinates;
  return false;
}

async function prepareBrowserDevCrestInputWithDatamol(inputPath: string, workDir: string, source: string, jobKey: string | null) {
  if (!shouldPrepareBrowserDevCrestInputWithDatamol(inputPath)) return null;
  const preparedPath = join(workDir, "prepared_datamol.sdf");
  const prepLogPath = join(workDir, "datamol-prep.log");
  const commands = await browserDevDatamolPrepCommands(inputPath, preparedPath);
  for (const command of commands) {
    const { status } = await runBrowserDevLoggedExecutable(command.executable, command.args, workDir, prepLogPath, 300_000, jobKey);
    if (status !== 0 || !existsSync(preparedPath)) continue;
    const preparedText = await readFile(preparedPath, "utf8");
    if (!isValidSdfText(preparedText)) continue;
    return { path: preparedPath, text: preparedText, source: `${source}:datamol_mmff` };
  }
  return null;
}

function shouldPrepareBrowserDevCrestInputWithDatamol(inputPath: string) {
  const extension = fileExtension(inputPath);
  return ["sdf", "sd", "mol", "mol2", "pdb", "pdbqt", "ent"].includes(extension);
}

const browserDevDatamolPythonCache = new Map<string, boolean>();

async function browserDevDatamolPrepCommands(inputPath: string, outputPath: string) {
  const script = browserDevDatamolPrepScript();
  const commands: Array<{ executable: string; args: string[] }> = [];
  const uv = resolveExecutable("uv");
  if (uv && existsSync(BROWSER_DEV_CHEMISTRY_PREP_PROJECT)) {
    commands.push({ executable: uv, args: ["run", "--project", BROWSER_DEV_CHEMISTRY_PREP_PROJECT, "python", "-c", script, inputPath, outputPath] });
  } else if (uv) {
    commands.push({ executable: uv, args: ["run", "--with", "datamol", "--with", "rdkit", "python", "-c", script, inputPath, outputPath] });
  }
  const python = resolveExecutable("python3") ?? resolveExecutable("python");
  if (python && await browserDevPythonHasDatamol(python)) {
    commands.push({ executable: python, args: ["-c", script, inputPath, outputPath] });
  }
  return commands;
}

async function browserDevPythonHasDatamol(python: string) {
  const cached = browserDevDatamolPythonCache.get(python);
  if (cached !== undefined) return cached;
  try {
    await execFileAsync(python, ["-c", "import datamol, rdkit"], { timeout: 8_000, maxBuffer: 1024 * 1024 });
    browserDevDatamolPythonCache.set(python, true);
    return true;
  } catch {
    browserDevDatamolPythonCache.set(python, false);
    return false;
  }
}

function browserDevDatamolPrepScript() {
  return String.raw`
import sys
import datamol as dm
from rdkit import Chem
from rdkit.Chem import AllChem

dm.disable_rdkit_log()
input_path, output_path = sys.argv[1], sys.argv[2]
lower = input_path.lower()

def first_sdf_mol(path):
    supplier = Chem.SDMolSupplier(path, removeHs=False, sanitize=True)
    for mol in supplier:
        if mol is not None:
            return mol
    return None

if lower.endswith((".sdf", ".sd")):
    mols = dm.read_sdf(input_path, as_df=False)
    mol = next((item for item in mols if item is not None), None) if mols else None
    if mol is None:
        mol = first_sdf_mol(input_path)
elif lower.endswith(".mol2"):
    mol = Chem.MolFromMol2File(input_path, removeHs=False, sanitize=True)
elif lower.endswith(".mol"):
    mol = Chem.MolFromMolFile(input_path, removeHs=False, sanitize=True)
elif lower.endswith((".pdb", ".pdbqt", ".ent")):
    mol = Chem.MolFromPDBFile(input_path, removeHs=False, sanitize=True)
else:
    mol = None

if mol is None:
    raise SystemExit("Datamol/RDKit could not parse input molecule")

try:
    mol = dm.fix_mol(mol)
except Exception as error:
    print(f"datamol fix_mol skipped: {error}", file=sys.stderr)

try:
    mol = dm.sanitize_mol(mol, sanifix=True, charge_neutral=False)
except TypeError:
    mol = dm.sanitize_mol(mol)
except Exception as error:
    print(f"datamol sanitize_mol skipped: {error}", file=sys.stderr)

try:
    mol = dm.standardize_mol(mol, disconnect_metals=False, normalize=True, reionize=True, uncharge=False, stereo=True)
except TypeError:
    mol = dm.standardize_mol(mol)
except Exception as error:
    print(f"datamol standardize_mol skipped: {error}", file=sys.stderr)

mol = Chem.AddHs(mol, addCoords=True)
needs_embed = mol.GetNumConformers() == 0
if not needs_embed:
    conf = mol.GetConformer()
    z_values = [abs(conf.GetAtomPosition(i).z) for i in range(mol.GetNumAtoms())]
    needs_embed = max(z_values, default=0.0) < 1e-4

if needs_embed:
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xB00
    params.useRandomCoords = True
    status = AllChem.EmbedMolecule(mol, params)
    if status != 0:
        status = AllChem.EmbedMolecule(mol, useRandomCoords=True, randomSeed=0xB00)
    if status != 0:
        raise SystemExit("RDKit ETKDG embedding failed")

optimized = False
props = AllChem.MMFFGetMoleculeProperties(mol, mmffVariant="MMFF94s")
if props is not None:
    ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=0)
    if ff is not None:
        ff.Minimize(maxIts=1000)
        optimized = True

if not optimized:
    ff = AllChem.UFFGetMoleculeForceField(mol, confId=0)
    if ff is not None:
        ff.Minimize(maxIts=1000)
        optimized = True

if not optimized:
    raise SystemExit("RDKit could not initialize MMFF94s or UFF")

try:
    dm.to_sdf([mol], output_path)
except Exception:
    writer = Chem.SDWriter(output_path)
    writer.write(mol)
    writer.close()
`;
}

function sdfAtomBlockStats(inputText: string) {
  const lines = inputText.split(/\r?\n/u);
  const countsIndex = lines.findIndex((line) => /V2000/u.test(line) && /^\s*\d+\s+\d+/u.test(line));
  if (countsIndex < 0) return { atomCount: 0, hasExplicitHydrogen: false, hasNonPlanar3dCoordinates: false };
  const atomCount = Number.parseInt(lines[countsIndex].trim().split(/\s+/u)[0], 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return { atomCount: 0, hasExplicitHydrogen: false, hasNonPlanar3dCoordinates: false };
  const atomLines = lines.slice(countsIndex + 1, countsIndex + 1 + atomCount);
  let parsedAtoms = 0;
  let maxAbsZ = 0;
  let hasExplicitHydrogen = false;
  for (const line of atomLines) {
    const match = line.match(/^\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([A-Za-z][a-z]?|\*)\b/u);
    if (!match) continue;
    parsedAtoms += 1;
    maxAbsZ = Math.max(maxAbsZ, Math.abs(Number.parseFloat(match[3])));
    if (match[4].toUpperCase() === "H") hasExplicitHydrogen = true;
  }
  return {
    atomCount: parsedAtoms === atomCount ? atomCount : 0,
    hasExplicitHydrogen,
    hasNonPlanar3dCoordinates: parsedAtoms === atomCount && maxAbsZ >= 1e-4,
  };
}

function rawPdbLigandCode(inputText: string) {
  const firstLine = inputText.split(/\r?\n/u)[0]?.trim() ?? "";
  const match = firstLine.match(/^([A-Za-z0-9]{2,4})(?:\s|$)/u);
  return match ? match[1].toUpperCase() : null;
}

async function fetchBrowserDevCcdIdealSdf(ligandCode: string) {
  const cachePath = join(BROWSER_DEV_CCD_CACHE_ROOT, `${ligandCode}_ideal.sdf`);
  const cached = await readCachedBrowserDevCcdIdealSdf(cachePath);
  if (cached) return { text: cached, source: `ccd-cache:${ligandCode}` };
  try {
    const response = await fetch(`https://files.rcsb.org/ligands/download/${encodeURIComponent(ligandCode)}_ideal.sdf`);
    if (!response.ok) return null;
    const text = await response.text();
    if (!isValidSdfText(text)) return null;
    await mkdir(BROWSER_DEV_CCD_CACHE_ROOT, { recursive: true });
    await writeFile(cachePath, text, "utf8");
    return { text, source: `ccd:${ligandCode}` };
  } catch {
    return null;
  }
}

async function readCachedBrowserDevCcdIdealSdf(cachePath: string) {
  try {
    const text = await readFile(cachePath, "utf8");
    return isValidSdfText(text) ? text : null;
  } catch {
    return null;
  }
}

function isValidSdfText(text: string) {
  return text.includes("$$") && /M\s+END/u.test(text);
}

function browserDevCrestArgs(
  request: BrowserDevConformerRunRequest,
  inputPath: string,
  inputText: string,
  preparedInputText: string,
  preparedInputSource: string,
) {
  const method = typeof request.method === "string" ? request.method : "gfn2";
  const rawPdbLigandSelection = isRawPdbLigandSelection(inputText);
  const args = [inputPath];
  if (method === "gfnff") args.push("--gfnff");
  else if (method === "gfn1") args.push("--gfn1");
  else if (method === "gfn0") args.push("--gfn0");
  else args.push("--gfn2");
  if (method === "gfnff" && rawPdbLigandSelection) args.push("-nocbonds");
  const samplingMode = typeof request.samplingMode === "string" ? request.samplingMode : "auto";
  if (samplingMode === "quick") args.push("-quick");
  else if (samplingMode === "squick") args.push("-squick");
  else if (samplingMode === "mquick") args.push("-mquick");
  const solvent = typeof request.solvent === "string" ? request.solvent : "none";
  if (solvent && solvent !== "none") args.push("--gbsa", solvent);
  const charge = effectiveConformerCharge(request, preparedInputText, preparedInputSource);
  if (charge !== null && charge !== 0) args.push("--chrg", String(charge));
  const uhf = readOptionalInteger(request.uhf);
  if (uhf !== null && uhf > 0) args.push("--uhf", String(uhf));
  const threads = readOptionalInteger(request.threads);
  if (threads !== null && threads > 0) args.push("-T", String(Math.min(threads, 16)));
  const energyWindow = readOptionalNumber(request.energyWindowKcalMol);
  if (energyWindow !== null) args.push("--ewin", String(energyWindow));
  const rmsdThreshold = readOptionalNumber(request.rmsdThresholdAngstrom);
  if (rmsdThreshold !== null) args.push("--rthr", String(rmsdThreshold));
  return args;
}

function browserDevXtbPreoptArgs(
  request: BrowserDevConformerRunRequest,
  inputPath: string,
  preparedInputText: string,
  preparedInputSource: string,
) {
  const method = typeof request.method === "string" ? request.method : "gfn2";
  const args = [inputPath];
  if (method === "gfn1") args.push("--gfn", "1");
  else if (method === "gfn0") args.push("--gfn", "0");
  else args.push("--gfn", "2");
  args.push("--opt");
  const charge = effectiveConformerCharge(request, preparedInputText, preparedInputSource);
  if (charge !== null) args.push("--chrg", String(charge));
  const uhf = readOptionalInteger(request.uhf);
  if (uhf !== null && uhf > 0) args.push("--uhf", String(uhf));
  const threads = readOptionalInteger(request.threads);
  if (threads !== null && threads > 0) args.push("--parallel", String(Math.min(threads, 16)));
  return args;
}

async function browserDevXtbPreoptResultPath(workDir: string) {
  const entries = await readdir(workDir, { withFileTypes: true });
  const preferred = ["xtbopt.sdf", "xtbopt.xyz", "xtbopt.mol", "xtbopt.pdb"];
  for (const name of preferred) {
    const entry = entries.find((item) => item.isFile() && item.name === name);
    if (entry) return join(workDir, name);
  }
  const fallback = entries.find((entry) => entry.isFile() && /^xtbopt\./iu.test(entry.name));
  return fallback ? join(workDir, fallback.name) : null;
}

function effectiveConformerCharge(
  request: BrowserDevConformerRunRequest,
  preparedInputText: string,
  preparedInputSource: string,
) {
  const requestedCharge = readOptionalInteger(request.charge);
  const inferredCharge = inferSdfFormalCharge(preparedInputText);
  if ((preparedInputSource.startsWith("ccd") || preparedInputSource === "xtb:preopt") && inferredCharge !== null) return inferredCharge;
  return requestedCharge !== null && (requestedCharge !== 0 || inferredCharge === null)
    ? requestedCharge
    : inferredCharge;
}

function shouldRetryCrestWithXtbPreopt(
  request: BrowserDevConformerRunRequest,
  status: number,
  log: string,
) {
  if (request.method === "gfnff") return false;
  return shouldRetryCrestAfterInitialOptimizationFailure(status, log);
}

function shouldRetryCrestWithGfnff(
  request: BrowserDevConformerRunRequest,
  status: number,
  log: string,
) {
  if (request.method === "gfnff") return false;
  return shouldRetryCrestAfterInitialOptimizationFailure(status, log);
}

function shouldRetryCrestWithoutSolventAfterPreopt(
  request: BrowserDevConformerRunRequest,
  status: number,
  log: string,
) {
  const solvent = typeof request.solvent === "string" ? request.solvent : "none";
  return status !== 0 &&
    status !== 124 &&
    status !== 130 &&
    solvent !== "none" &&
    /Initial geometry optimization failed/iu.test(log);
}

function shouldRetryCrestAfterInitialOptimizationFailure(
  status: number,
  log: string,
) {
  if (status === 0 || status === 124 || status === 130) return false;
  return /Initial geometry optimization failed/iu.test(log);
}

function inferSdfFormalCharge(inputText: string) {
  const chargeLinePattern = /^M\s+CHG\s+\d+\s+(.+)$/gmu;
  let charge = 0;
  let foundChargeLine = false;
  for (const match of inputText.matchAll(chargeLinePattern)) {
    foundChargeLine = true;
    const values = match[1].trim().split(/\s+/u);
    for (let index = 1; index < values.length; index += 2) {
      const atomCharge = Number.parseInt(values[index], 10);
      if (Number.isFinite(atomCharge)) charge += atomCharge;
    }
  }
  if (foundChargeLine) return charge;
  const propertyMatch = inputText.match(/^>\s*<(?:formal_?charge|charge)>\s*\r?\n\s*([+-]?\d+)\s*$/imu);
  if (!propertyMatch) return null;
  const propertyCharge = Number.parseInt(propertyMatch[1], 10);
  return Number.isFinite(propertyCharge) ? propertyCharge : null;
}

function isRawPdbLigandSelection(inputText: string) {
  return /\bPDB ligand selection\b/u.test(inputText);
}

function browserDevPrismArgs(request: BrowserDevConformerRunRequest, inputPath: string) {
  const args: string[] = [];
  if (request.prismEnergySort !== false) args.push("-e");
  args.push(inputPath);
  return args;
}

async function runBrowserDevLoggedExecutable(executable: string, args: string[], cwd: string, logPath: string, timeout: number, jobKey: string | null = null) {
  if (browserDevJobWasCancelled(jobKey)) {
    const log = "Conformer job cancelled before the process started.\n";
    await writeFile(logPath, log, "utf8");
    return { status: 130, log };
  }
  await writeFile(logPath, `$ ${[executable, ...args].join(" ")}\n\n`, "utf8");
  return new Promise<{ status: number; log: string }>((resolveRun) => {
    const child = execFile(executable, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024 }, () => {});
    registerBrowserDevJobProcess(jobKey, child);
    const stream = createWriteStream(logPath, { flags: "a" });
    const chunks: string[] = [];
    const append = (chunk: Buffer | string) => {
      const text = chunk.toString();
      chunks.push(text);
      stream.write(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => append(String(error)));
    child.on("close", (code, signal) => {
      stream.end(() => {
        const status = browserDevJobWasCancelled(jobKey)
          ? 130
          : typeof code === "number" ? code : (signal ? 124 : 1);
        resolveRun({ status, log: chunks.join("") });
      });
    });
  });
}

function execBrowserDevJobFile(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number },
  jobKey: string | null,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    if (browserDevJobWasCancelled(jobKey)) {
      rejectRun(Object.assign(new Error("Job cancelled before the process started."), {
        code: 130,
        stdout: "",
        stderr: "",
      }));
      return;
    }
    const child = execFile(executable, args, options, (error, stdout, stderr) => {
      if (jobKey && runningBrowserDevJobs.get(jobKey) === child) runningBrowserDevJobs.delete(jobKey);
      const normalized = { stdout: stdout || "", stderr: stderr || "" };
      if (error) {
        Object.assign(error, normalized);
        rejectRun(error);
        return;
      }
      resolveRun(normalized);
    });
    registerBrowserDevJobProcess(jobKey, child);
  });
}

async function collectBrowserDevConformerArtifacts(workDir: string) {
  const entries = await readdir(workDir, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === CONFORMER_RUN_METADATA_FILE) continue;
    const path = join(workDir, entry.name);
    const info = await stat(path);
    artifacts.push({
      title: entry.name,
      path,
      extension: fileExtension(entry.name),
      byteCount: info.size,
      kind: browserDevConformerArtifactKind(entry.name),
      validEnsemble: await validBrowserDevConformerArtifact(entry.name, path, info.size),
    });
  }
  return artifacts.sort((left, right) => left.title.localeCompare(right.title));
}

async function validBrowserDevConformerArtifact(name: string, path: string, byteCount: number) {
  if (byteCount <= 0 || name.startsWith(".")) return false;
  const lower = name.toLowerCase();
  if (!isBrowserDevConformerResultArtifact(lower)) return false;
  if (!["xyz", "sdf", "sd", "mol"].includes(fileExtension(lower))) return false;
  if (lower.endsWith(".xyz")) return validXyzEnsembleText(await readFile(path, "utf8"));
  if (lower.endsWith(".sdf") || lower.endsWith(".sd")) return validSdfEnsembleText(await readFile(path, "utf8"));
  return byteCount > 20;
}

function isBrowserDevConformerResultArtifact(lowerName: string) {
  return lowerName === "crest_best.xyz" ||
    lowerName === "crest_conformers.xyz" ||
    lowerName === "crest_conformers.sdf" ||
    lowerName === "crest_ensemble.xyz" ||
    lowerName === "crest_rotamers.xyz" ||
    lowerName === "xtbopt.sdf" ||
    lowerName === "xtbopt.xyz" ||
    lowerName === "xtbopt.mol" ||
    lowerName === "xtbtopo.sdf" ||
    lowerName === "input_pruned.xyz" ||
    lowerName === "input_pruned.sdf";
}

function validXyzEnsembleText(text: string) {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length;) {
    const atomCount = Number.parseInt(lines[index]?.trim() ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) return false;
    const end = index + atomCount + 2;
    if (end > lines.length) return false;
    const atoms = lines.slice(index + 2, end).filter((line) => line.trim()).length;
    if (atoms !== atomCount) return false;
    return true;
  }
  return false;
}

function validSdfEnsembleText(text: string) {
  return text.split(/\$\$\$\$/u).some((record) => /\bV2000\b|\bV3000\b/u.test(record) && record.trim().length > 80);
}

function browserDevConformerArtifactKind(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("report")) return "report";
  if (lower.endsWith(".log") || lower.endsWith(".out")) return "log";
  if (lower === "coord" || lower === "crest_input_copy.xyz" || lower.startsWith("input.") || lower.startsWith("prepared_")) return "artifact";
  if (lower.endsWith(".json")) return "summary";
  if (lower.endsWith(".xyz") || lower.endsWith(".sdf") || lower.endsWith(".sd") || lower.endsWith(".mol")) return "ensemble";
  return "artifact";
}

function primaryBrowserDevConformerOpenPath(operation: "crest-generate" | "prism-prune", artifacts: Awaited<ReturnType<typeof collectBrowserDevConformerArtifacts>>, ok: boolean) {
  if (!ok) return null;
  const preferred = operation === "crest-generate"
    ? ["crest_conformers.xyz", "crest_conformers.sdf", "crest_ensemble.xyz", "crest_best.xyz", "crest_rotamers.xyz", "xtbopt.sdf", "xtbopt.xyz", "xtbopt.mol", "xtbtopo.sdf"]
    : ["input_pruned.xyz", "input_pruned.sdf"];
  const isValid = (artifact: (typeof artifacts)[number] | undefined) => artifact?.validEnsemble === true;
  return preferred.map((name) => artifacts.find((artifact) => artifact.title === name && isValid(artifact))?.path).find(Boolean)
    ?? preferred.map((prefix) => artifacts.find((artifact) => artifact.title.startsWith(prefix) && isValid(artifact))?.path).find(Boolean)
    ?? null;
}

function browserDevConformerRecoverySummary(operation: "crest-generate" | "prism-prune", primaryOpenPath: string, status: number) {
  const name = fileTitle(primaryOpenPath).toLowerCase();
  if (operation === "crest-generate" && (name === "xtbopt" || name === "xtbtopo")) {
    return "CREST failed during initial optimization, but xTB produced an optimized fallback structure; review it before using it as an ensemble.";
  }
  return `${operation === "crest-generate" ? "CREST" : "PRISM"} produced an ensemble but exited with code ${status}; review the report before using it.`;
}

function browserDevConformerErrorSummary(
  operation: "crest-generate" | "prism-prune",
  status: number,
  log: string,
  preparationSource: string,
  inputText: string,
) {
  if (status === 0) return null;
  if (status === 124) return `${operation === "crest-generate" ? "CREST" : "PRISM"} timed out before producing an ensemble. Increase the timeout or use a faster preset.`;
  if (/Initial geometry optimization failed/iu.test(log)) {
    if (operation !== "crest-generate") return "Initial geometry optimization failed.";
    if (preparationSource !== "input") return "Initial geometry optimization failed after ligand preparation. Check charge, protonation, or the prepared ligand template.";
    return isRawPdbLigandSelection(inputText)
      ? "Initial geometry optimization failed. Raw PDB ligands need preparation: add hydrogens, set charge/protonation, or use a prepared SDF."
      : "Initial geometry optimization failed. Check input geometry, charge, protonation, or use a prepared SDF.";
  }
  const lines = log.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/\b(error|failed|failure)\b/iu.test(lines[index])) return lines[index];
  }
  return `${operation === "crest-generate" ? "CREST" : "PRISM"} exited with code ${status}.`;
}

async function writeBrowserDevConformerReport(path: string, result: Awaited<ReturnType<typeof runBrowserDevConformerJob>>, log: string) {
  const lines = [
    "# Conformer Job Report",
    "",
    `- Operation: ${result.operation}`,
    `- Input: ${result.inputPath}`,
    `- Work dir: ${result.workDir}`,
    `- Exit code: ${result.exitCode}`,
    `- Error summary: ${result.errorSummary ?? "None"}`,
    `- Preparation: ${result.preparation.source}`,
    `- Prepared input: ${result.preparation.path}`,
    `- Elapsed: ${(result.elapsedMs / 1000).toFixed(1)} s`,
    `- Command: ${result.command.map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" ")}`,
    `- Recovery: ${result.recovery ?? "None"}`,
    `- Primary output: ${result.primaryOpenPath ?? "None"}`,
    "",
    "## Artifacts",
    "",
    ...result.artifacts.map((artifact) => `- ${artifact.title} (${artifact.kind}, ${artifact.byteCount} B): ${artifact.path}`),
    "",
    "## Log excerpt",
    "",
    "```text",
    log.slice(-8000),
    "```",
    "",
  ];
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

type BrowserDevXtbRunRequest = {
  operation?: string;
  jobId?: string | null;
  inputPath?: string | null;
  inputText?: string | null;
  inputExtension?: string | null;
  sourcePath?: string | null;
  label?: string | null;
  method?: string | null;
  charge?: number | null;
  uhf?: number | null;
  optLevel?: string | null;
  solvationModel?: string | null;
  solvent?: string | null;
  threads?: number | null;
  accuracy?: number | null;
  electronicTemperature?: number | null;
  properties?: {
    dipole?: boolean;
    wbo?: boolean;
    population?: boolean;
    molden?: boolean;
    alpha?: boolean;
    fod?: boolean;
    esp?: boolean;
    fukui?: boolean;
  } | null;
  mdTemperature?: number | null;
  mdTimePs?: number | null;
  mdStepFs?: number | null;
  mdSnapshots?: number | null;
  timeoutSeconds?: number | null;
  saveRunFiles?: boolean | null;
};

async function assertBrowserDevXtbDirectInput(request: BrowserDevXtbRunRequest) {
  const inlineText = typeof request.inputText === "string" && request.inputText.trim() ? request.inputText : "";
  if (inlineText) {
    assertBrowserDevDirectChemistryInput(inlineText, request.inputExtension || "xyz", "xTB");
    return;
  }
  const inputPath = request.inputPath ? resolve(request.inputPath) : "";
  if (!inputPath || !isDevFileReadAllowed(inputPath)) return;
  const text = await readFile(inputPath, "utf8").catch(() => "");
  if (text) assertBrowserDevDirectChemistryInput(text, fileExtension(inputPath), "xTB");
}

function assertBrowserDevDirectChemistryInput(text: string, extension: string, engine: "xTB" | "CREST" | "PRISM") {
  const atomCount = estimateBrowserDevAtomCount(text, extension);
  if (atomCount === null || atomCount <= DIRECT_CHEMISTRY_JOB_ATOM_LIMIT) return;
  throw new Error(`${engine} is disabled for full structures above ${DIRECT_CHEMISTRY_JOB_ATOM_LIMIT} atoms (${atomCount} atoms detected). Select a ligand or open a small-molecule file first.`);
}

function estimateBrowserDevAtomCount(text: string, extension: string) {
  const normalizedExtension = extension.toLowerCase().replace(/^\./u, "");
  if (["pdb", "pdbqt", "ent"].includes(normalizedExtension)) {
    const count = text.split(/\r?\n/u).filter((line) => line.startsWith("ATOM") || line.startsWith("HETATM")).length;
    return count > 0 ? count : null;
  }
  if (["xyz", "trj", "log"].includes(normalizedExtension)) {
    const count = Number.parseInt(text.trimStart().split(/\s+/u)[0] ?? "", 10);
    return Number.isFinite(count) && count > 0 ? count : null;
  }
  const molCounts = text.split(/\r?\n/u).find((line) => /\bV(?:2000|3000)\b/u.test(line));
  if (molCounts) {
    const count = Number.parseInt(molCounts.trim().split(/\s+/u)[0] ?? "", 10);
    return Number.isFinite(count) && count > 0 ? count : null;
  }
  return null;
}

async function runBrowserDevXtbJob(request: BrowserDevXtbRunRequest) {
  const jobKey = browserDevJobKey("xtb", request.jobId);
  try {
    return await runBrowserDevXtbJobImpl(request, jobKey);
  } finally {
    finishBrowserDevJob(jobKey);
  }
}

async function runBrowserDevXtbJobImpl(request: BrowserDevXtbRunRequest, jobKey: string | null) {
  const executable = resolveExecutable("xtb");
  if (!executable) throw new Error("xTB executable was not found. Install it with pixi global install xtb or make xtb available on PATH.");
  const operation = request.operation || "properties";
  assertBrowserDevXtbOperation(operation);
  await assertBrowserDevXtbDirectInput(request);
  const startedAt = Date.now();
  const workDir = await browserDevXtbWorkDir(request, operation, startedAt);
  await writeBrowserDevXtbRunMetadata(workDir, request, operation, startedAt);
  const logPath = join(workDir, "xtb.log");
  const reportPath = join(workDir, "xtb-report.md");
  const inputPath = await prepareBrowserDevXtbInputWithHydrogens(
    await prepareBrowserDevXtbInput(request, workDir),
    workDir,
    "input-with-h",
  );
  const args = await buildBrowserDevXtbArgs(request, operation, inputPath, workDir);
  const timeout = Math.max(1, Number(request.timeoutSeconds) || 180) * 1000;
  const commandEnv = { ...process.env };
  if (Number(request.threads) > 0) commandEnv.OMP_NUM_THREADS = String(request.threads);
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = 0;
  let commandError: unknown = null;
  try {
    const output = await execBrowserDevJobFile(executable, args, {
      cwd: workDir,
      env: commandEnv,
      timeout,
      maxBuffer: XTB_LOG_CAPTURE_BYTES,
    }, jobKey);
    stdout = output.stdout || "";
    stderr = output.stderr || "";
  } catch (error) {
    commandError = error;
    const typed = error as { stdout?: string; stderr?: string; code?: number | string | null };
    stdout = typed.stdout || "";
    stderr = typed.stderr || "";
    exitCode = typeof typed.code === "number" ? typed.code : null;
  }
  const log = `${stdout}${stderr}`;
  await writeFile(logPath, log);
  const cancelled = browserDevJobWasCancelled(jobKey);
  const timedOut = !cancelled && browserDevCommandTimedOut(commandError);
  const artifacts = cancelled || timedOut ? [] : await collectBrowserDevXtbArtifacts(workDir);
  const summary = cancelled || timedOut ? null : await readBrowserDevXtbSummary(workDir);
  const primaryOpenPath = cancelled || timedOut ? null : primaryBrowserDevXtbOpenPath(operation, artifacts);
  const ok = commandError === null && !cancelled;
  const result = {
    ok,
    operation,
    command: [executable, ...args],
    workDir,
    elapsedMs: Date.now() - startedAt,
    exitCode: cancelled ? 130 : timedOut ? 124 : exitCode,
    logPath,
    reportPath,
    primaryOpenPath,
    artifacts,
    summary,
    error: cancelled
      ? "xTB job cancelled."
      : timedOut
        ? `xTB timed out after ${Math.round(timeout / 1000)} seconds. ${truncateText(log, 480)}`
        : ok ? null : `xTB failed. ${truncateText(log || String(commandError), 480)}`,
  };
  await writeBrowserDevXtbReport(reportPath, result, log);
  return result;
}

async function browserDevXtbWorkDir(request: BrowserDevXtbRunRequest, operation: string, startedAt: number) {
  if (request.saveRunFiles !== false) {
    const sourcePath = request.sourcePath || request.inputPath;
    if (sourcePath) {
      const inputPath = resolve(sourcePath);
      if (!isDevFileReadAllowed(inputPath)) throw new Error(`Forbidden source path: ${inputPath}`);
      const info = await stat(inputPath);
      if (!info.isFile()) throw new Error(`${inputPath} is not a file.`);
      return createBrowserDevXtbRunDir(xtbRunParentForSourcePath(inputPath), operation);
    }
  }
  const workDir = join(BROWSER_DEV_XTB_JOBS_ROOT, `${startedAt}-${safeSlug(request.label || operation)}`);
  await mkdir(workDir, { recursive: true });
  return workDir;
}

async function createBrowserDevXtbRunDir(parentDir: string, operation: string) {
  const prefix = browserDevXtbRunDirPrefix(operation);
  for (let index = 1; index <= 9999; index += 1) {
    const workDir = join(parentDir, `${prefix}_${index}`);
    try {
      await mkdir(workDir);
      return workDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`Could not create a ${prefix}_N directory in ${parentDir}.`);
}

function xtbRunParentForSourcePath(sourcePath: string) {
  let parentDir = dirname(sourcePath);
  while (isXtbRunDirName(pathBasename(parentDir))) {
    parentDir = dirname(parentDir);
  }
  return parentDir;
}

function browserDevXtbRunDirPrefix(operation: string) {
  const prefixes: Record<string, string> = {
    optimize: "xtb_optimize",
    properties: "xtb_properties",
    "optimized-hessian": "xtb_hessian",
    vipea: "xtb_ip_ea",
    vfukui: "xtb_fukui",
    md: "xtb_md",
    metadyn: "xtb_metadyn",
  };
  return prefixes[operation] ?? "xtb_run";
}

function isXtbRunDirName(name: string) {
  return /^xtb_(?:run|optimize|properties|hessian|ip_ea|fukui|md|metadyn)_\d+$/u.test(name);
}

async function writeBrowserDevXtbRunMetadata(workDir: string, request: BrowserDevXtbRunRequest, operation: string, startedAt: number) {
  const operationLabel = browserDevXtbOperationLabel(operation);
  const inputLabel = pathBasename(request.sourcePath || request.inputPath || request.label || operation);
  const title = inputLabel ? `${operationLabel} · ${inputLabel}` : operationLabel;
  await writeFile(join(workDir, XTB_RUN_METADATA_FILE), `${JSON.stringify({
    kind: "xtb-run",
    operation,
    operationLabel,
    inputLabel,
    title,
    createdAt: new Date(startedAt).toISOString(),
  }, null, 2)}\n`);
}

function browserDevXtbOperationLabel(operation: string) {
  const labels: Record<string, string> = {
    optimize: "xTB Optimize",
    properties: "xTB Properties",
    cube: "xTB Cube",
    hessian: "xTB Hessian",
    "optimized-hessian": "xTB Optimized Hessian",
    vip: "xTB IP/EA",
    vea: "xTB IP/EA",
    vipea: "xTB IP/EA",
    vfukui: "xTB Fukui",
    vomega: "xTB Omega",
    md: "xTB MD",
    metadyn: "xTB Metadynamics",
  };
  return labels[operation] ?? `xTB ${operation}`;
}

function assertBrowserDevXtbOperation(operation: string) {
  if (operation === "grid-properties") {
    throw new Error("xTB Properties requires one molecule. Open a specific molecule in Mol* before running it.");
  }
}

function browserDevCommandTimedOut(error: unknown) {
  const value = error as { killed?: unknown; signal?: unknown } | null;
  return value?.killed === true && value.signal === "SIGTERM";
}

async function prepareBrowserDevXtbInput(request: BrowserDevXtbRunRequest, workDir: string) {
  const text = typeof request.inputText === "string" ? request.inputText.trim() : "";
  if (text) {
    const inputPath = join(workDir, `input.${safeExtension(request.inputExtension || "xyz")}`);
    await writeFile(inputPath, request.inputText || "");
    return inputPath;
  }
  const inputPath = request.inputPath ? resolve(request.inputPath) : "";
  if (!inputPath) throw new Error("xTB job requires inputPath or inputText.");
  if (!isDevFileReadAllowed(inputPath)) throw new Error(`Forbidden input path: ${inputPath}`);
  const info = await stat(inputPath);
  if (!info.isFile()) throw new Error(`${inputPath} is not a file.`);
  return inputPath;
}

async function prepareBrowserDevXtbInputWithHydrogens(inputPath: string, workDir: string, outputStem: string) {
  const extension = fileExtension(inputPath);
  const prepLogPath = join(workDir, "xtb-prep.log");
  if (!supportsOpenBabelHydrogenExtension(extension)) {
    await appendBrowserDevXtbPrepLog(
      prepLogPath,
      `Skipped hydrogen preparation for unsupported input extension '${extension}': ${inputPath}`,
    );
    return inputPath;
  }
  const obabel = resolveExecutable("obabel");
  if (!obabel) {
    await appendBrowserDevXtbPrepLog(prepLogPath, "Open Babel executable 'obabel' was not found; xTB will use the original input.");
    return inputPath;
  }
  if (isCifExtension(extension)) {
    return prepareBrowserDevXtbCifInputWithHydrogens(inputPath, workDir, outputStem, obabel, prepLogPath);
  }
  const outputPath = join(workDir, `${outputStem}.${safeExtension(extension)}`);
  try {
    await execFileAsync(obabel, [inputPath, "-O", outputPath, "-h"], { timeout: 120_000, maxBuffer: XTB_LOG_CAPTURE_BYTES });
    const info = await stat(outputPath);
    if (info.isFile() && info.size > 0) {
      await appendBrowserDevXtbPrepLog(prepLogPath, `Prepared xTB input with hydrogens using ${obabel}: ${outputPath}`);
      return outputPath;
    }
    await appendBrowserDevXtbPrepLog(prepLogPath, "Open Babel hydrogen preparation produced an empty file; xTB will use the original input.");
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; message?: string };
    await appendBrowserDevXtbPrepLog(
      prepLogPath,
      `Open Babel hydrogen preparation failed; xTB will use the original input. ${truncateText(`${typed.stdout || ""}${typed.stderr || ""}${typed.message || ""}`, 2000)}`,
    );
  }
  return inputPath;
}

async function prepareBrowserDevXtbCifInputWithHydrogens(
  inputPath: string,
  workDir: string,
  outputStem: string,
  obabel: string,
  prepLogPath: string,
) {
  const pdbPath = join(workDir, `${outputStem}-cif.pdb`);
  const outputPath = join(workDir, `${outputStem}.xyz`);
  try {
    await execFileAsync(obabel, [inputPath, "-O", pdbPath], { timeout: 120_000, maxBuffer: XTB_LOG_CAPTURE_BYTES });
    const pdbInfo = await stat(pdbPath);
    if (!pdbInfo.isFile() || pdbInfo.size === 0) {
      await appendBrowserDevXtbPrepLog(prepLogPath, "Open Babel CIF to PDB preparation produced an empty file; xTB will use the original input.");
      return inputPath;
    }
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; message?: string };
    await appendBrowserDevXtbPrepLog(
      prepLogPath,
      `Open Babel CIF to PDB preparation failed; xTB will use the original input. ${truncateText(`${typed.stdout || ""}${typed.stderr || ""}${typed.message || ""}`, 2000)}`,
    );
    return inputPath;
  }
  try {
    await execFileAsync(obabel, [pdbPath, "-O", outputPath, "-h"], { timeout: 120_000, maxBuffer: XTB_LOG_CAPTURE_BYTES });
    const info = await stat(outputPath);
    if (info.isFile() && info.size > 0) {
      await appendBrowserDevXtbPrepLog(prepLogPath, `Prepared CIF xTB input as XYZ with hydrogens using ${obabel}: ${outputPath}`);
      return outputPath;
    }
    await appendBrowserDevXtbPrepLog(prepLogPath, "Open Babel CIF hydrogen preparation produced an empty file; xTB will use the original input.");
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; message?: string };
    await appendBrowserDevXtbPrepLog(
      prepLogPath,
      `Open Babel CIF hydrogen preparation failed; xTB will use the original input. ${truncateText(`${typed.stdout || ""}${typed.stderr || ""}${typed.message || ""}`, 2000)}`,
    );
  }
  return inputPath;
}

function isCifExtension(extension: string) {
  return ["cif", "mcif", "mmcif"].includes(extension);
}

function supportsOpenBabelHydrogenExtension(extension: string) {
  return ["pdb", "ent", "mol", "mol2", "sdf", "sd", "xyz", "cif", "mcif", "mmcif"].includes(extension);
}

async function appendBrowserDevXtbPrepLog(path: string, message: string) {
  await writeFile(path, `${message}\n`, { flag: "a" });
}

async function buildBrowserDevXtbArgs(request: BrowserDevXtbRunRequest, operation: string, inputPath: string, workDir: string) {
  const args: string[] = [];
  args.push(inputPath);
  if (operation === "optimize") {
    args.push("--opt", xtbOptLevel(request.optLevel), "--json");
  } else if (operation === "properties") {
    args.push("--scc", "--json", ...browserDevXtbPropertyArgs(request.properties));
  } else if (operation === "cube") {
    const inputFile = join(workDir, "xcontrol.inp");
    await writeFile(inputFile, "$cube\n  density=true\n$end\n");
    args.push("--scc", "--json", "--input", inputFile);
  } else if (operation === "hessian") {
    args.push("--hess", "--json");
  } else if (operation === "optimized-hessian") {
    args.push("--ohess", xtbOptLevel(request.optLevel), "--json");
  } else if (["vip", "vea", "vipea", "vfukui", "vomega"].includes(operation)) {
    args.push(`--${operation}`, "--json");
  } else if (operation === "md") {
    const inputFile = join(workDir, "md.inp");
    await writeFile(inputFile, browserDevXtbMdInput(request));
    args.push("--omd", "--input", inputFile);
  } else if (operation === "metadyn") {
    const inputFile = join(workDir, "md.inp");
    await writeFile(inputFile, browserDevXtbMdInput(request));
    args.push("--metadyn", String(clampInteger(request.mdSnapshots, 1, 1000, 100)), "--input", inputFile);
  } else {
    throw new Error(`Unsupported xTB operation: ${operation}`);
  }
  appendBrowserDevXtbCommonArgs(args, request);
  return args;
}

function appendBrowserDevXtbCommonArgs(args: string[], request: BrowserDevXtbRunRequest) {
  if (request.method === "gfn0") args.push("--gfn", "0");
  else if (request.method === "gfn1") args.push("--gfn", "1");
  else if (request.method === "gfnff") args.push("--gfnff");
  else args.push("--gfn", "2");
  if (Number.isFinite(request.charge)) args.push("--chrg", String(request.charge));
  if (Number.isFinite(request.uhf)) args.push("--uhf", String(request.uhf));
  if (Number(request.threads) > 0) args.push("--parallel", String(clampInteger(request.threads, 1, 32, 1)));
  if (Number.isFinite(request.accuracy)) args.push("--acc", String(clampNumber(request.accuracy, 0.05, 10, 1)));
  if (Number.isFinite(request.electronicTemperature)) args.push("--etemp", String(clampInteger(request.electronicTemperature, 50, 5000, 300)));
  const solvent = typeof request.solvent === "string" ? request.solvent.trim() : "";
  const solvationModel = typeof request.solvationModel === "string" ? request.solvationModel.trim().toLowerCase() : "none";
  if (solvent && solvent !== "none" && solvationModel !== "none") {
    args.push(xtbSolvationFlag(solvationModel), solvent);
  }
}

function browserDevXtbPropertyArgs(properties: BrowserDevXtbRunRequest["properties"]) {
  const flags = [];
  const selected = properties || {};
  if (selected.dipole !== false) flags.push("--dipole");
  if (selected.wbo !== false) flags.push("--wbo");
  if (selected.population === true) flags.push("--pop");
  if (selected.molden === true) flags.push("--molden");
  if (selected.alpha === true) flags.push("--alpha");
  if (selected.fod === true) flags.push("--fod");
  if (selected.esp === true) flags.push("--esp");
  if (selected.fukui === true) flags.push("--vfukui");
  return flags;
}

function xtbOptLevel(value: unknown) {
  const text = String(value || "normal").trim().toLowerCase();
  return ["loose", "normal", "tight", "verytight"].includes(text) ? text : "normal";
}

function xtbSolvationFlag(model: string) {
  if (model === "gbsa") return "--gbsa";
  if (model === "cosmo") return "--cosmo";
  if (model === "cpcmx" || model === "cpcm-x") return "--cpcmx";
  return "--alpb";
}

function browserDevXtbMdInput(request: BrowserDevXtbRunRequest) {
  const mdTimePs = clampNumber(request.mdTimePs, 0.05, 100, 2);
  const mdStepFs = clampNumber(request.mdStepFs, 0.1, 10, 1);
  const mdSnapshots = clampInteger(request.mdSnapshots, 1, 1000, 100);
  return [
    "$md",
    `  temp=${clampInteger(request.mdTemperature, 50, 2000, 298)}`,
    `  time=${mdTimePs}`,
    `  step=${mdStepFs}`,
    `  dump=${Math.max(mdStepFs, (mdTimePs * 1000) / mdSnapshots)}`,
    "$end",
    "",
  ].join("\n");
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function collectBrowserDevXtbArtifacts(workDir: string) {
  const artifacts = [];
  for (const entry of await readdir(workDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(workDir, entry.name);
    const info = await stat(path);
    const extension = fileExtension(path);
    const kind = browserDevXtbArtifactKind(entry.name, extension);
    if (kind === "internal") continue;
    artifacts.push({ path, title: entry.name, extension, kind, byteCount: info.size });
  }
  return artifacts.sort((left, right) => left.title.localeCompare(right.title));
}

function browserDevXtbArtifactKind(title: string, extension: string) {
  if (
    [XTB_RUN_METADATA_FILE, "xcontrol.inp", "md.inp", "input.sdf", "input.xyz", "input.mol", "input.pdb", "input.cif"].includes(title)
    || title.startsWith("input-with-h.")
    || title.startsWith("input-with-h-")
    || (title.startsWith("secondary-") && title.includes("-with-h."))
    || (title.startsWith("secondary-") && title.includes("-with-h-"))
  ) return "internal";
  if (title === "xtbopt.log") return "trajectory";
  if (["xyz", "sdf", "mol", "pdb", "cif"].includes(extension)) return "structure";
  if (["cub", "cube"].includes(extension)) return "cube";
  if (extension === "json") return "json";
  if (["log", "out"].includes(extension)) return "log";
  if (["trj", "arc"].includes(extension)) return "trajectory";
  if (["md", "txt"].includes(extension)) return "text";
  return "artifact";
}

async function readBrowserDevXtbSummary(workDir: string) {
  let summary: Record<string, unknown> = {};
  for (const name of ["xtbout.json", "xtb.json"]) {
    try {
      summary = JSON.parse(await readFile(join(workDir, name), "utf8"));
      break;
    } catch (_) {}
  }
  const charges = await readBrowserDevNumericRows(join(workDir, "charges"));
  const wbo = await readBrowserDevWboRows(join(workDir, "wbo"));
  const fukui = await readBrowserDevFukuiRows(join(workDir, "xtb.log"));
  const logMetrics = await readBrowserDevXtbLogMetrics(join(workDir, "xtb.log"));
  for (const [key, value] of Object.entries(logMetrics)) {
    if (!(key in summary)) summary[key] = value;
  }
  if (charges.length > 0 && !Array.isArray(summary["partial charges"])) summary.buretteCharges = charges;
  if (wbo.length > 0) summary.buretteWbo = wbo;
  if (fukui.length > 0) summary.buretteFukui = fukui;
  return Object.keys(summary).length > 0 ? summary : null;
}

async function readBrowserDevXtbLogMetrics(path: string) {
  try {
    return parseBrowserDevXtbLogMetrics(await readFile(path, "utf8"));
  } catch (_) {
    return {};
  }
}

function parseBrowserDevXtbLogMetrics(text: string) {
  const metrics: Record<string, unknown> = {};
  let inDipole = false;
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if ((trimmed.includes(":: total energy") || trimmed.includes("| TOTAL ENERGY")) && !lower.includes("gain")) {
      const [energy] = parseBrowserDevXtbFloatValues(trimmed);
      if (Number.isFinite(energy)) metrics["total energy"] = energy;
    }
    if (trimmed.includes(":: HOMO-LUMO gap") || trimmed.includes("| HOMO-LUMO GAP")) {
      const [gap] = parseBrowserDevXtbFloatValues(trimmed);
      if (Number.isFinite(gap)) metrics["HOMO-LUMO gap / eV"] = gap;
    }
    if (lower === "molecular dipole:") {
      inDipole = true;
      continue;
    }
    if (inDipole) {
      if (lower.startsWith("full:")) {
        const values = parseBrowserDevXtbFloatValues(trimmed);
        if (values.length >= 3) metrics["dipole / a.u."] = values.slice(0, 3);
        inDipole = false;
      } else if (trimmed.startsWith("molecular quadrupole")) {
        inDipole = false;
      }
    }
  }
  return metrics;
}

function parseBrowserDevXtbFloatValues(line: string) {
  return line
    .split(/\s+/u)
    .map((token) => token.replace(/^[^0-9+\-.eE]+|[^0-9+\-.eE]+$/gu, ""))
    .map((token) => Number.parseFloat(token))
    .filter(Number.isFinite);
}

async function readBrowserDevNumericRows(path: string) {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/u)
      .map((line) => Number.parseFloat(line.trim()))
      .filter(Number.isFinite);
  } catch (_) {
    return [];
  }
}

async function readBrowserDevWboRows(path: string) {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u).map(Number))
      .filter((row) => row.length >= 3 && row.every(Number.isFinite))
      .map(([from, to, order]) => ({ from, to, order }));
  } catch (_) {
    return [];
  }
}

async function readBrowserDevFukuiRows(path: string) {
  try {
    return parseBrowserDevFukuiRows(await readFile(path, "utf8"));
  } catch (_) {
    return [];
  }
}

function parseBrowserDevFukuiRows(text: string) {
  const rows: Array<{ atom: number; element: string; fplus: number; fminus: number; fzero: number }> = [];
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes("Fukui functions:"));
  if (start < 0) return rows;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(\d+)\s*([A-Za-z]{1,3})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/u);
    if (!match) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push({
      atom: Number(match[1]),
      element: match[2],
      fplus: Number(match[3]),
      fminus: Number(match[4]),
      fzero: Number(match[5]),
    });
  }
  return rows;
}

function primaryBrowserDevXtbOpenPath(operation: string, artifacts: Awaited<ReturnType<typeof collectBrowserDevXtbArtifacts>>) {
  const preferred = operation === "optimize"
    ? ["xtbopt.xyz", "xtbopt.pdb", "xtbopt.sdf", "xtbopt.mol", "xtbopt.log"]
    : operation === "optimized-hessian"
      ? ["xtbopt.xyz", "xtbopt.pdb", "xtbopt.sdf", "xtbopt.mol"]
    : operation === "cube"
      ? ["density.cub", "fod.cub", "density.cube"]
      : operation === "md" || operation === "metadyn"
        ? ["xtb.trj", "xtbopt.xyz"]
        : [];
  for (const name of preferred) {
    const artifact = artifacts.find((item) => item.title === name);
    if (artifact) return artifact.path;
  }
  return null;
}

async function writeBrowserDevXtbReport(path: string, result: Awaited<ReturnType<typeof runBrowserDevXtbJob>>, log: string) {
  const lines = [
    "# xTB Job Report",
    "",
    `- Operation: \`${result.operation}\``,
    `- Status: \`${result.exitCode === 130 ? "cancelled" : result.ok ? "success" : result.primaryOpenPath ? "recovered" : "failed"}\``,
    `- Exit code: \`${result.exitCode ?? "none"}\``,
    `- Elapsed: \`${result.elapsedMs}\` ms`,
    `- Work directory: \`${result.workDir}\``,
    result.primaryOpenPath ? `- Primary artifact: \`${result.primaryOpenPath}\`` : null,
    result.error ? `- Error: \`${result.error.replaceAll("`", "'")}\`` : null,
    "",
    "## Command",
    "",
    "```text",
    result.command.join(" "),
    "```",
    "",
    "## Artifacts",
    "",
    result.artifacts.length ? result.artifacts.map((artifact) => `- \`${artifact.path}\` (${artifact.kind}, ${artifact.byteCount} bytes)`).join("\n") : "No artifacts were produced.",
    "",
    "## JSON Summary",
    "",
    "```json",
    JSON.stringify(result.summary ?? {}, null, 2),
    "```",
    "",
    "## Log Tail",
    "",
    "```text",
    truncateText(log, 8000),
    "```",
    "",
  ].filter((line) => line !== null);
  await writeFile(path, `${lines.join("\n")}\n`);
}

function safeSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug || "xtb-job";
}

function safeExtension(value: string) {
  const extension = value.toLowerCase().replace(/^\./u, "").replace(/[^a-z0-9]+/gu, "");
  return extension || "xyz";
}

function truncateText(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

export function browserDevXyzrenderPlugin() {
  return {
    name: "burrete-browser-dev-xyzrender",
    configureServer(server: import("vite").ViteDevServer) {
      const fileRoutes = {
        collectDefaultDevFiles,
        collectDevFiles,
        devFileExtensions: DEV_FILE_EXTENSIONS,
        devFileSizeLimit: DEV_FILE_SIZE_LIMIT,
        fileExtension,
        fileTitle,
        isDevFileReadAllowed,
        isNumpyArtifactExtension,
        languageForTextExtension,
        looksBinary,
        molecularBinaryArtifactSummary,
        molecularBinaryMetadataExtensions: MOLECULAR_BINARY_METADATA_EXTENSIONS,
        numpyArtifactTextSummary,
        readableTextBytes,
        resolveStructureFileBundle,
        textFileReadLimit,
      };
      registerBrowserDevFileDiscoveryRoute(server, fileRoutes);
      registerBrowserDevRdkitWasmRoute(server, RDKIT_WASM_PATH);
      registerBrowserDevInlineConformerRoute(server, generate3DConformerForBrowserDev);
      registerBrowserDevMsbuddyRoutes(server, {
        annotateSpectrum: annotateBrowserDevSpectrumWithMsbuddy,
        status: browserDevMsbuddyStatus,
      });

      registerBrowserDevDescriptorRoutes(server, {
        calculate: calculateBrowserDevDescriptors,
        calculateGrid: calculateBrowserDevGridDescriptors,
        gridJobs: browserDevDescriptorJobs,
        gridSummary: browserDevDescriptorGridSummary,
        install: installBrowserDevDescriptorRuntime,
        status: browserDevDescriptorStatus,
      });
      registerBrowserDevConformerJobRoutes(server, {
        cancel: cancelBrowserDevJob,
        prepare: prepareBrowserDevConformerJob,
        run: runBrowserDevConformerJob,
        status: browserDevConformerStatus,
      });
      registerBrowserDevXtbRoutes(server, {
        cancel: cancelBrowserDevJob,
        install: installBrowserDevXtb,
        run: runBrowserDevXtbJob,
        status: browserDevXtbStatus,
      });
      registerBrowserDevRuntimeDoctorRoute(server, {
        conformerStatus: browserDevConformerStatus,
        datamolConformerStatus: () => browserDevConformerPythonStatus("datamol"),
        descriptorStatus: browserDevDescriptorStatus,
        rdkitConformerStatus: () => browserDevConformerPythonStatus("rdkit"),
        schrodingerStatus: browserDevSchrodingerStatus,
        xtbStatus: browserDevXtbStatus,
        xyzrenderStatus: browserDevXyzrenderStatus,
      });
      registerBrowserDevAgentSessionRoute(server);
      registerBrowserDevAppIconRoute(server, BROWSER_DEV_APP_ICONS, execFileAsync);
      registerBrowserDevFileContentRoutes(server, fileRoutes);
      registerBrowserDevFoldingResultRoute(server, { isDevFileReadAllowed });
      registerBrowserDevDesmondPreviewRoute(server, {
        desmondPreviewExtractor: DESMOND_PREVIEW_EXTRACTOR,
        execFileAsync,
        isDevFileReadAllowed,
        resolveStructureFileBundle,
        schrodingerRun: SCHRODINGER_RUN,
        targetMb: DESMOND_PREVIEW_TARGET_MB,
      });
      registerBrowserDevXyzrenderRoute(server, {
        buildArgs: buildXyzrenderArgs,
        execFileAsync,
        normalizeControls: normalizeXyzrenderControls,
        normalizeInputExtension: normalizeXyzrenderInputExtension,
        normalizeOrientationRef,
        normalizePreset: normalizeXyzrenderPreset,
        presetOptions: XYZRENDER_PRESET_OPTIONS,
        resolveConfigArgument,
        resolveEffectivePreset,
        resolveExecutable: resolveXyzrenderExecutable,
      });
    },
  };
}

async function collectDefaultDevFiles() {
  const files: string[] = [];
  for (const source of defaultDevFileSources) {
    await collectDevFiles(source, files);
  }
  return Array.from(new Set(files)).sort((left, right) => {
    const leftLarge = left.includes("/samples/large/");
    const rightLarge = right.includes("/samples/large/");
    if (leftLarge !== rightLarge) return leftLarge ? -1 : 1;
    return left.localeCompare(right);
  });
}

async function collectDevFiles(path: string, files: string[]) {
  let info;
  try {
    info = await stat(path);
  } catch (_) {
    return;
  }
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      await collectDevFiles(join(path, entry.name), files);
    }
    return;
  }
  if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT) return;
  if (!DEV_FILE_EXTENSIONS.has(fileExtension(path))) return;
  if (path.endsWith("/no-molecule-column.csv")) return;
  files.push(path);
}

function isDevFileReadAllowed(path: string) {
  return devFsAllowRoots.some((root) => {
    const relation = relative(root, path);
    return relation === "" || (relation && !relation.startsWith("..") && !relation.startsWith("/"));
  });
}

function fileExtension(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mae.gz")) return "maegz";
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index + 1) : "";
}

function fileTitle(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Text file";
}

function looksBinary(bytes: Buffer) {
  const limit = Math.min(bytes.length, TEXT_FILE_READ_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function textFileReadLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return TEXT_FILE_READ_LIMIT;
  return Math.min(parsed, TEXT_FILE_READ_LIMIT);
}

function readableTextBytes(bytes: Buffer, extension: string) {
  if (extension === "maegz") return gunzipSync(bytes);
  return bytes;
}

function molecularBinaryArtifactSummary(path: string, byteCount: number) {
  const extension = fileExtension(path);
  if (extension === "chk" || extension === "checkpoint") {
    return `Binary OpenMM checkpoint artifact\n\nFile: ${path}\nSize: ${byteCount} bytes\n\nBurrete registers this file as an OpenMM workflow artifact, but does not deserialize checkpoint payloads. OpenMM checkpoints are tied to the matching System, Platform, OpenMM version, and hardware context, so this viewer shows metadata instead of raw binary bytes.\n`;
  }
  return `Binary molecular workflow artifact\n\nFile: ${path}\nSize: ${byteCount} bytes\nFormat: .${extension}\n\nBurrete registers this file as an MDAnalysis-compatible molecular artifact. This text viewer shows metadata because the file is a binary payload; structure preview can still use it when a compatible topology/trajectory pair is available.\n`;
}

function languageForTextExtension(extension: string) {
  if (extension === "md" || extension === "markdown" || extension === "mdx") return "markdown";
  if (extension === "sh" || extension === "bash" || extension === "zsh") return "shell";
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "toml") return "toml";
  if (extension === "py") return "python";
  if (extension === "rs") return "rust";
  if (extension === "css") return "css";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "xml") return "xml";
  if (extension === "mae" || extension === "maegz" || extension === "cms") return "maestro";
  return "text";
}

function candidateDesmondBaseNames(stem: string) {
  const bases = [stem];
  for (const suffix of ["-out", "_out", "-in", "_in"]) {
    if (stem.endsWith(suffix)) bases.push(stem.slice(0, -suffix.length));
  }
  for (const base of [...bases]) {
    bases.push(base.replace(/_replica_(\d+)$/u, "_replica$1"));
    bases.push(base.replace(/replica_(\d+)$/u, "replica$1"));
  }
  return Array.from(new Set(bases.filter(Boolean)));
}

function candidateDesmondBases(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const extension = fileExtension(name);
  const stem = extension ? name.slice(0, Math.max(0, name.length - extension.length - 1)) : name;
  return candidateDesmondBaseNames(stem);
}

function existingFileCandidate(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) || null;
}

function existingDirectoryCandidate(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()) || null;
}

function resolveStructureFileBundle(path: string): StructureFileBundle {
  return resolveDesmondFileBundle(path) ?? resolveMdFileBundle(path) ?? {
    kind: "single",
    primaryPath: path,
    inputPath: path,
    attachments: [],
  };
}

function resolveDesmondFileBundle(path: string): StructureFileBundle | null {
  const extension = fileExtension(path);
  if (extension === "dtr") {
    const trjDirectory = dirname(path);
    const base = trjDirectory.replace(/\\/g, "/").split("/").pop()?.replace(/_trj$/u, "") || "";
    const cmsPath = existingFileCandidate(candidateDesmondBaseNames(base).flatMap((candidate) => [
      join(dirname(trjDirectory), `${candidate}-out.cms`),
      join(dirname(trjDirectory), `${candidate}.cms`),
    ]));
    if (!cmsPath || !existsSync(trjDirectory) || !statSync(trjDirectory).isDirectory()) return null;
    return {
      kind: "desmond",
      primaryPath: cmsPath,
      inputPath: path,
      attachments: [
        { role: "topology", path: cmsPath },
        { role: "trajectory", path: trjDirectory },
        { role: "trajectoryPointer", path },
      ],
    };
  }
  if (extension !== "cms") return null;
  for (const base of candidateDesmondBases(path)) {
    const trjDirectory = existingDirectoryCandidate([join(dirname(path), `${base}_trj`)]);
    if (!trjDirectory) continue;
    const clickme = join(trjDirectory, "clickme.dtr");
    const attachments: StructureFileBundle["attachments"] = [
      { role: "topology", path },
      { role: "trajectory", path: trjDirectory },
    ];
    if (existsSync(clickme) && statSync(clickme).isFile()) {
      attachments.push({ role: "trajectoryPointer", path: clickme });
    }
    return {
      kind: "desmond",
      primaryPath: path,
      inputPath: path,
      attachments,
    };
  }
  return null;
}

function resolveMdFileBundle(path: string): StructureFileBundle | null {
  const extension = fileExtension(path);
  const base = path.slice(0, Math.max(0, path.length - extension.length - 1));
  if (MD_COORDINATE_EXTENSIONS.includes(extension)) {
    const topology = existingFileCandidate(
      MD_TOPOLOGY_EXTENSIONS.map((candidate) => `${base}.${candidate}`),
    );
    if (!topology) return null;
    return {
      kind: "md",
      primaryPath: topology,
      inputPath: path,
      attachments: [
        { role: "topology", path: topology },
        { role: "trajectory", path },
      ],
    };
  }
  if (MD_TOPOLOGY_EXTENSIONS.includes(extension)) {
    const trajectory = existingFileCandidate(
      MD_COORDINATE_EXTENSIONS.map((candidate) => `${base}.${candidate}`),
    );
    if (!trajectory) return null;
    return {
      kind: "md",
      primaryPath: path,
      inputPath: path,
      attachments: [
        { role: "topology", path },
        { role: "trajectory", path: trajectory },
      ],
    };
  }
  return null;
}

function isDesmondPreviewCandidate(path: string) {
  return resolveDesmondFileBundle(path) !== null;
}

function normalizeOrientationRef(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (Buffer.byteLength(normalized, "utf8") > 4 * 1024 * 1024) return null;
  const lines = normalized.split("\n");
  const atomCount = Number.parseInt((lines[0] || "").trim().split(/\s+/u)[0] || "", 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0 || lines.length < atomCount + 2) return null;
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export default defineConfig({
  root: desktopRoot,
  base: "./",
  plugins: [react(), ketcherRaphaelImportShimPlugin(), deferKetcherCssPlugin(), browserDevXyzrenderPlugin()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  define: {
    global: "globalThis",
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(browserRuntimeRepoRoot),
    "import.meta.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT": JSON.stringify(BROWSER_DEV_GENERATED_FILES_ROOT),
    "import.meta.env.BURRETE_GRID_PERF_REPORT_PATH": JSON.stringify(
      hostedMcpBuild ? "" : "/private/tmp/burrete-grid-real-app-perf.jsonl",
    ),
    process: JSON.stringify({ env: {} }),
    "process.env": "{}",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
        process: JSON.stringify({ env: {} }),
        "process.env": "{}",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: devFsAllowRoots },
    watch: { ignored: ["src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
    cssCodeSplit: !hostedMcpBuild,
    modulePreload: {
      resolveDependencies: resolveModulePreloadDependencies,
    },
    rollupOptions: {
      output: {
        entryFileNames: hostedMcpBuild
          ? "assets/burrete-hosted-shell.js"
          : undefined,
        assetFileNames: hostedMcpBuild
          ? (assetInfo) => assetInfo.name?.endsWith(".css")
            ? "assets/burrete-hosted-shell.css"
            : "assets/[name]-[hash][extname]"
          : undefined,
        manualChunks: hostedMcpBuild ? undefined : desktopManualChunks,
      },
    },
  },
  clearScreen: false,
});

import type {
  ConformerOperation,
  ConformerSettings,
  ConformerStatus,
  XtbOperation,
  XtbSettings,
} from "../types";

export const DEFAULT_CONFORMER_SETTINGS: ConformerSettings = {
  method: "gfn2",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 4,
  timeoutSeconds: 3600,
  energyWindowKcalMol: 6,
  rmsdThresholdAngstrom: 0.125,
  samplingMode: "auto",
  prismTimeoutSeconds: 300,
  prismEnergySort: true,
};

const CONFORMER_SETTINGS_STORAGE_KEY = "burrete.conformer.settings";

export function readConformerSettings(): ConformerSettings {
  try {
    const text = window.localStorage.getItem(CONFORMER_SETTINGS_STORAGE_KEY);
    return normalizeConformerSettings(text ? JSON.parse(text) : null);
  } catch (_) {
    return DEFAULT_CONFORMER_SETTINGS;
  }
}

export function saveConformerSettings(settings: ConformerSettings) {
  try {
    window.localStorage.setItem(CONFORMER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

export function normalizeConformerSettings(value: unknown): ConformerSettings {
  const source = value && typeof value === "object" ? value as Partial<ConformerSettings> : {};
  const methods = new Set<ConformerSettings["method"]>(["gfn2", "gfn1", "gfn0", "gfnff"]);
  const solvents = new Set<ConformerSettings["solvent"]>(["none", "water", "methanol", "acetonitrile", "dmso", "chloroform"]);
  const samplingModes = new Set<ConformerSettings["samplingMode"]>(["auto", "normal", "quick", "squick", "mquick"]);
  return {
    method: source.method && methods.has(source.method) ? source.method : DEFAULT_CONFORMER_SETTINGS.method,
    solvent: source.solvent && solvents.has(source.solvent) ? source.solvent : DEFAULT_CONFORMER_SETTINGS.solvent,
    charge: clampInteger(source.charge, -8, 8, DEFAULT_CONFORMER_SETTINGS.charge),
    uhf: clampInteger(source.uhf, 0, 12, DEFAULT_CONFORMER_SETTINGS.uhf),
    threads: clampInteger(source.threads, 1, 16, DEFAULT_CONFORMER_SETTINGS.threads),
    timeoutSeconds: clampInteger(source.timeoutSeconds, 30, 86_400, DEFAULT_CONFORMER_SETTINGS.timeoutSeconds),
    energyWindowKcalMol: clampNumber(source.energyWindowKcalMol, 1, 60, DEFAULT_CONFORMER_SETTINGS.energyWindowKcalMol),
    rmsdThresholdAngstrom: clampNumber(source.rmsdThresholdAngstrom, 0.01, 2, DEFAULT_CONFORMER_SETTINGS.rmsdThresholdAngstrom),
    samplingMode: source.samplingMode && samplingModes.has(source.samplingMode) ? source.samplingMode : DEFAULT_CONFORMER_SETTINGS.samplingMode,
    prismTimeoutSeconds: clampInteger(source.prismTimeoutSeconds, 5, 86_400, DEFAULT_CONFORMER_SETTINGS.prismTimeoutSeconds),
    prismEnergySort: source.prismEnergySort !== false,
  };
}

export function conformerOperationLabel(operation: ConformerOperation) {
  return operation === "prism-prune" ? "PRISM Prune" : "CREST Generate";
}

export function conformerStatusLine(status: ConformerStatus) {
  const crest = status.crest.installed ? "CREST ready" : "CREST missing";
  const prism = status.prism.installed ? "PRISM ready" : "PRISM missing";
  const openbabel = !status.openbabel
    ? "Open Babel status unavailable"
    : status.openbabel.installed ? "Open Babel ready" : "Open Babel missing";
  return `${crest}; ${prism}; ${openbabel}`;
}

export const DEFAULT_XTB_SETTINGS: XtbSettings = {
  method: "gfn2",
  optLevel: "normal",
  solvationModel: "none",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 0,
  accuracy: 1,
  electronicTemperature: 300,
  properties: {
    dipole: true,
    wbo: true,
    population: false,
    molden: false,
    alpha: false,
    fod: false,
    esp: false,
    fukui: false,
  },
  mdTemperature: 298,
  mdTimePs: 2,
  mdStepFs: 1,
  mdSnapshots: 100,
  timeoutSeconds: 180,
  saveRunFiles: true,
};

const XTB_SETTINGS_STORAGE_KEY = "burrete.xtb.settings";
const XTB_METHODS = new Set<XtbSettings["method"]>(["gfn2", "gfn1", "gfn0", "gfnff"]);
const XTB_OPT_LEVELS = new Set<XtbSettings["optLevel"]>(["loose", "normal", "tight", "verytight"]);
const XTB_SOLVATION_MODELS = new Set<XtbSettings["solvationModel"]>(["none", "alpb", "gbsa", "cosmo", "cpcmx"]);

export function readXtbSettings(): XtbSettings {
  try {
    const text = window.localStorage.getItem(XTB_SETTINGS_STORAGE_KEY);
    return migrateLegacyXtbMdDefaults(normalizeXtbSettings(text ? JSON.parse(text) : null));
  } catch (_) {
    return DEFAULT_XTB_SETTINGS;
  }
}

export function saveXtbSettings(settings: XtbSettings) {
  try {
    window.localStorage.setItem(XTB_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

export function normalizeXtbSettings(value: unknown): XtbSettings {
  const source = value && typeof value === "object" ? value as Partial<XtbSettings> : {};
  const method = XTB_METHODS.has(source.method as XtbSettings["method"]) ? source.method as XtbSettings["method"] : DEFAULT_XTB_SETTINGS.method;
  const optLevel = XTB_OPT_LEVELS.has(source.optLevel as XtbSettings["optLevel"]) ? source.optLevel as XtbSettings["optLevel"] : DEFAULT_XTB_SETTINGS.optLevel;
  const solvationModel = XTB_SOLVATION_MODELS.has(source.solvationModel as XtbSettings["solvationModel"]) ? source.solvationModel as XtbSettings["solvationModel"] : DEFAULT_XTB_SETTINGS.solvationModel;
  const solvent = typeof source.solvent === "string" && source.solvent.trim() ? source.solvent.trim().toLowerCase() : DEFAULT_XTB_SETTINGS.solvent;
  const properties = source.properties && typeof source.properties === "object" ? source.properties : {};
  return {
    method,
    optLevel,
    solvationModel,
    solvent,
    charge: clampInteger(source.charge, -5, 5, DEFAULT_XTB_SETTINGS.charge),
    uhf: clampInteger(source.uhf, 0, 10, DEFAULT_XTB_SETTINGS.uhf),
    threads: clampInteger(source.threads, 0, 32, DEFAULT_XTB_SETTINGS.threads),
    accuracy: clampNumber(source.accuracy, 0.05, 10, DEFAULT_XTB_SETTINGS.accuracy),
    electronicTemperature: clampInteger(source.electronicTemperature, 50, 5000, DEFAULT_XTB_SETTINGS.electronicTemperature),
    properties: {
      dipole: booleanSetting((properties as Partial<XtbSettings["properties"]>).dipole, DEFAULT_XTB_SETTINGS.properties.dipole),
      wbo: booleanSetting((properties as Partial<XtbSettings["properties"]>).wbo, DEFAULT_XTB_SETTINGS.properties.wbo),
      population: booleanSetting((properties as Partial<XtbSettings["properties"]>).population, DEFAULT_XTB_SETTINGS.properties.population),
      molden: booleanSetting((properties as Partial<XtbSettings["properties"]>).molden, DEFAULT_XTB_SETTINGS.properties.molden),
      alpha: booleanSetting((properties as Partial<XtbSettings["properties"]>).alpha, DEFAULT_XTB_SETTINGS.properties.alpha),
      fod: booleanSetting((properties as Partial<XtbSettings["properties"]>).fod, DEFAULT_XTB_SETTINGS.properties.fod),
      esp: booleanSetting((properties as Partial<XtbSettings["properties"]>).esp, DEFAULT_XTB_SETTINGS.properties.esp),
      fukui: booleanSetting((properties as Partial<XtbSettings["properties"]>).fukui, DEFAULT_XTB_SETTINGS.properties.fukui),
    },
    mdTemperature: clampInteger(source.mdTemperature, 50, 2000, DEFAULT_XTB_SETTINGS.mdTemperature),
    mdTimePs: clampNumber(source.mdTimePs, 0.05, 100, DEFAULT_XTB_SETTINGS.mdTimePs),
    mdStepFs: clampNumber(source.mdStepFs, 0.1, 10, DEFAULT_XTB_SETTINGS.mdStepFs),
    mdSnapshots: clampInteger(source.mdSnapshots, 1, 1000, DEFAULT_XTB_SETTINGS.mdSnapshots),
    timeoutSeconds: clampInteger(source.timeoutSeconds, 30, 1200, DEFAULT_XTB_SETTINGS.timeoutSeconds),
    saveRunFiles: booleanSetting(source.saveRunFiles, DEFAULT_XTB_SETTINGS.saveRunFiles),
  };
}

function migrateLegacyXtbMdDefaults(settings: XtbSettings): XtbSettings {
  if (settings.mdTimePs === 0.2 && settings.mdSnapshots === 10) {
    return {
      ...settings,
      mdTimePs: DEFAULT_XTB_SETTINGS.mdTimePs,
      mdSnapshots: DEFAULT_XTB_SETTINGS.mdSnapshots,
    };
  }
  return settings;
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

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function xtbOperationLabel(operation: XtbOperation) {
  switch (operation) {
    case "optimize":
      return "xTB Optimize";
    case "properties":
      return "xTB Properties";
    case "cube":
      return "xTB Density Cube";
    case "hessian":
      return "xTB Hessian";
    case "optimized-hessian":
      return "xTB Optimized Hessian";
    case "vip":
      return "xTB Ionization Potential";
    case "vea":
      return "xTB Electron Affinity";
    case "vipea":
      return "xTB IP/EA";
    case "vfukui":
      return "xTB Fukui";
    case "vomega":
      return "xTB Electrophilicity";
    case "md":
      return "xTB MD";
    case "metadyn":
      return "xTB Metadynamics";
  }
}

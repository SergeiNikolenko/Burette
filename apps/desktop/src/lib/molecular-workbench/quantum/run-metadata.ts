import type { CalculationMetadata } from '../scientific-types';

const clip = (value: string) => value.replace(/\s+/gu, ' ').trim().slice(0, 512);

/**
 * ORCA's banner version, the echoed `!` keyword lines, the basis it reports, the charge and
 * multiplicity of the first SCF setup, the termination banner and `TOTAL RUN TIME`.
 */
export function orcaMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const keywords: string[] = [];
  for (const line of lines) {
    let match = line.match(/^\s*Program Version\s+(\S+)/u);
    if (match && !metadata.program) { metadata.program = `ORCA ${match[1]}`; continue; }
    match = line.match(/^\|\s*\d+>\s*!\s*(.*)$/u);
    if (match) { if (match[1].trim()) keywords.push(match[1]); continue; }
    match = line.match(/^Your calculation utilizes the basis:\s*(.+)$/u);
    if (match && !metadata.basis) { metadata.basis = clip(match[1]); continue; }
    match = line.match(/^\s*Total Charge\s+Charge\s+\.{3,}\s*(-?\d+)\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); continue; }
    match = line.match(/^\s*Multiplicity\s+Mult\s+\.{3,}\s*(\d+)\s*$/u);
    if (match && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]); continue; }
    if (/\*{4}ORCA TERMINATED NORMALLY\*{4}/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/ORCA finished by error termination|aborting the run/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^TOTAL RUN TIME:\s*(\d+) days (\d+) hours (\d+) minutes (\d+) seconds (\d+) msec/u);
    if (match) metadata.runSeconds = ((Number(match[1]) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4]) + Number(match[5]) / 1000;
  }
  if (keywords.length) metadata.keywords = clip(keywords.join(' '));
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * xtb's banner version, its Hamiltonian with the command-line options (a GFN-FF run is named by
 * its --gfnff option), the net charge and unpaired electrons, the termination line and the total
 * wall time.
 */
export function xtbMetadata(lines: readonly string[], forceField: boolean): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  let hamiltonian: string | undefined, options: string | undefined, total = false;
  for (const line of lines) {
    let match = line.match(/^\s*\* xtb version (\S+)/u);
    if (match && !metadata.program) { metadata.program = `xtb ${match[1]}`; continue; }
    match = line.match(/^\s*program call\s*:\s*\S+\s+(.*)$/u);
    // The first argument is the coordinate file; the rest are the job's options.
    if (match && options === undefined) { options = match[1].trim().split(/\s+/u).filter((token, k) => k > 0 || token.startsWith('-')).join(' '); continue; }
    match = line.match(/^\s*:\s*Hamiltonian\s+(\S+)\s*:\s*$/u);
    if (match && !forceField) { hamiltonian ??= match[1]; continue; }
    match = line.match(/^\s*:\s*net charge\s+(-?\d+)\s*:\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); continue; }
    match = line.match(/^\s*:\s*unpaired electrons\s+(\d+)\s*:\s*$/u);
    if (match && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]) + 1; continue; }
    if (/^\s*normal termination of xtb\s*$/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/^\s*abnormal termination of xtb\s*$/u.test(line)) { metadata.termination = 'error'; continue; }
    if (/^\s*total:\s*$/u.test(line)) { total = true; continue; }
    match = total ? line.match(/^\s*\* wall-time:\s*(\d+) d,\s*(\d+) h,\s*(\d+) min,\s*(\S+) sec\s*$/u) : null;
    if (match) { metadata.runSeconds = ((Number(match[1]) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4]); total = false; }
  }
  const keywords = [hamiltonian, options].filter(Boolean).join(' ');
  if (keywords) metadata.keywords = clip(keywords);
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * Q-Chem's banner version, the method and job type of the first `$rem` block with its basis,
 * the charge and multiplicity of the first `$molecule`, the closing banner and the last job time.
 */
export function qchemMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const rem = new Map<string, string>();
  let block: 'rem' | 'molecule' | undefined, remDone = false;
  for (const line of lines) {
    let match = line.match(/^\s*Q-Chem (\d[\w.]*) for /u);
    if (match && !metadata.program) { metadata.program = `Q-Chem ${match[1]}`; continue; }
    match = line.match(/^\s*\$(rem|molecule)\s*$/iu);
    if (match) { block = match[1].toLowerCase() as 'rem' | 'molecule'; continue; }
    if (/^\s*\$end\s*$/iu.test(line)) { if (block === 'rem') remDone = true; block = undefined; continue; }
    if (block === 'rem' && !remDone) {
      match = line.match(/^\s*(\w+)\s*(?:=\s*|\s+)(\S+)/u);
      if (match && !rem.has(match[1].toLowerCase())) rem.set(match[1].toLowerCase(), match[2]);
      continue;
    }
    if (block === 'molecule') {
      match = line.match(/^\s*([+-]?\d+)\s+(\d+)\s*$/u);
      if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); metadata.multiplicity = Number(match[2]); }
      block = undefined;
      continue;
    }
    if (/Thank you very much for using Q-Chem/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/Q-Chem fatal error/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^\s*Total job time:\s*([\d.]+)s\(wall\)/u);
    if (match) metadata.runSeconds = Number(match[1]);
  }
  const method = rem.get('method') ?? [rem.get('exchange'), rem.get('correlation')].filter(Boolean).join(' ');
  const jobType = rem.get('jobtype');
  const keywords = [method, jobType && !/^sp$/iu.test(jobType) ? jobType : ''].filter(Boolean).join(' ');
  if (keywords) metadata.keywords = clip(keywords);
  if (rem.has('basis')) metadata.basis = clip(rem.get('basis')!);
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * Gaussian's banner version and revision, the first route section (Gaussian wraps it at 70
 * columns mid-token, so the lines join without spaces), the first standard basis, charge and
 * multiplicity, the last link's termination and the elapsed time summed over the links.
 */
export function gaussianMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  let route: string | undefined, inRoute = false, elapsed: number | undefined;
  for (const line of lines) {
    if (inRoute) {
      if (/^\s*-+\s*$/u.test(line)) inRoute = false; else route += line.replace(/^ /u, '');
      continue;
    }
    let match = line.match(/^ Gaussian (\d+):\s+\S*?G\d+Rev([A-Z]\.\d+)/u);
    if (match && !metadata.program) { metadata.program = `Gaussian ${match[1]} Rev. ${match[2]}`; continue; }
    if (route === undefined && metadata.program && /^ #/u.test(line)) { route = line.slice(1); inRoute = true; continue; }
    match = line.match(/^ Standard basis:\s*(\S+)/u);
    if (match && !metadata.basis) { metadata.basis = clip(match[1]); continue; }
    match = line.match(/^ Charge =\s*(-?\d+) Multiplicity =\s*(\d+)/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); metadata.multiplicity = Number(match[2]); continue; }
    if (/^ Normal termination of Gaussian/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/^ Error termination/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^ Elapsed time:\s*(\d+) days\s+(\d+) hours\s+(\d+) minutes\s+([\d.]+) seconds/u);
    if (match) elapsed = (elapsed ?? 0) + ((Number(match[1]) * 24 + Number(match[2])) * 60 + Number(match[3])) * 60 + Number(match[4]);
  }
  if (route) metadata.keywords = clip(route);
  if (elapsed !== undefined) metadata.runSeconds = Number(elapsed.toFixed(3));
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * Psi4's banner version, the driver calls of the echoed input (absent for a Python API run),
 * the first orbital basis, the charge and multiplicity of the first geometry, the exit line and
 * the wall time for execution.
 */
export function psi4Metadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const calls: string[] = [];
  let input: 'before' | 'header' | 'open' | 'done' = 'before';
  for (const line of lines) {
    if (input === 'header' || input === 'open') {
      if (/^\s*-{20,}\s*$/u.test(line)) { input = input === 'header' ? 'open' : 'done'; continue; }
      if (input === 'open' && /^\s*(?:\w+\s*(?:,\s*\w+\s*)*=\s*)?(?:psi4\.)?(?:energy|optimize|opt|frequency|frequencies|freq|gradient|hessian|properties|prop)\s*\(/u.test(line)) calls.push(line.trim());
      continue;
    }
    if (input === 'before' && /^\s*==> Input File <==\s*$/u.test(line)) { input = 'header'; continue; }
    // `Psi4 1.7 release`; development builds print `Psi4 1.1rc3.dev5`.
    let match = line.match(/^\s+Psi4 (\d[\w.]*)(?: release)?\s*$/u);
    if (match && !metadata.program) { metadata.program = `Psi4 ${match[1]}`; continue; }
    match = line.match(/^\s*Basis Set: ([^(\s].*?)\s*$/u);
    if (match && !metadata.basis) { metadata.basis = clip(match[1]); continue; }
    match = line.match(/^\s*Geometry \(in (?:Angstrom|Bohr)\), charge = (-?\d+), multiplicity = (\d+):\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); metadata.multiplicity = Number(match[2]); continue; }
    if (/^\*\*\* Psi4 exiting successfully/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/^\s*(?:PsiException:|Psi4 encountered an error)/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^\s*Psi4 wall time for execution:\s*(\d+):(\d+):([\d.]+)\s*$/u);
    if (match) metadata.runSeconds = (Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3]);
  }
  if (calls.length) metadata.keywords = clip(calls.join('; '));
  return Object.keys(metadata).length ? metadata : undefined;
}

/**
 * NWChem's version, the methods its modules ran (the SCF wavefunction, the DFT functional, then
 * correlated modules), the first basis description, the charge and multiplicity of the first
 * SCF or DFT setup, the termination (an error prints the failing input line) and the total wall time.
 */
export function nwchemMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const methods: string[] = [];
  let module: string | undefined, alpha: number | undefined, basisTable = false;
  const add = (method: string) => { if (!methods.includes(method)) methods.push(method); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match = line.match(/\(NWChem\) (\d[\w.]*)\s*$/u);
    if (match && !metadata.program) { metadata.program = `NWChem ${match[1]}`; continue; }
    match = line.match(/^\s*NWChem (.+?) Module\s*$/u);
    if (match) {
      module = match[1];
      if (/^MP2\b/u.test(module)) add('MP2');
      else if (/^(?:CCSD|TCE|Tensor Contraction Engine)/u.test(module)) add(module.split(/\s/u)[0]);
      continue;
    }
    match = line.match(/^\s*wavefunction\s*=\s*(\w+)\s*$/u);
    if (match && module === 'SCF') { add(match[1]); continue; }
    match = line.match(/^\s*(\S+) Method XC (?:Potential|Functional)\s*$/u);
    if (match && module === 'DFT') { add(match[1]); continue; }
    if (/^\s*Tag\s+Description\s+Shells\s+Functions and Types\s*$/u.test(line)) { basisTable = !metadata.basis; continue; }
    if (basisTable) {
      match = line.match(/^\s*[A-Za-z]\w*\s+(\S+)\s+\d+\s+\d+\s+\S+\s*$/u);
      if (match) { metadata.basis = clip(match[1]); basisTable = false; }
      else if (!/^[\s-]+$/u.test(line)) basisTable = false;
      continue;
    }
    match = line.match(/^\s*alpha electrons\s*=\s*(\d+)\s*$/u);
    if (match && metadata.multiplicity === undefined) { alpha = Number(match[1]); continue; }
    match = line.match(/^\s*beta\s+electrons\s*=\s*(\d+)\s*$/u);
    if (match && alpha !== undefined && metadata.multiplicity === undefined) { metadata.multiplicity = alpha - Number(match[1]) + 1; continue; }
    match = line.match(/^\s*open shells\s*=\s*(\d+)\s*$/u);
    if (match && module === 'SCF' && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]) + 1; continue; }
    match = line.match(/^\s*Spin multiplicity:\s*(\d+)\s*$/u);
    if (match && metadata.multiplicity === undefined) { metadata.multiplicity = Number(match[1]); continue; }
    // SCF prints `charge = 0.00`, DFT `Charge : 0`.
    match = line.match(/^\s*charge\s*=\s*(-?\d+)\.0+\s*$/u) ?? line.match(/^\s*Charge\s*:\s*(-?\d+)\s*$/u);
    if (match && metadata.charge === undefined) { metadata.charge = Number(match[1]); continue; }
    if (/^\s*current input line :\s*$/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^\s*Total times\s+cpu:\s*\S+s\s+wall:\s*([\d.]+)s\s*$/u);
    if (match) { metadata.runSeconds = Number(match[1]); metadata.termination ??= 'normal'; }
  }
  if (methods.length) metadata.keywords = clip(methods.join(' '));
  return Object.keys(metadata).length ? metadata : undefined;
}

const GAMESS_KEYS = ['SCFTYP', 'RUNTYP', 'DFTTYP', 'TDDFT', 'MPLEVL', 'CITYP', 'CCTYP'];
const GAMESS_SEMIEMPIRICAL = /^(?:AM1|PM3|PM6|MNDO|RM1|DFTB)$/u;
const GAMESS_CC = /^(A?)CC([DTQ56])(C?)$/u;

/** GAMESS names its basis by family and Gaussian count; the common Pople and Dunning sets get their usual names. */
function gamessBasis(options: Map<string, string>): string | undefined {
  const family = options.get('GBASIS');
  if (!family || GAMESS_SEMIEMPIRICAL.test(family)) return undefined;
  const gaussians = options.get('IGAUSS') ?? '';
  const cc = family.match(GAMESS_CC);
  if (cc) return `${cc[1] ? 'aug-' : ''}cc-p${cc[3] ? 'C' : ''}V${cc[2]}Z`;
  const pople = { STO: `STO-${gaussians}G`, N21: '3-21G', N31: `${gaussians}-31G`, N311: '6-311G' }[family];
  if (!pople) return family;
  if (family === 'STO') return pople;
  const diffuse = options.get('DIFFSP') === 'T' ? options.get('DIFFS') === 'T' ? '++' : '+' : '';
  const d = Number(options.get('NDFUNC') ?? 0), p = Number(options.get('NPFUNC') ?? 0), f = Number(options.get('NFFUNC') ?? 0);
  const heavy = d ? `${d > 1 ? d : ''}d${f ? 'f' : ''}` : '';
  const polarization = heavy || p ? `(${[heavy, p ? `${p > 1 ? p : ''}p` : ''].filter(Boolean).join(',')})` : '';
  return pople.replace(/G$/u, `${diffuse}G${polarization}`);
}

/**
 * GAMESS (or Firefly) version, the method keywords and basis from the printed option tables
 * (the input echo is skipped), ICHARG and MULT, the termination line and the last wall clock time.
 */
export function gamessMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const options = new Map<string, string>();
  for (const line of lines) {
    let match = line.match(/GAMESS VERSION = (.+?)\s*\*/u) ?? line.match(/^\s*\*\s*Firefly version ([\w.]+)/u);
    if (match && !metadata.program && !/BASED ON/u.test(line)) { metadata.program = `${/Firefly/u.test(line) ? 'Firefly' : 'GAMESS'} ${match[1]}`; continue; }
    if (/^\s*INPUT CARD>/u.test(line)) continue;
    for (const [, key, value] of line.matchAll(/\b(SCFTYP|RUNTYP|DFTTYP|TDDFT|MPLEVL|CITYP|CCTYP|GBASIS|IGAUSS|NDFUNC|NPFUNC|NFFUNC|DIFFSP|DIFFS|ICHARG|MULT)\s*=\s*(-?[\w.]+)/gu)) {
      if (!options.has(key)) options.set(key, value);
    }
    if (/EXECUTION OF (?:GAMESS|FIREFLY) TERMINATED NORMALLY/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/EXECUTION OF (?:GAMESS|FIREFLY) TERMINATED -?ABNORMALLY/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/TOTAL WALL CLOCK TIME=\s*([\d.]+) SECONDS/u);
    if (match) metadata.runSeconds = Number(match[1]);
  }
  const keywords = GAMESS_KEYS.flatMap(key => {
    const value = options.get(key);
    return !value || value === 'NONE' || (key === 'MPLEVL' && value === '0') ? [] : [`${key}=${value}`];
  });
  const family = options.get('GBASIS');
  if (family && GAMESS_SEMIEMPIRICAL.test(family)) keywords.push(`GBASIS=${family}`);
  if (keywords.length) metadata.keywords = clip(keywords.join(' '));
  const basis = gamessBasis(options);
  if (basis) metadata.basis = basis;
  if (options.has('ICHARG')) metadata.charge = Number(options.get('ICHARG'));
  if (options.has('MULT')) metadata.multiplicity = Number(options.get('MULT'));
  return Object.keys(metadata).length ? metadata : undefined;
}

const MOLPRO_SETUP_PROGRAMS = new Set(['SEWARD', 'MATROP', 'POP', 'PROPERTY', 'GRID']);

/**
 * Molpro's version, the programs the input ran (integrals and analysis left out), the basis it
 * set, the charge and multiplicity from the first SCF's electron count, the termination and the
 * last cumulative real time.
 */
export function molproMetadata(lines: readonly string[]): CalculationMetadata | undefined {
  const metadata: CalculationMetadata = {};
  const programs: string[] = [];
  let nuclear: number | undefined, last = '';
  for (const line of lines) {
    if (line.trim()) last = line.trim();
    let match = line.match(/^\s+Version (\d[\w.]*) linked/u);
    if (match && !metadata.program) { metadata.program = `Molpro ${match[1]}`; continue; }
    match = line.match(/^1?\s*PROGRAM \* (\S+)/u);
    if (match) { if (!MOLPRO_SETUP_PROGRAMS.has(match[1]) && !programs.includes(match[1])) programs.push(match[1]); continue; }
    match = line.match(/^\s*SETTING BASIS\s*=\s*(\S+)/u);
    if (match && !metadata.basis) { metadata.basis = clip(match[1]); continue; }
    match = line.match(/^\s*NUCLEAR CHARGE:\s*(\d+)\s*$/u);
    if (match && nuclear === undefined) { nuclear = Number(match[1]); continue; }
    match = line.match(/^\s*NUMBER OF ELECTRONS:\s*(\d+)\+\s*(\d+)-/u);
    if (match && metadata.multiplicity === undefined) {
      const alpha = Number(match[1]), beta = Number(match[2]);
      metadata.multiplicity = alpha - beta + 1;
      if (nuclear !== undefined) metadata.charge = nuclear - alpha - beta;
      continue;
    }
    if (/^\s*Molpro calculation terminated\s*$/u.test(line)) { metadata.termination = 'normal'; continue; }
    if (/^\s*\?\s*Error\b|GLOBAL ERROR/u.test(line)) { metadata.termination = 'error'; continue; }
    match = line.match(/^\s*REAL TIME\s*\*\s*([\d.]+) SEC/u);
    if (match) metadata.runSeconds = Number(match[1]);
  }
  // Molpro 2012 ends a finished run with the memory release line instead of a banner.
  if (!metadata.termination && last === 'Variable memory released') metadata.termination = 'normal';
  if (programs.length) metadata.keywords = clip(programs.join(' '));
  return Object.keys(metadata).length ? metadata : undefined;
}

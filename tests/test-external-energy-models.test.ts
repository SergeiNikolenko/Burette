import { expect, mock, test } from 'bun:test';

// A stand-in for the native energy_models commands: a harmonic well at the origin,
// energies already converted to kcal/mol as the native module returns them.
type Args = Record<string, any>;
let calls: [string, Args | undefined][] = [];
let delay = 0;
const sessions = new Map<string, Args>();
const listed = [
  { id: 'avogadro:avogadro-harmonic-energy/harmonic-binary', name: 'Harmonic (binary)', description: '', source: 'avogadro-harmonic-energy', inputFormat: 'cjson',
    gradients: true, ions: true, radicals: false, unitCell: false, batch: false, elements: [1, 6, 7, 8], unavailable: null },
  { id: 'xtb:gfn2', name: 'GFN2-xTB', description: '', source: 'xtb', inputFormat: null, gradients: true, ions: true, radicals: true, unitCell: false, batch: false,
    elements: Array.from({ length: 86 }, (_, i) => i + 1), unavailable: null },
  { id: 'avogadro:pending/model', name: 'Pending', description: '', source: 'pending', inputFormat: 'xyz', gradients: true, ions: true, radicals: true, unitCell: false, batch: false,
    elements: [6], unavailable: 'Set up pending in Settings › Extensions first' },
  { id: 'avogadro:pending/energy-only', name: 'Energy only', description: '', source: 'pending', inputFormat: 'pdb', gradients: false, ions: true, radicals: true, unitCell: false, batch: false,
    elements: [6], unavailable: null },
  // Energies only, one coordinate set or a whole batch per request.
  { id: 'avogadro:avogadro-harmonic-energy/harmonic-energy', name: 'Harmonic (energy)', description: '', source: 'avogadro-harmonic-energy', inputFormat: 'xyz',
    gradients: false, ions: true, radicals: false, unitCell: false, batch: false, elements: [1, 6, 7, 8], unavailable: null },
  { id: 'avogadro:avogadro-harmonic-energy/harmonic-batch', name: 'Harmonic (batch)', description: '', source: 'avogadro-harmonic-energy', inputFormat: 'cjson',
    gradients: false, ions: true, radicals: false, unitCell: false, batch: true, elements: [1, 6, 7, 8], unavailable: null },
];
const harmonic = (x: number[]) => x.reduce((sum, v) => sum + v * v, 0);
async function native(command: string, args?: Args): Promise<unknown> {
  calls.push([command, args]);
  if (command === 'energy_models_list') return listed;
  if (command === 'energy_model_open') { const id = `session-${sessions.size + 1}`; sessions.set(id, args!.request); return id; }
  if (command === 'energy_model_close') { sessions.delete(args!.session); return null; }
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const x: number[] = args!.coordinates;
  if (command === 'energy_model_evaluate_batch') {
    const size = 3 * sessions.get(args!.session)!.elements.length;
    return Array.from({ length: x.length / size }, (_, i) => harmonic(x.slice(i * size, (i + 1) * size)));
  }
  return { energy: harmonic(x), gradient: x.map(v => 2 * v) };
}
mock.module('@tauri-apps/api/core', () => ({ invoke: native }));

const models = await import('../apps/desktop/src/lib/molecular-workbench/external-energy-models');
const { optimizeWithEnergyModel } = await import('../apps/desktop/src/lib/molecular-workbench/optimize-with-model');
const { modelBootstrap, chargeAndMultiplicity } = await import('../apps/desktop/src/lib/molecular-workbench/external-energy-input');
const { generateFromSmiles } = await import('../apps/desktop/src/lib/molecular-workbench/chemistry');
const { sourceAtomPositions } = await import('../apps/desktop/src/lib/molecular-workbench/molfile-positions');
const HARMONIC = 'avogadro:avogadro-harmonic-energy/harmonic-binary';

test('listed external models carry names, element symbols and the reason they cannot run', async () => {
  await models.refreshExternalEnergyModels(native as never);
  expect(models.energyModelName('xtb:gfn2')).toBe('GFN2-xTB');
  expect(models.energyModelName('MMFF94')).toBe('MMFF94');
  const harmonic = models.externalEnergyModel(HARMONIC)!;
  expect([...harmonic.elements]).toEqual(['H', 'C', 'N', 'O']);
  const carbon = [{ element: 'C' }];
  expect(models.externalModelUnavailable(models.externalEnergyModel('avogadro:pending/model')!, carbon)).toContain('Set up pending');
  expect(models.externalModelUnavailable(models.externalEnergyModel('avogadro:pending/energy-only')!, carbon)).toBe('Energy only reads PDB, which Burette does not write.');
  const energyOnly = models.externalEnergyModel('avogadro:avogadro-harmonic-energy/harmonic-energy')!;
  expect(models.externalModelUnavailable(energyOnly, carbon)).toBeNull();
  expect(models.externalModelUnavailable(energyOnly, Array.from({ length: 65 }, () => ({ element: 'C' })))).toBe('Harmonic (energy) gives no gradients; numerical optimization supports up to 64 atoms.');
  expect(models.externalModelUnavailable(harmonic, [{ element: 'Sn' }])).toBe('Harmonic (binary) has no parameters for Sn.');
  expect(models.externalModelUnavailable(models.externalEnergyModel('xtb:gfn2')!, [{ element: 'Sn' }])).toBeNull();
});

test('external optimization runs the shared minimizer over one native session and closes it', async () => {
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  const ethanol = generateFromSmiles('CCO'), progress: number[] = [];
  const result = await optimizeWithEnergyModel(ethanol, HARMONIC, { method: 'lbfgs', maxIterations: 200, constraints: [{ kind: 'freeze', atoms: [0] }] },
    { onProgress: step => progress.push(step.energy) });
  expect([result.forceField, result.method, result.gradient, result.converged, result.stopReason]).toEqual([HARMONIC, 'lbfgs', 'analytic', true, 'converged']);
  expect(result.molecule.atoms[0]).toEqual(ethanol.atoms[0]);
  // Every other atom falls into the well; the frozen one keeps the energy above zero.
  expect(result.molecule.atoms.slice(1).every(atom => Math.hypot(atom.x, atom.y, atom.z) < 1e-3)).toBe(true);
  expect(result.energy).toBeCloseTo(Math.hypot(ethanol.atoms[0].x, ethanol.atoms[0].y, ethanol.atoms[0].z) ** 2, 6);
  expect(progress.length).toBe(result.iterations);
  // The molfile follows the optimized atoms through the atom map.
  const map = result.molecule.atomMap ?? result.molecule.atoms.map((_, i) => i), positions = sourceAtomPositions(result.molecule.molfile);
  result.molecule.atoms.forEach((atom, i) => [atom.x, atom.y, atom.z].forEach((value, axis) => expect(positions[map[i]][axis]).toBeCloseTo(value, 9)));
  const opened = calls.filter(([command]) => command === 'energy_model_open').map(([, args]) => args!.request);
  expect(opened).toHaveLength(1);
  expect([opened[0].model, opened[0].elements, opened[0].charge, opened[0].multiplicity]).toEqual([HARMONIC, ethanol.atoms.map(atom => atom.element), 0, 1]);
  const bootstrap = JSON.parse(opened[0].bootstrap);
  expect(bootstrap.cjson.atoms.elements.number).toEqual(ethanol.atoms.map(atom => ({ C: 6, O: 8, H: 1 })[atom.element]));
  expect(bootstrap.cjson.bonds.order).toHaveLength(ethanol.bonds.length);
  expect(calls.filter(([command]) => command === 'energy_model_close')).toHaveLength(1);
  expect(sessions.size).toBe(0);
});

test('models without gradients are differenced from energies, skipping frozen atoms, and a batch model takes one request per point', async () => {
  await models.refreshExternalEnergyModels(native as never);
  const ethanol = generateFromSmiles('CCO'), n = ethanol.atoms.length;
  for (const [id, command] of [['avogadro:avogadro-harmonic-energy/harmonic-energy', 'energy_model_evaluate'], ['avogadro:avogadro-harmonic-energy/harmonic-batch', 'energy_model_evaluate_batch']] as const) {
    calls = [];
    const result = await optimizeWithEnergyModel(ethanol, id, { method: 'lbfgs', maxIterations: 200, constraints: [{ kind: 'freeze', atoms: [0] }] });
    expect([result.gradient, result.converged]).toEqual(['central-difference', true]);
    expect(result.molecule.atoms[0]).toEqual(ethanol.atoms[0]);
    expect(result.energy).toBeCloseTo(harmonic([ethanol.atoms[0].x, ethanol.atoms[0].y, ethanol.atoms[0].z]), 6);
    const requests = calls.filter(([name]) => name.startsWith('energy_model_evaluate'));
    expect(new Set(requests.map(([name]) => name))).toEqual(new Set([command]));
    // Each point costs the point and ± steps of the 3(n − 1) moving coordinates.
    const points = command === 'energy_model_evaluate' ? requests.length / (1 + 6 * (n - 1)) : requests.length;
    expect(Number.isInteger(points) && points > 1).toBe(true);
    if (command === 'energy_model_evaluate_batch') expect(requests.every(([, args]) => args!.coordinates.length === 3 * n * (1 + 6 * (n - 1)))).toBe(true);
  }
  expect(sessions.size).toBe(0);
});

test('unsupported charge or spin never opens a session, and Cancel closes the running one', async () => {
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  await expect(optimizeWithEnergyModel(generateFromSmiles('[CH3]'), HARMONIC)).rejects.toThrow('does not accept radicals');
  expect(calls.some(([command]) => command === 'energy_model_open')).toBe(false);
  await expect(optimizeWithEnergyModel(generateFromSmiles('CCO'), 'avogadro:avogadro-harmonic-energy/gone')).rejects.toThrow('no longer available');
  delay = 5;
  const controller = new AbortController();
  const run = optimizeWithEnergyModel(generateFromSmiles('CCO'), HARMONIC, { method: 'fire', maxIterations: 500 }, { signal: controller.signal, onProgress: () => controller.abort() });
  await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  delay = 0;
  expect(calls.filter(([command]) => command === 'energy_model_close')).toHaveLength(1);
  expect(sessions.size).toBe(0);
});

test('Calculate Energy evaluates once over its own session, and a saved external choice survives the settings store', async () => {
  const { energyWithModel } = await import('../apps/desktop/src/lib/molecular-workbench/optimize-with-model');
  const settings = await import('../apps/desktop/src/lib/workbench/optimizer-settings');
  await models.refreshExternalEnergyModels(native as never);
  calls = [];
  const ethanol = generateFromSmiles('CCO');
  expect(await energyWithModel(ethanol, HARMONIC)).toEqual({ model: HARMONIC, energy: ethanol.atoms.reduce((sum, atom) => sum + atom.x ** 2 + atom.y ** 2 + atom.z ** 2, 0) });
  expect(calls.map(([command]) => command)).toEqual(['energy_model_open', 'energy_model_evaluate', 'energy_model_close']);
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } as never;
  settings.updateOptimizerSettings({ model: HARMONIC });
  expect(settings.optimizerSettings().model).toBe(HARMONIC);
  settings.updateOptimizerSettings({ model: 'GAFF' as never });
  expect(settings.optimizerSettings().model).toBe('auto');
});

test('start-up input keeps structure atom order, formal charges and the electron-count spin', () => {
  const methylammonium = generateFromSmiles('C[NH3+]');
  expect(chargeAndMultiplicity(methylammonium)).toEqual({ charge: 1, multiplicity: 1 });
  expect(chargeAndMultiplicity(generateFromSmiles('[CH3]'))).toEqual({ charge: 0, multiplicity: 2 });
  const elements = methylammonium.atoms.map(atom => atom.element);
  const sdf = JSON.parse(modelBootstrap(methylammonium, 'sdf', 1, 1));
  expect([sdf.charge, sdf.spin, sdf.selectedAtoms, sdf.options]).toEqual([1, 1, [], {}]);
  expect(sdf.sdf.split('\n').slice(4, 4 + elements.length).map((row: string) => row.slice(31, 34).trim())).toEqual(elements);
  expect(sdf.sdf).toContain(`M  CHG  1 ${String(elements.indexOf('N') + 1).padStart(3)}   1`);
  const cml = JSON.parse(modelBootstrap(methylammonium, 'cml', 1, 1)).cml as string;
  expect(cml.match(/elementType="(\w+)"/gu)!.map(attribute => attribute.slice(13, -1))).toEqual(elements);
  expect(cml).toContain('formalCharge="1"');
  const xyz = JSON.parse(modelBootstrap(methylammonium, 'xyz', 1, 1)).xyz as string;
  expect(xyz.split('\n').slice(2, -1).map(row => row.split(' ')[0])).toEqual(elements);
  const mdl = JSON.parse(modelBootstrap(methylammonium, 'mdl', 1, 1));
  expect(Object.keys(mdl)).toContain('mdl');
  const cjson = JSON.parse(modelBootstrap(methylammonium, 'cjson', 1, 1)).cjson;
  expect([cjson.properties, cjson.atoms.formalCharges.reduce((a: number, b: number) => a + b, 0)]).toEqual([{ totalCharge: 1, totalSpinMultiplicity: 1 }, 1]);
});

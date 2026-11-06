/** Energy models the desktop shell runs as external programs (xTB and installed
 * Avogadro packages), listed at runtime beside the built-in ones. The browser
 * shell has none. Sessions run in the native command module
 * src-tauri/src/commands/energy_models; see docs/graph-editing-and-properties.md. */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useSyncExternalStore } from 'react';
import { isTauriRuntime } from '../tauri';
import { ELEMENT_SYMBOLS, ENERGY_MODELS, energyModel, energyModelUnavailable, isExternalEnergyModelId } from './energy-models';
import { MODEL_INPUT_FORMATS, chargeAndMultiplicity, modelBootstrap, type ModelInputFormat } from './external-energy-input';
import type { MolecularStructure } from './molecular-graph';
import { OPTIMIZATION_LIMITS, type AsyncEnergyEvaluator } from './optimization';
import type { EnergyModelId, ExternalEnergyModelId, MolecularAtom, Vec3 } from './types';

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) => invoke(command, args);

export type ExternalEnergyModel = {
  id: ExternalEnergyModelId; name: string; description: string;
  /** `xtb`, or the Avogadro package that declares the model. */
  source: string;
  /** The molecule format an Avogadro model reads at start-up. */
  inputFormat?: string;
  gradients: boolean; ions: boolean; radicals: boolean;
  /** Energies of many coordinate sets per request (binary-v1 `support.batch`). */
  batch: boolean;
  elements: ReadonlySet<string>;
  /** Why it cannot run yet, such as a package that is not set up. */
  unavailable?: string;
};
type NativeModel = Omit<ExternalEnergyModel, 'elements' | 'unavailable' | 'inputFormat'> & { elements: number[]; inputFormat: string | null; unavailable: string | null; unitCell: boolean };

let models: readonly ExternalEnergyModel[] = [];
let pending: Promise<readonly ExternalEnergyModel[]> | null = null;
const listeners = new Set<() => void>();

/** Lists the external models again; one request at a time. */
export function refreshExternalEnergyModels(native: Call = call): Promise<readonly ExternalEnergyModel[]> {
  if (!isTauriRuntime() && native === call) return Promise.resolve(models);
  pending ??= native<NativeModel[]>('energy_models_list').then(list => {
    models = list.filter(model => isExternalEnergyModelId(model.id)).map(({ elements, inputFormat, unavailable, unitCell: _, ...model }) => ({
      ...model, elements: new Set(elements.map(z => ELEMENT_SYMBOLS[z - 1]).filter(Boolean)),
      ...(inputFormat ? { inputFormat } : {}), ...(unavailable ? { unavailable } : {}),
    }));
    listeners.forEach(listener => listener());
    return models;
  }).catch(() => models).finally(() => { pending = null; });
  return pending;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The external models, refreshed whenever a consumer mounts (a package may have
 * been set up since). Empty outside the desktop shell. */
export function useExternalEnergyModels(): readonly ExternalEnergyModel[] {
  useEffect(() => { void refreshExternalEnergyModels(); }, []);
  return useSyncExternalStore(subscribe, () => models, () => models);
}

export const externalEnergyModel = (id: string) => models.find(model => model.id === id);

/** Display name of any model; an external one as it was last listed. */
export function energyModelName(id: EnergyModelId): string {
  return isExternalEnergyModelId(id) ? externalEnergyModel(id)?.name ?? id : energyModel(id).name;
}

/** Why `model` cannot optimize these atoms, or null. Charge and spin are checked
 * once the structure is known, by `openExternalEnergyEvaluator`. */
export function externalModelUnavailable(model: ExternalEnergyModel, atoms: readonly Pick<MolecularAtom, 'element'>[]): string | null {
  if (model.unavailable) return model.unavailable;
  if (!model.gradients && atoms.length > OPTIMIZATION_LIMITS.numericalAtoms) return `${model.name} gives no gradients; numerical optimization supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms.`;
  if (model.inputFormat && !MODEL_INPUT_FORMATS.includes(model.inputFormat)) return `${model.name} reads ${model.inputFormat.toUpperCase()}, which Burette does not write.`;
  const missing = [...new Set(atoms.map(atom => atom.element))].filter(element => !model.elements.has(element));
  return missing.length ? `${model.name} has no parameters for ${missing.join(', ')}.` : null;
}

export type EnergyModelOption = { id: EnergyModelId; name: string; unavailable: string | null };

/** Every model a menu can offer for these elements: the built-in ones, then the
 * external ones unless `external` is false. */
export function useEnergyModelOptions(elements: readonly string[], { external = true } = {}): EnergyModelOption[] {
  const listed = useExternalEnergyModels(), atoms = elements.map(element => ({ element }));
  return [
    ...ENERGY_MODELS.map(model => ({ id: model.id, name: model.name, unavailable: energyModelUnavailable(model.id, atoms) })),
    ...(external ? listed.map(model => ({ id: model.id, name: model.name, unavailable: externalModelUnavailable(model, atoms) })) : []),
  ];
}

/** Central-difference step, Å. Avogadro differences with 2.2e-6 Å
 * (EnergyCalculator::finiteGradient); text-protocol models print energies with
 * few digits, which that step turns into noise, while 1e-4 Å keeps the
 * truncation error near 1e-8 of the gradient. */
const STEP = 1e-4;

/** Opens a native session for `structure`; dispose closes it, ending its process.
 * A model without gradients is differenced from energies, as Avogadro does; a
 * batch model answers the whole difference stencil in one request. */
export async function openExternalEnergyEvaluator(model: ExternalEnergyModel, structure: MolecularStructure, native: Call = call): Promise<AsyncEnergyEvaluator> {
  const reason = externalModelUnavailable(model, structure.atoms);
  if (reason) throw new Error(reason);
  const { charge, multiplicity } = chargeAndMultiplicity(structure);
  if (charge && !model.ions) throw new Error(`${model.name} does not accept charged structures.`);
  if (multiplicity !== 1 && !model.radicals) throw new Error(`${model.name} does not accept radicals.`);
  const bootstrap = model.inputFormat ? modelBootstrap(structure, model.inputFormat as ModelInputFormat, charge, multiplicity) : undefined;
  const elements = structure.atoms.map(atom => atom.element);
  const session = await native<string>('energy_model_open', { request: { model: model.id, elements, charge, multiplicity, ...(bootstrap ? { bootstrap } : {}) } });
  let closed = false;
  const single = (coordinates: number[]) =>
    native<{ energy: number | null; gradient: (number | null)[] | null }>('energy_model_evaluate', { session, coordinates });
  const energies = async (sets: number[][]): Promise<number[]> => {
    if (model.batch) return (await native<(number | null)[]>('energy_model_evaluate_batch', { session, coordinates: sets.flat() })).map(e => e ?? Number.NaN);
    // One at a time: the session answers in order, and closing it stops the rest.
    const values: number[] = [];
    for (const set of sets) values.push((await single(set)).energy ?? Number.NaN);
    return values;
  };
  return {
    numerical: !model.gradients,
    async evaluate(atoms, frozen = []) {
      if (atoms.length !== elements.length || atoms.some((atom, i) => atom.element !== elements[i])) throw new Error('Energy coordinates must preserve molecular atom identities.');
      const x = atoms.flatMap(atom => [atom.x, atom.y, atom.z]);
      if (model.gradients) {
        const value = await single(x);
        const gradient = value.gradient?.length === x.length ? value.gradient.map(v => v ?? Number.NaN) : x.map(() => Number.NaN);
        return { energy: value.energy ?? Number.NaN, gradient: atoms.map((_, i): Vec3 => [gradient[3 * i], gradient[3 * i + 1], gradient[3 * i + 2]]) };
      }
      // The point itself, then x ± h for every coordinate of every atom that moves.
      const fixed = new Set(frozen), stencil = x.flatMap((_, k) => fixed.has(Math.floor(k / 3)) ? [] : [k]);
      const shifted = (k: number, h: number) => x.map((v, j) => j === k ? v + h : v);
      const values = await energies([x, ...stencil.flatMap(k => [shifted(k, STEP), shifted(k, -STEP)])]);
      const gradient = x.map(() => 0);
      stencil.forEach((k, i) => { gradient[k] = (values[1 + 2 * i] - values[2 + 2 * i]) / (2 * STEP); });
      return { energy: values[0], gradient: atoms.map((_, i): Vec3 => [gradient[3 * i], gradient[3 * i + 1], gradient[3 * i + 2]]) };
    },
    async dispose() {
      if (closed) return;
      closed = true;
      await native('energy_model_close', { session }).catch(() => undefined);
    },
  };
}

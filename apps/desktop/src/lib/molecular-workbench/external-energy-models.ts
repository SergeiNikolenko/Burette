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
import type { AsyncEnergyEvaluator } from './optimization';
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
  if (!model.gradients) return `${model.name} provides no gradients.`;
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

/** Opens a native session for `structure`; dispose closes it, ending its process. */
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
  return {
    async evaluate(atoms) {
      if (atoms.length !== elements.length || atoms.some((atom, i) => atom.element !== elements[i])) throw new Error('Energy coordinates must preserve molecular atom identities.');
      const value = await native<{ energy: number | null; gradient: (number | null)[] | null }>('energy_model_evaluate', { session, coordinates: atoms.flatMap(atom => [atom.x, atom.y, atom.z]) });
      const gradient = value.gradient?.length === 3 * atoms.length ? value.gradient.map(v => v ?? Number.NaN) : atoms.flatMap(() => [Number.NaN, Number.NaN, Number.NaN]);
      return { energy: value.energy ?? Number.NaN, gradient: atoms.map((_, i): Vec3 => [gradient[3 * i], gradient[3 * i + 1], gradient[3 * i + 2]]) };
    },
    async dispose() {
      if (closed) return;
      closed = true;
      await native('energy_model_close', { session }).catch(() => undefined);
    },
  };
}

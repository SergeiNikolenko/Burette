import { atomicNumber } from '../elements';
import { checkScientificSpectra, type AdditionalSpectrum } from '../scientific-spectra';
import type { ScientificDocument } from '../scientific-types';

/** One printed excited state: its label, excitation energy, oscillator strength and transition dipole. */
export type ExcitedState = { label: string; energyEv: number; oscillatorStrength: number; transitionDipoleAu?: [number, number, number] };

/** The absorption spectrum of one printed excited-state table, in eV with the printed oscillator strengths. */
export function absorptionSpectrum(states: readonly ExcitedState[]): AdditionalSpectrum {
  const dipoles = states.every(state => state.transitionDipoleAu) ? states.map(state => state.transitionDipoleAu!) : undefined;
  return { kind: 'electronic', xUnit: 'eV', positions: states.map(state => state.energyEv), values: states.map(state => state.oscillatorStrength),
    valueUnit: null, sourceRowIds: states.map(state => state.label),
    ...(dipoles ? { auxiliary: (['TX', 'TY', 'TZ'] as const).map((name, axis) => ({ name, unit: 'au', values: dipoles.map(dipole => dipole[axis]) })) } : {}) };
}

/**
 * Puts each frame's excited-state spectra on that frame: the geometry they were computed at.
 * A later table of the same kind replaces an earlier one, as a program's final print does.
 */
export function withFrameSpectra(document: ScientificDocument, name: string, tables: readonly { frame: number; spectrum: AdditionalSpectrum }[]): ScientificDocument {
  if (!tables.length) return document;
  const sets = new Map<number, Map<AdditionalSpectrum['kind'], AdditionalSpectrum>>();
  for (const { frame, spectrum } of tables) {
    if (!sets.has(frame)) sets.set(frame, new Map());
    sets.get(frame)!.set(spectrum.kind, spectrum);
  }
  const frameCount = document.frames.length;
  return { ...document, frames: document.frames.map((frame, frameIndex) => {
    const spectra = sets.get(frameIndex);
    if (!spectra) return frame;
    return { ...frame, spectra: checkScientificSpectra({ kind: 'scientific-spectra', version: 1,
      source: { name, format: 'program-output', scope: 'frame', frameIndex, frameCount },
      atomicNumbers: frame.atoms.map(atom => atomicNumber(atom.element)), spectra: [...spectra.values()] }) };
  }) };
}

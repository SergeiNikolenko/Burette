import { validateScientificDocument } from "../science-session/scientific-document";
import type { ScientificDocument } from "./scientific-types";

/** Reuse the durable schema and aggregate budgets on data bound by a source reader. */
export function validateParsedSpectra(document: ScientificDocument): ScientificDocument {
  if (!document.spectra && !document.frames.some(frame => frame.spectra)) return document;
  // This is the geometry explicitly parsed from the source, not a viewer/current-frame guess.
  return validateScientificDocument(document, [{ elements: document.atoms.map(atom => atom.element),
    positions: Float64Array.from(document.atoms.flatMap(atom => [atom.x, atom.y, atom.z])) }]);
}

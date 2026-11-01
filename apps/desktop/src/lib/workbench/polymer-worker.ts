import { parseMolecule } from "../molecular-workbench/molecular-graph";
import { buildPolymer } from "../molecular-workbench/polymer";
import { sdfFromGraph, unsupportedAtomMetadata } from "./formats";
import type { PolymerInput, PolymerRequest } from "./polymer-task";

self.onmessage = ({ data }: MessageEvent<PolymerRequest | (PolymerInput & { action: "source" })>) => {
  try {
    const source = parseMolecule(data.text, data.format);
    const unsupported = unsupportedAtomMetadata(source.molfile);
    if (unsupported) throw new Error(`Polymer construction does not preserve ${unsupported}.`);
    if (data.action === "source") { self.postMessage({ ok: true, result: source }); return; }
    const graph = buildPolymer(source.atoms, source.bonds, data.options);
    self.postMessage({ ok: true, result: { sdf: sdfFromGraph(graph.atoms, graph.bonds, "Polymer"), atomCount: graph.atoms.length,
      bondCount: graph.bonds.length, sourceAtomIndices: graph.sourceAtomIndices, repeatIndices: graph.repeatIndices, repeatAlternatives: graph.repeatAlternatives } });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

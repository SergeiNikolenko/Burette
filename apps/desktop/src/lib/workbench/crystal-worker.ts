import init, { analyze_cell, hall_symbol_entry, operations_from_number } from "@spglib/moyo-wasm";
// Emitted as hashed assets and resolved relative to this worker, so they follow the Vite base.
import moyoWasmUrl from "@spglib/moyo-wasm/moyo_wasm_bg.wasm?url";
import niggliWasmUrl from "../molecular-workbench/symmetry/burette-niggli.wasm?url";
import { runCrystalRequest, type CrystalRequest } from "../molecular-workbench/crystal-symmetry-io";
import type { MoyoAnalyzer } from "../molecular-workbench/crystal-symmetry";
import { instantiateStandaloneWasm, type StandaloneWasm } from "../molecular-workbench/symmetry/wasm-module";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<CrystalRequest>) => void; postMessage: (message: unknown) => void };

let moyo: Promise<MoyoAnalyzer> | undefined;
let niggli: Promise<StandaloneWasm> | undefined;
const engines = {
  moyo: () => (moyo ??= init({ module_or_path: new URL(moyoWasmUrl, import.meta.url) }).then(() => ({ analyze_cell, operations_from_number, hall_symbol_entry }))),
  niggli: () => (niggli ??= instantiateStandaloneWasm(new URL(niggliWasmUrl, import.meta.url))),
};

scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ ok: true, result: await runCrystalRequest(engines, data) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

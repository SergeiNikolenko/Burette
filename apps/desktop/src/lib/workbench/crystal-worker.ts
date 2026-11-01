import init, { analyze_cell, operations_from_number } from "@spglib/moyo-wasm";
// Emitted as a hashed asset and resolved relative to this worker, so it follows the Vite base.
import moyoWasmUrl from "@spglib/moyo-wasm/moyo_wasm_bg.wasm?url";
import { runCrystalRequest, type CrystalRequest } from "../molecular-workbench/crystal-symmetry-io";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<CrystalRequest>) => void; postMessage: (message: unknown) => void };

scope.onmessage = async ({ data }) => {
  try {
    await init({ module_or_path: moyoWasmUrl });
    scope.postMessage({ ok: true, result: await runCrystalRequest({ analyze_cell, operations_from_number }, data) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

// Emitted as a hashed asset and resolved relative to this worker, so it follows the Vite base.
import xrdWasmUrl from "../molecular-workbench/xrd/burette-xrd.wasm?url";
import { computePowderPattern, type PowderXrdRequest } from "../molecular-workbench/xrd/powder-xrd";
import { loadXrdEngine } from "../molecular-workbench/xrd/xrd-engine";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<PowderXrdRequest>) => void; postMessage: (message: unknown) => void };

scope.onmessage = async ({ data }) => {
  try {
    const engine = await loadXrdEngine(new URL(xrdWasmUrl, import.meta.url));
    scope.postMessage({ ok: true, result: computePowderPattern(engine, data) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

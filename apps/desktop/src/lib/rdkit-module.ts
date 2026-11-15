import type { MainModule as RDKitModule } from "@rdkit/rdkit";

// RDKit loads lazily and once per window. It receives compiled WASM directly so
// packaged WKWebView never has to fetch a Vite data URL through Emscripten's
// network loader, and never falls back to a frontend path that answers with
// the app's index.html instead of the binary.
let rdkitPromise: Promise<RDKitModule> | null = null;

export function loadRDKitModule(): Promise<RDKitModule> {
  if (!rdkitPromise) {
    rdkitPromise = (async () => {
      const [rdkitModule, wasm] = await Promise.all([
        import("@rdkit/rdkit"),
        import("@rdkit/rdkit/RDKit_minimal.wasm?url"),
      ]);
      // File-based module runtimes expose an absolute asset path for ?url.
      const wasmUrl = wasm.default.startsWith("/") && import.meta.url.startsWith("file:")
        ? new URL(wasm.default, import.meta.url).href : wasm.default;
      const wasmBinary = wasmUrl.startsWith("data:")
        ? Uint8Array.from(atob(wasmUrl.slice(wasmUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0))
        : new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
      const compiled = await WebAssembly.compile(wasmBinary);
      return rdkitModule.default({
        locateFile: () => wasmUrl,
        instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
          const instance = new WebAssembly.Instance(compiled, imports);
          receive(instance, compiled);
          return instance.exports;
        },
      });
    })().catch((error) => {
      rdkitPromise = null;
      throw error;
    });
  }
  return rdkitPromise;
}

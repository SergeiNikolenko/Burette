// RDKit 2026's Emscripten build no longer consumes Module.wasmBinary. Burette
// preloads authorized bytes for WKWebView and plugin CSP; keep that transport
// through the supported instantiateWasm hook instead of fetching a second URL.
(() => {
  const initialize = initRDKitModule;
  initRDKitModule = async (options = {}) => {
    if (!options.wasmBinary || options.instantiateWasm) return initialize(options);
    const compiled = await WebAssembly.compile(options.wasmBinary);
    return initialize({
      ...options,
      instantiateWasm(imports, receiveInstance) {
        const instance = new WebAssembly.Instance(compiled, imports);
        receiveInstance(instance, compiled);
        return instance.exports;
      },
    });
  };
  if (typeof module === 'object' && module.exports) module.exports = initRDKitModule;
})();

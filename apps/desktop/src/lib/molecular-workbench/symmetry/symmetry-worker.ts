import { reduceNiggliCell } from "./niggli";
import { analyzePointGroup } from "./point-group";
import type { SymmetryRequest } from "./symmetry-client";
import { instantiateStandaloneWasm, type StandaloneWasm } from "./wasm-module";

let msym: Promise<StandaloneWasm> | undefined;
let niggli: Promise<StandaloneWasm> | undefined;

async function run(request: SymmetryRequest) {
  switch (request.action) {
    case "detect-point-group":
    case "symmetrize": {
      msym ??= instantiateStandaloneWasm(new URL("./burette-msym.wasm", import.meta.url));
      const engine = await msym;
      return request.action === "symmetrize" ? analyzePointGroup(engine, request.input, "symmetrize") : analyzePointGroup(engine, request.input, "detect");
    }
    case "niggli-reduce":
      niggli ??= instantiateStandaloneWasm(new URL("./burette-niggli.wasm", import.meta.url));
      return reduceNiggliCell(await niggli, request.input);
  }
}

self.onmessage = async (event: MessageEvent<SymmetryRequest>) => {
  try {
    self.postMessage({ ok: true, result: await run(event.data) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

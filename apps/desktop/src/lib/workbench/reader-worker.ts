import { parseScientificFile } from "../molecular-workbench/quantum";
import { readCifCrystal } from "../molecular-workbench/cif-crystal";
import type { ReaderRequest } from "./reader-task";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<ReaderRequest>) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    let result: unknown;
    switch (data.action) {
      case "parse": result = parseScientificFile(data.name, data.text); break;
      case "cif": result = await readCifCrystal(data.text); break;
      default: throw new Error("Unknown scientific reader operation.");
    }
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

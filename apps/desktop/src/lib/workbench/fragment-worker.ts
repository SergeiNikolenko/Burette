import { insertFragment } from "../molecular-workbench/fragment-source";
import type { FragmentInsertRequest } from "./fragment-task";

self.onmessage = async ({ data }: MessageEvent<FragmentInsertRequest>) => {
  try {
    self.postMessage({ ok: true, result: await insertFragment(data.molecule, data.fragment, data.target) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Could not insert the fragment." });
  }
};

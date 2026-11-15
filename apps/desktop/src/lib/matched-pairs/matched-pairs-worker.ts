import { loadRDKitModule } from "../rdkit-module";
import { findMatchedPairs, type MatchedPairInput } from "./matched-pairs";

export type MatchedPairsProgress = { done: number; total: number };

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ molecules: MatchedPairInput[] }>) => void;
  postMessage: (message: unknown) => void;
};
const PROGRESS_INTERVAL_MS = 100;

scope.onmessage = async ({ data }) => {
  try {
    const rdkit = await loadRDKitModule();
    let posted = 0;
    const result = findMatchedPairs(rdkit, data.molecules, (done, total) => {
      const now = Date.now();
      if (now - posted < PROGRESS_INTERVAL_MS) return;
      posted = now;
      scope.postMessage({ progress: { done, total } satisfies MatchedPairsProgress });
    });
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

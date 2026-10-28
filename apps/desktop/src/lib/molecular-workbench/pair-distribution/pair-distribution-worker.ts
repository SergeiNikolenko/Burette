import { computePairDistribution, type PairDistributionRequest } from "./pair-distribution";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<PairDistributionRequest>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void };

scope.onmessage = ({ data }) => {
  try {
    const result = computePairDistribution(data);
    scope.postMessage({ ok: true, result }, [result.counts.buffer, result.minDistance.buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "Could not calculate the pair distribution." });
  }
};

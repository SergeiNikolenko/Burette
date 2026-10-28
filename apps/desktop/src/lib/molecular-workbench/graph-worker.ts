import { runGraphOperation, type GraphRequest } from './graph-operations';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<GraphRequest>) => void; postMessage: (message: unknown) => void };
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ ok: true, result: runGraphOperation(data) }); }
  catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};

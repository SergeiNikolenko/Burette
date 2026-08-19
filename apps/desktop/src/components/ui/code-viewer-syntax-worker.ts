export function createCodeSyntaxWorker(): Worker {
  return new Worker(new URL("./code-viewer-syntax.worker.ts", import.meta.url), {
    type: "module",
  });
}

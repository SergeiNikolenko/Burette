/** Browser transport for bounded structure text; native downloads use Rust. */
export async function fetchStructureText(url: string, options: {
  maxBytes: number;
  timeoutMs: number;
  cache?: RequestCache;
  httpError: (response: Response) => string;
}) {
  const controller = new AbortController();
  const deadline = performance.now() + options.timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stop = (reason: unknown) => {
    controller.abort(reason);
    // Cancellation must not wait for an unresponsive source's cleanup promise.
    void reader?.cancel(reason).catch(() => {});
  };
  const timeout = () => stop(new Error("Structure download timed out"));
  const timer = setTimeout(timeout, options.timeoutMs);
  // Remove each read's listener immediately: racing every chunk against one
  // pending abort promise would retain a callback for every received chunk.
  const withAbort = <T,>(operation: Promise<T>) => new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", onAbort));
    if (controller.signal.aborted) onAbort();
  });
  const checkDeadline = () => {
    if (performance.now() >= deadline) timeout();
    controller.signal.throwIfAborted();
  };
  try {
    const response = await withAbort(
      fetch(url, { cache: options.cache, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) void result.body?.cancel().catch(() => {});
        return result;
      }),
    );
    checkDeadline();
    reader = response.body?.getReader();
    if (!response.ok) throw new Error(options.httpError(response));
    const declared = response.headers.get("content-length");
    if (!response.headers.get("content-encoding") && declared && /^\d+$/.test(declared)
      && Number(declared) > options.maxBytes) throw new Error("Fetched structure is too large");
    if (!reader) return { text: "", byteCount: 0 };
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let received = 0;
    let byteCount = 0;
    let text = "";
    const append = (chunk: string) => {
      // Preserve Response.text() replacement decoding and the existing returned
      // UTF-8 byte count, while bounding malformed UTF-8 expansion as well.
      byteCount += encoder.encode(chunk).byteLength;
      if (byteCount > options.maxBytes) throw new Error("Fetched structure is too large");
      text += chunk;
    };
    while (true) {
      checkDeadline();
      const { value, done } = await withAbort(reader.read());
      checkDeadline();
      if (done) break;
      received += value.byteLength;
      if (received > options.maxBytes) throw new Error("Fetched structure is too large");
      append(decoder.decode(value, { stream: true }));
    }
    append(decoder.decode());
    return { text, byteCount };
  } catch (error) {
    stop(error);
    throw error;
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}

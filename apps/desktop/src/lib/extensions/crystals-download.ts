import bundleUrl from "../../../../../resources/extensions/openchemistry-crystals.bin?url";
import { CRYSTALS_RESOURCE, resourceAbort } from "./resource-bundle";

/** The build owns this URL. Callers cannot supply an archive or proxy destination. */
export async function downloadCrystals(fetcher: typeof fetch, signal: AbortSignal, progress: (bytes: number) => void) {
  resourceAbort(signal);
  const response = await fetcher(bundleUrl, { signal, mode: "same-origin", credentials: "same-origin", redirect: "error" });
  if (!response.body) throw new Error("Could not read the Crystals bundle.");
  const expected = CRYSTALS_RESOURCE.compressed.bytes, length = response.headers.get("content-length");
  const reader = response.body.getReader();
  let cancelling: Promise<void> | undefined;
  const cancel = () => cancelling ??= reader.cancel().catch(() => {});
  const abort = () => { void cancel(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    resourceAbort(signal);
    if (!response.ok) throw new Error("Could not read the Crystals bundle.");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) !== expected)) throw new Error("Unexpected Crystals bundle length.");
    const input = new Uint8Array(expected); let received = 0;
    for (;;) {
      const { done, value } = await reader.read(); resourceAbort(signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.length > expected - received) throw new Error("Crystals bundle exceeds its reviewed size.");
      input.set(value, received); received += value.length;
      if (value.length) progress(received);
    }
    if (received !== expected) throw new Error("Incomplete Crystals bundle.");
    return input;
  } finally {
    signal.removeEventListener("abort", abort);
    await cancel(); reader.releaseLock();
  }
}

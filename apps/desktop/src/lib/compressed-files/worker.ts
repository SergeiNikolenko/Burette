import { decodeCompressedText, encodeCompressedText } from "./codecs";
import type { CompressedRequest } from "./task";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<CompressedRequest>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void };

scope.onmessage = async ({ data }) => {
  try {
    if (data.action === "decode") {
      scope.postMessage({ ok: true, result: await decodeCompressedText(data.name, new Uint8Array(data.bytes), data.options) });
      return;
    }
    const bytes = await encodeCompressedText(data.codec, data.text);
    const buffer = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    scope.postMessage({ ok: true, result: buffer }, [buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

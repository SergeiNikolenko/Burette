// The generated Emscripten module is hash-locked and verified by the native
// coordinator before conformer submission is exposed.
// @ts-expect-error generated pinned RDKit module has no authored declarations
import initializeExtractor from "../../../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.js";
import type {
  ConformerExtractionWorkerRequest,
  ConformerExtractionWorkerResponse,
  ConformerInputChunk,
  ConformerInputRecord,
  ConformerVariant,
} from "../lib/compute-conformer";

const EXPECTED_ABI_VERSION = 1;
const EXPECTED_RDKIT_REVISION = "Release_2025_03_4@276b5a662302c6a548ac4f1363c066f3258e3a20";
const MAX_ERROR_BYTES = 2_048;
const wasmUrl = new URL(
  "../../../../PreviewExtension/Web/rdkit-conformer/Burrete_rdkit_conformer.wasm",
  import.meta.url,
).href;

type ExtractorModule = {
  conformer_extractor_abi_version(): number;
  extract_conformer_parameters(input: string, inputFormat: number, variant: number): Uint8Array;
  rdkit_source_revision(): string;
};

let extractorPromise: Promise<ExtractorModule> | null = null;

self.addEventListener("message", (event: MessageEvent<ConformerExtractionWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== "extractConformerChunk" || !request.requestId) return;
  void extractChunk(request.chunk)
    .then((bytes) => {
      const result = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      reply({ type: "conformerChunkResult", requestId: request.requestId, result }, [result]);
    })
    .catch((error) => reply({
      type: "conformerChunkResult",
      requestId: request.requestId,
      error: boundedError(error),
    }));
});

async function extractChunk(chunk: ConformerInputChunk) {
  validateChunk(chunk);
  const extractor = await loadExtractor();
  const records = chunk.records.map((record) => extractRecord(extractor, record, chunk.variant));
  return encodeEnvelope(chunk, records);
}

function extractRecord(extractor: ExtractorModule, record: ConformerInputRecord, variant: ConformerVariant) {
  if (record.format === "unsupportedIdcode") {
    return { record, status: 1, payload: new TextEncoder().encode("RDKit conformer extraction does not support DataWarrior IDCode records.") };
  }
  if (typeof record.input !== "string" || !record.input.trim()) {
    return { record, status: 1, payload: new TextEncoder().encode("Conformer input is empty.") };
  }
  try {
    const payload = extractor.extract_conformer_parameters(
      record.input,
      record.format === "molblock" ? 0 : 1,
      variantTag(variant),
    );
    if (!(payload instanceof Uint8Array) || payload.byteLength < 64 || payload.byteLength > 0xffff_ffff) {
      throw new Error("RDKit conformer extractor returned an invalid BCEX payload.");
    }
    return { record, status: 0, payload };
  } catch (error) {
    return { record, status: 1, payload: new TextEncoder().encode(boundedError(error)) };
  }
}

async function loadExtractor(): Promise<ExtractorModule> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`Cannot load the verified conformer extractor (${response.status}).`);
      const module = await initializeExtractor({
        locateFile: () => wasmUrl,
        wasmBinary: new Uint8Array(await response.arrayBuffer()),
      }) as ExtractorModule;
      if (module.conformer_extractor_abi_version() !== EXPECTED_ABI_VERSION) {
        throw new Error("Conformer extractor ABI differs from BCEX v1.");
      }
      if (module.rdkit_source_revision() !== EXPECTED_RDKIT_REVISION) {
        throw new Error("Conformer extractor RDKit revision differs from the pinned source.");
      }
      return module;
    })();
  }
  return extractorPromise;
}

function encodeEnvelope(
  chunk: ConformerInputChunk,
  records: Array<{ record: ConformerInputRecord; status: number; payload: Uint8Array }>,
) {
  const totalBytes = records.reduce((total, item) => align4(total + 56 + item.payload.byteLength), 40);
  if (totalBytes > chunk.maximumResultBytes) {
    throw new Error(`Conformer result requires ${totalBytes} bytes; the admitted envelope limit is ${chunk.maximumResultBytes}.`);
  }
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x43, 0x45, 0x52]);
  view.setUint16(4, 1, true);
  view.setUint16(6, 40, true);
  bytes.set(uuidBytes(chunk.sessionId), 8);
  setSafeUint64(view, 24, chunk.startOrdinal, "start ordinal");
  view.setUint32(32, records.length, true);
  view.setUint32(36, totalBytes, true);
  let offset = 40;
  for (const item of records) {
    setSafeUint64(view, offset, item.record.ordinal, "record ordinal");
    setSafeUint64(view, offset + 8, item.record.sourceRecordId, "source record ID");
    bytes.set(sha256Bytes(item.record.moleculeContentSha256), offset + 16);
    bytes[offset + 48] = item.status;
    view.setUint32(offset + 52, item.payload.byteLength, true);
    offset += 56;
    bytes.set(item.payload, offset);
    offset = align4(offset + item.payload.byteLength);
  }
  return bytes;
}

function validateChunk(chunk: ConformerInputChunk) {
  if (!chunk?.sessionId || !Array.isArray(chunk.records) || chunk.records.length < 1 || chunk.records.length > 16) {
    throw new Error("Conformer worker received an invalid extraction chunk.");
  }
  if (!Number.isSafeInteger(chunk.startOrdinal)
    || !Number.isSafeInteger(chunk.maximumResultBytes)
    || chunk.maximumResultBytes < 40) {
    throw new Error("Conformer extraction chunk limits are invalid.");
  }
  for (const [index, record] of chunk.records.entries()) {
    if (record.ordinal !== chunk.startOrdinal + index
      || !Number.isSafeInteger(record.sourceRecordId)
      || !/^[0-9a-f]{64}$/u.test(record.moleculeContentSha256)) {
      throw new Error("Conformer extraction record identity is invalid.");
    }
  }
}

function variantTag(variant: ConformerVariant) {
  const tag = ["DG", "KDG", "ETDG", "ETDGv2", "ETKDG", "ETKDGv2", "ETKDGv3", "srETKDGv3"].indexOf(variant);
  if (tag < 0) throw new Error(`Unsupported conformer variant: ${variant}`);
  return tag;
}

function uuidBytes(value: string) {
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) throw new Error("Conformer session ID is not a UUID.");
  return hexBytes(hex);
}

function sha256Bytes(value: string) {
  return hexBytes(value);
}

function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function setSafeUint64(view: DataView, offset: number, value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is outside the JSON-safe integer range.`);
  view.setBigUint64(offset, BigInt(value), true);
}

function align4(value: number) {
  return Math.ceil(value / 4) * 4;
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "RDKit conformer extraction failed.");
  const printable = message.replace(/[\u0000-\u001f\u007f]/gu, " ").trim() || "RDKit conformer extraction failed.";
  const bytes = new TextEncoder().encode(printable);
  if (bytes.byteLength <= MAX_ERROR_BYTES) return printable;
  return new TextDecoder().decode(bytes.slice(0, MAX_ERROR_BYTES)).replace(/\uFFFD$/u, "");
}

function reply(response: ConformerExtractionWorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as {
    postMessage(message: ConformerExtractionWorkerResponse, transfer: Transferable[]): void;
  }).postMessage(response, transfer);
}

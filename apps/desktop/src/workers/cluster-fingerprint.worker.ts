import type { RDKitLoader, RDKitModule } from "@rdkit/rdkit";
import type {
  FingerprintChunkResult,
  FingerprintInputChunk,
  FingerprintInputRecord,
  FingerprintOutputRecord,
} from "../lib/compute-cluster";

type RDKitLoaderOptions = {
  locateFile: () => string;
  wasmBinary: Uint8Array;
};

type FingerprintWorkerRequest = {
  type: "fingerprintChunk";
  requestId: string;
  chunk: FingerprintInputChunk;
};

type FingerprintWorkerResponse = {
  type: "fingerprintChunkResult";
  requestId: string;
  result?: FingerprintChunkResult;
  error?: string;
};

const rdkitWasmUrl = new URL(
  "../../../../PreviewExtension/Web/rdkit/RDKit_minimal.wasm",
  import.meta.url,
).href;
let rdkitPromise: Promise<RDKitModule> | null = null;

self.addEventListener("message", (event: MessageEvent<FingerprintWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== "fingerprintChunk" || !request.requestId) return;
  void fingerprintChunk(request.chunk)
    .then((result) => reply({ type: "fingerprintChunkResult", requestId: request.requestId, result }))
    .catch((error) => reply({
      type: "fingerprintChunkResult",
      requestId: request.requestId,
      error: boundedError(error),
    }));
});

async function fingerprintChunk(chunk: FingerprintInputChunk): Promise<FingerprintChunkResult> {
  validateChunk(chunk);
  const rdkit = await loadRDKit();
  const records = chunk.records.map((record) => fingerprintRecord(rdkit, record, chunk));
  return {
    sessionId: chunk.sessionId,
    jobId: chunk.jobId,
    startOrdinal: chunk.startOrdinal,
    records,
  };
}

function fingerprintRecord(
  rdkit: RDKitModule,
  record: FingerprintInputRecord,
  chunk: FingerprintInputChunk,
): FingerprintOutputRecord {
  const identity = {
    ordinal: record.ordinal,
    sourceRecordId: record.sourceRecordId,
    moleculeContentSha256: record.moleculeContentSha256,
  };
  if (record.format === "unsupportedIdcode") {
    return { ...identity, fingerprintBase64: null, error: "RDKit cannot fingerprint DataWarrior IDCode records." };
  }
  let molecule: ReturnType<RDKitModule["get_mol"]> = null;
  try {
    molecule = rdkit.get_mol(record.input);
    if (!molecule) throw new Error("RDKit rejected the molecule during sanitization.");
    const fingerprint = molecule.get_morgan_fp_as_uint8array(JSON.stringify({
      radius: chunk.settings.radius,
      fplen: chunk.settings.bitCount,
      useChirality: chunk.settings.useChirality,
      useFeatures: chunk.settings.useFeatures,
    }));
    const expectedBytes = chunk.settings.bitCount / 8;
    if (!(fingerprint instanceof Uint8Array) || fingerprint.byteLength !== expectedBytes) {
      throw new Error(`RDKit returned ${fingerprint?.byteLength ?? 0} fingerprint bytes; expected ${expectedBytes}.`);
    }
    return { ...identity, fingerprintBase64: bytesToBase64(fingerprint), error: null };
  } catch (error) {
    return { ...identity, fingerprintBase64: null, error: boundedError(error) };
  } finally {
    molecule?.delete();
  }
}

async function loadRDKit(): Promise<RDKitModule> {
  if (!rdkitPromise) {
    rdkitPromise = (async () => {
      const [loaderModule, wasmResponse] = await Promise.all([
        import("@rdkit/rdkit"),
        fetch(rdkitWasmUrl),
      ]);
      if (!wasmResponse.ok) {
        throw new Error(`Cannot load the verified RDKit wasm (${wasmResponse.status}).`);
      }
      const loader = ((loaderModule as unknown as { default?: RDKitLoader }).default
        ?? loaderModule) as unknown as (options: RDKitLoaderOptions) => Promise<RDKitModule>;
      const rdkit = await loader({
        locateFile: () => rdkitWasmUrl,
        wasmBinary: new Uint8Array(await wasmResponse.arrayBuffer()),
      });
      if (rdkit.version() !== "2025.03.4") {
        throw new Error(`RDKit runtime version ${rdkit.version()} does not match 2025.03.4.`);
      }
      return rdkit;
    })();
  }
  return rdkitPromise;
}

function validateChunk(chunk: FingerprintInputChunk) {
  if (!chunk || !chunk.sessionId || !chunk.jobId || !Array.isArray(chunk.records)) {
    throw new Error("Fingerprint worker received an invalid chunk.");
  }
  if (chunk.records.length === 0 || chunk.records.length > 256) {
    throw new Error("Fingerprint worker chunk size is outside 1..=256 records.");
  }
  if (chunk.settings.rdkitVersion !== "2025.03.4"
    || chunk.settings.radius !== 2
    || chunk.settings.bitCount !== 2_048
    || chunk.settings.useChirality !== true
    || chunk.settings.useFeatures !== false
    || chunk.settings.sanitize !== true) {
    throw new Error("Fingerprint worker settings differ from the cluster.v1 baseline.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "RDKit fingerprint failed.");
  const printable = message.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return (printable || "RDKit fingerprint failed.").slice(0, 2_048);
}

function reply(response: FingerprintWorkerResponse) {
  self.postMessage(response);
}

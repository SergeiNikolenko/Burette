import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import {
  summarizeStructureText,
  type StructureSummary,
} from "../../../plugins/burette-agent/mcp/lib/structure-summary.mjs";
import { PUBLIC_OUTPUT_LIMITS } from "./contracts";

export const MAX_PUBLIC_STRUCTURE_BYTES = 3 * 1024 * 1024;
export const MAX_PUBLIC_STRUCTURE_LINES = 200_000;
export const STRUCTURE_FETCH_TIMEOUT_MS = 15_000;

const MAX_REDIRECTS = 3;
const USER_AGENT =
  "Burette-Public-Plugin/0.1 (+https://burette-landing.vercel.app/docs/plugin)";

const VIEWER_FORMATS = new Map<string, string>([
  ["pdb", "pdb"],
  ["ent", "pdb"],
  ["pdbqt", "pdb"],
  ["cif", "mmcif"],
  ["mmcif", "mmcif"],
  ["sdf", "sdf"],
  ["sd", "sdf"],
  ["xyz", "xyz"],
  ["extxyz", "xyz"],
]);

const MIME_EXTENSIONS = new Map<string, string>([
  ["chemical/x-pdb", "pdb"],
  ["chemical/x-cif", "cif"],
  ["chemical/x-mmcif", "cif"],
  ["chemical/x-mdl-sdfile", "sdf"],
  ["chemical/x-xyz", "xyz"],
]);

export interface ChatGptFileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface PublicStructureSummary extends Record<string, unknown> {
  source: "attachment" | "rcsb";
  pdbId?: string;
  fileName: string;
  format: string;
  kind: string;
  summaryLine: string;
  byteCount: number;
  lineCount: number;
  counts: Record<string, number>;
  rows: Array<{ label: string; value: string }>;
  components: {
    chains?: Array<Record<string, string | number | null>>;
    ligands?: Array<Record<string, string | number | null>>;
    ligandTypes?: Array<Record<string, string | number | null>>;
    ions?: Array<Record<string, string | number | null>>;
    water?: Record<string, number>;
    molecules?: Array<Record<string, string | number | null>>;
    elements?: Record<string, number>;
  };
  notes: string[];
  viewerAvailable: boolean;
}

export interface PreparedStructure {
  summary: PublicStructureSummary;
  viewer: {
    data: string;
    format: string;
    label: string;
  };
}

export class StructureServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StructureServiceError";
  }
}

interface PublicHttpsTarget {
  url: URL;
  hostname: string;
  addresses: LookupAddress[];
}

function extensionFromName(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").toLowerCase();
}

function safeFileName(value: string | undefined): string {
  const basename = path.basename(String(value || "").trim());
  if (!basename || basename === "." || basename === "/") return "structure";
  return basename.slice(0, 255);
}

function resolveFileName(file: ChatGptFileReference): string {
  const supplied = safeFileName(file.file_name);
  if (extensionFromName(supplied)) return supplied;

  const mimeExtension = MIME_EXTENSIONS.get(
    String(file.mime_type || "").split(";", 1)[0].trim().toLowerCase(),
  );
  if (mimeExtension) return `${supplied}.${mimeExtension}`;

  try {
    const fromUrl = safeFileName(new URL(file.download_url).pathname);
    if (extensionFromName(fromUrl)) return fromUrl;
  } catch {
    // URL validation reports the actionable error below.
  }

  throw new StructureServiceError(
    "UNSUPPORTED_FORMAT",
    "The attachment needs a .pdb, .ent, .pdbqt, .cif, .mmcif, .sdf, .sd, .xyz, or .extxyz filename.",
  );
}

function viewerFormatForFile(fileName: string): string {
  const extension = extensionFromName(fileName);
  const format = VIEWER_FORMATS.get(extension);
  if (!format) {
    throw new StructureServiceError(
      "UNSUPPORTED_FORMAT",
      `Unsupported molecular structure format: .${extension || "unknown"}.`,
    );
  }
  return format;
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function isNonPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::")) return true;
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    /^fe[cdef]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("100:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2002:")
  );
}

function isNonPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isNonPublicIpv4(address);
  if (family === 6) return isNonPublicIpv6(address);
  return true;
}

async function resolvePublicHttpsTarget(value: string): Promise<PublicHttpsTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StructureServiceError(
      "INVALID_FILE_URL",
      "The attachment download URL is invalid.",
    );
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new StructureServiceError(
      "INVALID_FILE_URL",
      "The attachment download URL must be a public HTTPS URL.",
    );
  }

  const rawHostname = url.hostname.toLowerCase();
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new StructureServiceError(
      "PRIVATE_FILE_URL",
      "Private or local attachment URLs are not allowed.",
    );
  }

  if (isIP(hostname)) {
    if (isNonPublicIp(hostname)) {
      throw new StructureServiceError(
        "PRIVATE_FILE_URL",
        "Private or local attachment URLs are not allowed.",
      );
    }
    return {
      url,
      hostname,
      addresses: [{ address: hostname, family: isIP(hostname) }],
    };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new StructureServiceError(
      "FILE_HOST_UNREACHABLE",
      "The attachment host could not be resolved.",
    );
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicIp(address))) {
    throw new StructureServiceError(
      "PRIVATE_FILE_URL",
      "Private or local attachment URLs are not allowed.",
    );
  }
  return { url, hostname, addresses };
}

export async function assertPublicHttpsUrl(value: string): Promise<URL> {
  return (await resolvePublicHttpsTarget(value)).url;
}

async function readBoundedText(response: IncomingMessage): Promise<string> {
  const contentLength = response.headers["content-length"];
  const declaredLength = Number(
    Array.isArray(contentLength) ? contentLength[0] : contentLength,
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PUBLIC_STRUCTURE_BYTES) {
    throw new StructureServiceError(
      "STRUCTURE_TOO_LARGE",
      `The structure exceeds the ${MAX_PUBLIC_STRUCTURE_BYTES} byte public preview limit.`,
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const value of response) {
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    total += chunk.byteLength;
    if (total > MAX_PUBLIC_STRUCTURE_BYTES) {
      response.destroy();
      throw new StructureServiceError(
        "STRUCTURE_TOO_LARGE",
        `The structure exceeds the ${MAX_PUBLIC_STRUCTURE_BYTES} byte public preview limit.`,
      );
    }
    chunks.push(chunk);
  }
  if (total === 0) {
    throw new StructureServiceError(
      "EMPTY_STRUCTURE",
      "The structure source returned an empty file.",
    );
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function requestPinnedHttps(
  target: PublicHttpsTarget,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  let lastError: unknown;
  for (const address of target.addresses) {
    try {
      return await new Promise<IncomingMessage>((resolve, reject) => {
        const request = requestHttps(
          {
            protocol: "https:",
            hostname: address.address,
            family: address.family,
            port: target.url.port || 443,
            path: `${target.url.pathname}${target.url.search}`,
            method: "GET",
            servername: isIP(target.hostname) ? undefined : target.hostname,
            headers: {
              Accept:
                "text/plain, chemical/x-pdb, chemical/x-cif, chemical/x-mdl-sdfile, */*;q=0.1",
              Host: target.url.host,
              "User-Agent": USER_AGENT,
            },
            signal,
          },
          resolve,
        );
        request.once("error", reject);
        request.end();
      });
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
    }
  }
  throw lastError ?? new Error("No public address was available.");
}

async function fetchPublicText(source: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STRUCTURE_FETCH_TIMEOUT_MS);
  let current = source;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const target = await resolvePublicHttpsTarget(current);
      const response = await requestPinnedHttps(target, controller.signal);
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400) {
        const rawLocation = response.headers.location;
        const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
        response.destroy();
        if (!location || redirects === MAX_REDIRECTS) {
          throw new StructureServiceError(
            "TOO_MANY_REDIRECTS",
            "The structure source redirected too many times.",
          );
        }
        current = new URL(location, target.url).toString();
        continue;
      }
      if (status === 404) {
        response.destroy();
        throw new StructureServiceError(
          "STRUCTURE_NOT_FOUND",
          "The requested molecular structure was not found.",
        );
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new StructureServiceError(
          "STRUCTURE_FETCH_FAILED",
          `The structure source returned HTTP ${status}.`,
        );
      }
      return await readBoundedText(response);
    }
  } catch (error) {
    if (error instanceof StructureServiceError) throw error;
    if (controller.signal.aborted) {
      throw new StructureServiceError(
        "STRUCTURE_FETCH_TIMEOUT",
        "The structure source did not respond within 15 seconds.",
      );
    }
    throw new StructureServiceError(
      "STRUCTURE_FETCH_FAILED",
      "The structure could not be retrieved.",
    );
  } finally {
    clearTimeout(timer);
  }
  throw new StructureServiceError(
    "STRUCTURE_FETCH_FAILED",
    "The structure could not be retrieved.",
  );
}

function takeObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, PUBLIC_OUTPUT_LIMITS.componentItems);
}

function boundedString(
  value: unknown,
  maxLength: number = PUBLIC_OUTPUT_LIMITS.scalarChars,
): string {
  return String(value ?? "").slice(0, maxLength);
}

function pickScalarRecord(
  value: unknown,
  allowedKeys: string[],
): Array<Record<string, string | number | null>> {
  return takeObjects(value).map((item) =>
    Object.fromEntries(
      allowedKeys
        .filter((key) => ["string", "number"].includes(typeof item[key]) || item[key] === null)
        .map((key) => {
          const entry = item[key] as string | number | null;
          return [key, typeof entry === "string" ? boundedString(entry) : entry];
        }),
    ),
  );
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([, entry]) => typeof entry === "number" && Number.isFinite(entry))
    .slice(0, PUBLIC_OUTPUT_LIMITS.componentItems);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function publicComponents(summary: StructureSummary): PublicStructureSummary["components"] {
  const components = summary.components || {};
  const chains = pickScalarRecord(components.chains, [
    "id",
    "residues",
    "atoms",
    "proteinResidues",
    "nucleicResidues",
    "otherResidues",
  ]);
  const ligands = pickScalarRecord(components.ligands, [
    "label",
    "compId",
    "chain",
    "seq",
    "insertionCode",
    "atoms",
  ]);
  const ligandTypes = pickScalarRecord(components.ligandTypes, [
    "compId",
    "instances",
    "atoms",
  ]);
  const ions = pickScalarRecord(components.ions, ["compId", "instances", "atoms"]);
  const molecules = pickScalarRecord(components.molecules, ["index", "title"]);
  const water = numberRecord(components.water);
  const elements = numberRecord(components.elements);
  return {
    ...(chains.length > 0 ? { chains } : {}),
    ...(ligands.length > 0 ? { ligands } : {}),
    ...(ligandTypes.length > 0 ? { ligandTypes } : {}),
    ...(ions.length > 0 ? { ions } : {}),
    ...(water ? { water } : {}),
    ...(molecules.length > 0 ? { molecules } : {}),
    ...(elements ? { elements } : {}),
  };
}

function prepareSummary(
  summary: StructureSummary,
  source: PublicStructureSummary["source"],
  fileName: string,
  pdbId?: string,
): PublicStructureSummary {
  return {
    source,
    ...(pdbId ? { pdbId } : {}),
    fileName: boundedString(fileName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
    format: boundedString(summary.format),
    kind: boundedString(summary.kind),
    summaryLine: boundedString(summary.summaryLine),
    byteCount: summary.byteCount,
    lineCount: summary.lineCount,
    counts: Object.fromEntries(
      Object.entries(summary.counts)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
        .slice(0, PUBLIC_OUTPUT_LIMITS.componentItems),
    ),
    rows: summary.rows.slice(0, PUBLIC_OUTPUT_LIMITS.rows).map(({ label, value }) => ({
      label: boundedString(label),
      value: boundedString(value),
    })),
    components: publicComponents(summary),
    notes: summary.notes
      .slice(0, PUBLIC_OUTPUT_LIMITS.notes)
      .map((note) => boundedString(note)),
    viewerAvailable: true,
  };
}

export function prepareStructureText(
  text: string,
  fileName: string,
  source: PublicStructureSummary["source"],
  pdbId?: string,
): PreparedStructure {
  const viewerFormat = viewerFormatForFile(fileName);
  const byteCount = Buffer.byteLength(text, "utf8");
  if (byteCount > MAX_PUBLIC_STRUCTURE_BYTES) {
    throw new StructureServiceError(
      "STRUCTURE_TOO_LARGE",
      `The structure exceeds the ${MAX_PUBLIC_STRUCTURE_BYTES} byte public preview limit.`,
    );
  }
  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount > MAX_PUBLIC_STRUCTURE_LINES) {
      throw new StructureServiceError(
        "STRUCTURE_TOO_MANY_LINES",
        `The structure exceeds the ${MAX_PUBLIC_STRUCTURE_LINES} line public preview limit.`,
      );
    }
  }
  const parsed = summarizeStructureText({ text, fileName, byteCount });
  return {
    summary: prepareSummary(parsed, source, fileName, pdbId),
    viewer: {
      data: text,
      format: viewerFormat,
      label: boundedString(fileName, PUBLIC_OUTPUT_LIMITS.fileNameChars),
    },
  };
}

export async function prepareAttachedStructure(
  file: ChatGptFileReference,
): Promise<PreparedStructure> {
  const fileName = resolveFileName(file);
  viewerFormatForFile(fileName);
  const text = await fetchPublicText(file.download_url);
  return prepareStructureText(text, fileName, "attachment");
}

export async function preparePdbStructure(pdbId: string): Promise<PreparedStructure> {
  const normalizedId = pdbId.trim().toUpperCase();
  if (!/^[0-9][A-Z0-9]{3}$/u.test(normalizedId)) {
    throw new StructureServiceError(
      "INVALID_PDB_ID",
      "A PDB ID must contain four letters or digits and start with a digit, for example 1CRN.",
    );
  }
  const fileName = `${normalizedId}.pdb`;
  const text = await fetchPublicText(
    `https://files.rcsb.org/download/${encodeURIComponent(normalizedId)}.pdb`,
  );
  return prepareStructureText(text, fileName, "rcsb", normalizedId);
}

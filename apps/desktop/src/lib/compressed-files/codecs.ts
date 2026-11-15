import { Gunzip, gzipSync } from "fflate";
import { XzReadableStream } from "xz-decompress";
import { Zstd } from "@hpcc-js/wasm-zstd";
import {
  assertSignatureMatches,
  formatMiB,
  MAX_DECODED_BYTES,
  MAX_DECODER_WINDOW_BYTES,
  nestedArchiveSignature,
  supportedCompressedName,
  type CompressionCodec,
} from "./formats";

/**
 * Bounded decoders and encoders for compressed text files. Output is counted as
 * each chunk arrives and decoding stops at the first byte past the limit; input
 * is fed in slices small enough that one step can only overshoot by `SLACK`.
 * Declared sizes in headers are only ever used to reject a file early, never to
 * size an allocation. Every format is checked end to end: gzip members by their
 * CRC-32 and length, XZ streams by their own checks, Zstandard frames by their
 * structure and content checksum.
 */
const SLACK = 2 * 1024 * 1024;
// Most output one input byte can produce: a 4-byte RLE block regenerates 128 KiB;
// DEFLATE expands at most about 1032:1.
const ZSTD_MAX_EXPANSION = 32 * 1024;
const DEFLATE_MAX_EXPANSION = 1032;
const COMPRESSED_INPUT_LIMIT = MAX_DECODED_BYTES;

export type DecodeOptions = {
  maxBytes?: number;
  /** Return at most this many bytes of the start without reading the rest, for sniffing formats. */
  prefixBytes?: number;
};

export type DecodedText = { text: string; codec: CompressionCodec; innerName: string; byteCount: number };

class PrefixComplete extends Error {}

function displayName(name: string) {
  return name.split(/[\\/]/u).pop() || name;
}

/** Collects decoded output, rejecting it as soon as it is too large, binary or another archive. */
class BoundedSink {
  private chunks: Uint8Array[] = [];
  size = 0;
  private checkedStart = false;
  constructor(private readonly name: string, private readonly maxBytes: number, private readonly prefix: boolean, private readonly inspect = true) {}

  get room() {
    return this.maxBytes - this.size;
  }

  push(chunk: Uint8Array) {
    if (!chunk.length) return;
    if (chunk.length > this.room) {
      if (!this.prefix) throw new Error(`${this.name} expands beyond the ${formatMiB(this.maxBytes)} limit for decompressed files`);
      chunk = chunk.subarray(0, this.room);
    }
    // Copy: decoders reuse their output buffers.
    this.chunks.push(chunk.slice());
    this.size += chunk.length;
    if (this.inspect && !this.checkedStart && this.size >= 16) this.checkStart();
    if (this.inspect && chunk.includes(0)) throw new Error(`${this.name} contains binary data, not a text file`);
    if (this.prefix && this.size >= this.maxBytes) throw new PrefixComplete();
  }

  private checkStart() {
    this.checkedStart = true;
    const nested = nestedArchiveSignature(this.bytes().subarray(0, 16));
    if (nested) throw new Error(`${this.name} contains ${nested} inside; nested archives are not opened`);
  }

  bytes() {
    if (this.chunks.length === 1) return this.chunks[0];
    const output = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) { output.set(chunk, offset); offset += chunk.length; }
    this.chunks = [output];
    return output;
  }

  finish() {
    if (this.inspect && !this.checkedStart && this.size > 0) this.checkStart();
    return this.bytes();
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(chunk: Uint8Array, crc: number) {
  let value = crc ^ 0xffffffff;
  for (let index = 0; index < chunk.length; index++) value = CRC_TABLE[(value ^ chunk[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

const GZIP_FHCRC = 2;
const GZIP_FEXTRA = 4;
const GZIP_FNAME = 8;
const GZIP_FCOMMENT = 16;

/**
 * Checks the gzip member header at `offset`: magic, method, flags and the optional
 * extra field, name and comment, each within the input. A header checksum (FHCRC)
 * must equal the low 16 bits of the CRC-32 of the header bytes before it, as
 * zlib requires; the DEFLATE reader skips it unchecked.
 */
function checkGzipHeader(name: string, input: Uint8Array, offset: number) {
  if (input.length - offset < 18) throw new Error(`${name} is truncated`);
  if (input[offset] !== 0x1f || input[offset + 1] !== 0x8b) throw new Error(`${name} has data after its last gzip member`);
  if (input[offset + 2] !== 8) throw new Error(`${name} uses a gzip compression method other than DEFLATE`);
  const flags = input[offset + 3];
  if (flags & 0xe0) throw new Error(`${name} has reserved gzip header flags set`);
  let end = offset + 10;
  if (flags & GZIP_FEXTRA) end += 2 + (input[end] | (input[end + 1] << 8));
  for (const flag of [GZIP_FNAME, GZIP_FCOMMENT]) {
    if (!(flags & flag) || end >= input.length) continue;
    const terminator = input.indexOf(0, end);
    end = terminator < 0 ? input.length : terminator + 1;
  }
  // The header, its checksum and the 8-byte trailer must all fit.
  if (end + (flags & GZIP_FHCRC ? 2 : 0) + 8 > input.length) throw new Error(`${name} is truncated`);
  if (flags & GZIP_FHCRC && (crc32(input.subarray(offset, end), 0) & 0xffff) !== (input[end] | (input[end + 1] << 8))) {
    throw new Error(`${name} is corrupt: a gzip header does not match its checksum`);
  }
}

/** gzip with any number of members (BGZF included); every member's CRC-32 and length are checked. */
function decodeGzip(name: string, input: Uint8Array, sink: BoundedSink) {
  checkGzipHeader(name, input, 0);
  let memberStart = 0;
  let crc = 0;
  let size = 0;
  const finishMember = (end: number) => {
    if (end - memberStart < 18) throw new Error(`${name} is truncated`);
    if (readUint32(input, end - 8) !== crc || readUint32(input, end - 4) !== (size >>> 0)) {
      throw new Error(`${name} is corrupt or truncated: a gzip member does not match its checksum`);
    }
    crc = 0;
    size = 0;
  };
  const inflater = new Gunzip((chunk) => {
    crc = crc32(chunk, crc);
    size += chunk.length;
    sink.push(chunk);
  });
  inflater.onmember = (offset) => {
    finishMember(offset);
    checkGzipHeader(name, input, offset);
    memberStart = offset;
  };
  try {
    for (let offset = 0; offset < input.length;) {
      const step = Math.min(64 * 1024, Math.max(1024, Math.floor((sink.room + SLACK) / DEFLATE_MAX_EXPANSION)));
      const end = Math.min(input.length, offset + step);
      inflater.push(input.subarray(offset, end), end === input.length);
      offset = end;
    }
  } catch (error) {
    throw libraryError(name, "gzip", error);
  }
  finishMember(input.length);
}

// xz-embedded results (xz.h): 4 dictionary over the limit, 5 not XZ, 6 unsupported
// check or filter, 7 corrupt, 8 truncated or trailing data.
const XZ_ERRORS: Record<string, string> = {
  "3": "needs more memory than the browser decoder has",
  "4": `needs a dictionary larger than the ${formatMiB(MAX_DECODER_WINDOW_BYTES)} browser limit`,
  "5": "is not valid XZ data",
  "6": "uses an XZ integrity check or filter the browser cannot read",
  "7": "is corrupt",
  "8": "is truncated or has data after its last XZ stream",
};

/** XZ with any number of streams and stream padding; the decoder's dictionary is capped at 64 MiB. */
async function decodeXz(name: string, input: Uint8Array, sink: BoundedSink) {
  const reader = new XzReadableStream(new Blob([input as BlobPart]).stream()).getReader();
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; return; }
      sink.push(value);
    }
  } catch (error) {
    // A decoder failure has already released the stream; a limit stop cancels it below.
    if (/get_next_output failed/u.test(String((error as Error)?.message))) finished = true;
    throw libraryError(name, "xz", error);
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
}

const ZSTD_MAGIC = 0xfd2fb528;

/**
 * Walks every Zstandard frame by its headers before anything is decoded: the input
 * must be whole frames (skippable ones allowed) with no trailing data, no dictionary,
 * a window the decoder may allocate and declared sizes within the limit.
 */
export function checkZstdFrames(name: string, input: Uint8Array, maxBytes: number, partial = false) {
  let offset = 0;
  let declared = 0;
  let frames = 0;
  // A partial input (the start of a file, for sniffing) may end anywhere; what it holds is still checked.
  const has = (count: number) => {
    if (offset + count <= input.length) return true;
    if (partial) return false;
    throw new Error(`${name} is truncated`);
  };
  while (offset < input.length) {
    if (!has(4)) return;
    const magic = readUint32(input, offset);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      if (!has(8)) return;
      const length = readUint32(input, offset + 4);
      offset += 8;
      if (!has(length)) return;
      offset += length;
      continue;
    }
    if (magic !== ZSTD_MAGIC) throw new Error(frames ? `${name} has data after its last Zstandard frame` : `${name} is not valid Zstandard data`);
    frames++;
    offset += 4;
    if (!has(1)) return;
    const descriptor = input[offset++];
    if (descriptor & 0x08) throw new Error(`${name} is not valid Zstandard data`);
    const singleSegment = (descriptor >> 5) & 1;
    const checksum = (descriptor >> 2) & 1;
    const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
    const contentFlag = descriptor >> 6;
    const contentBytes = contentFlag === 0 ? singleSegment : 1 << contentFlag;
    let window = 0;
    if (!singleSegment) {
      if (!has(1)) return;
      const windowByte = input[offset++];
      const base = 2 ** (10 + (windowByte >> 3));
      window = base + (base / 8) * (windowByte & 7);
    }
    if (!has(dictionaryBytes + contentBytes)) return;
    let dictionary = 0;
    for (let index = 0; index < dictionaryBytes; index++) dictionary += input[offset + index] * 2 ** (8 * index);
    offset += dictionaryBytes;
    if (dictionary !== 0) throw new Error(`${name} needs a Zstandard dictionary, which the browser does not have`);
    let content = -1;
    if (contentBytes) {
      content = 0;
      for (let index = 0; index < contentBytes; index++) content += input[offset + index] * 2 ** (8 * index);
      if (contentBytes === 2) content += 256;
      offset += contentBytes;
    }
    if (singleSegment) window = content;
    if (window > MAX_DECODER_WINDOW_BYTES) {
      throw new Error(`${name} needs a Zstandard window larger than the ${formatMiB(MAX_DECODER_WINDOW_BYTES)} browser limit`);
    }
    if (content > 0) {
      declared += content;
      if (declared > maxBytes) throw new Error(`${name} expands beyond the ${formatMiB(maxBytes)} limit for decompressed files`);
    }
    for (let last = 0; !last;) {
      if (!has(3)) return;
      const header = input[offset] | (input[offset + 1] << 8) | (input[offset + 2] << 16);
      offset += 3;
      last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >>> 3;
      if (type === 3 || size > 128 * 1024 || (window && size > window)) throw new Error(`${name} is corrupt`);
      const stored = type === 1 ? 1 : size;
      if (!has(stored)) return;
      offset += stored;
    }
    if (checksum) {
      if (!has(4)) return;
      offset += 4;
    }
  }
  if (!frames) throw new Error(`${name} has no Zstandard frame`);
}

/** Zstandard frames, concatenated and with skippable frames, through the reference decoder. */
async function decodeZstd(name: string, input: Uint8Array, sink: BoundedSink, maxBytes: number, partial: boolean) {
  checkZstdFrames(name, input, maxBytes, partial);
  const zstd = await Zstd.load();
  try {
    zstd.resetDecompression();
    for (let offset = 0; offset < input.length;) {
      const step = Math.min(64 * 1024, Math.max(64, Math.floor((sink.room + SLACK) / ZSTD_MAX_EXPANSION)));
      sink.push(zstd.decompressChunk(input.subarray(offset, offset + step)));
      offset += step;
    }
    zstd.decompressEnd();
  } catch (error) {
    throw libraryError(name, "zstd", error);
  }
}

function libraryError(name: string, codec: CompressionCodec, error: unknown) {
  if (error instanceof PrefixComplete) return error;
  const message = error instanceof Error ? error.message : String(error);
  // Messages this module wrote already name the file.
  if (message.startsWith(name)) return error;
  if (codec === "xz") {
    const code = /error code (\d+)/u.exec(message)?.[1];
    return new Error(`${name} ${(code && XZ_ERRORS[code]) || "could not be decompressed"}`);
  }
  if (codec === "zstd") {
    if (/truncated/iu.test(message)) return new Error(`${name} is truncated`);
    if (/checksum/iu.test(message)) return new Error(`${name} is corrupt: its Zstandard checksum does not match`);
    return new Error(`${name} is corrupt (${message.replace(/^decompress\w* failed: /u, "")})`);
  }
  if (/unexpected EOF/iu.test(message)) return new Error(`${name} is truncated`);
  // The first header was checked before decoding, so a bad header is one after a member.
  if (/invalid gzip data/iu.test(message)) return new Error(`${name} has data after its last gzip member`);
  return new Error(`${name} is corrupt (${message})`);
}

async function decodeBytes(name: string, codec: CompressionCodec, input: Uint8Array, sink: BoundedSink, maxBytes: number, partial = false) {
  try {
    if (codec === "gzip") decodeGzip(name, input, sink);
    else if (codec === "xz") await decodeXz(name, input, sink);
    else await decodeZstd(name, input, sink, maxBytes, partial);
  } catch (error) {
    if (!(error instanceof PrefixComplete)) throw error;
  }
  return sink.finish();
}

/**
 * Decodes a compressed molecular file named `name` to its text. The name must
 * declare the format its bytes are in and a text format the browser opens.
 */
export async function decodeCompressedText(name: string, input: Uint8Array, options: DecodeOptions = {}): Promise<DecodedText> {
  const label = displayName(name);
  const parsed = supportedCompressedName(label);
  if (input.length > COMPRESSED_INPUT_LIMIT) throw new Error(`${label} is larger than the ${formatMiB(COMPRESSED_INPUT_LIMIT)} limit for compressed files`);
  assertSignatureMatches(label, input, parsed.codec);
  const prefix = options.prefixBytes !== undefined;
  const maxBytes = Math.min(prefix ? options.prefixBytes! : options.maxBytes ?? MAX_DECODED_BYTES, MAX_DECODED_BYTES);
  // Sizes declared for the whole file do not limit a prefix read.
  const bytes = await decodeBytes(label, parsed.codec, input, new BoundedSink(label, maxBytes, prefix), prefix ? Number.POSITIVE_INFINITY : maxBytes, prefix);
  if (!prefix && bytes.length === 0) throw new Error(`${label} is empty once decompressed`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: !prefix }).decode(bytes);
  } catch {
    throw new Error(`${label} does not contain UTF-8 text`);
  }
  return { text, codec: parsed.codec, innerName: parsed.innerName, byteCount: bytes.length };
}

/** A bounded streaming encoder: preset 3 uses a 4 MiB dictionary, with no native or threaded runtime. */
async function encodeXz(input: Uint8Array) {
  const { initModule, createXz, LZMA_CHECK_CRC32 } = await import("node-liblzma/wasm");
  await initModule();
  const reader = new Blob([input as BlobPart]).stream().pipeThrough(createXz({ preset: 3, check: LZMA_CHECK_CRC32 })).getReader();
  const sink = new BoundedSink("The compressed copy", COMPRESSED_INPUT_LIMIT, false, false);
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; return sink.finish(); }
      if (value.length > sink.room) throw new Error(`The compressed copy exceeds the ${formatMiB(COMPRESSED_INPUT_LIMIT)} browser file limit`);
      sink.push(value);
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
}

/**
 * Compresses text in `codec`, then decodes the result and compares it with the
 * input byte for byte, so a written file reads back as exactly this text.
 */
export async function encodeCompressedText(codec: CompressionCodec, text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DECODED_BYTES) throw new Error(`Text larger than ${formatMiB(MAX_DECODED_BYTES)} cannot be compressed in the browser`);
  let output: Uint8Array;
  if (codec === "gzip") output = gzipSync(bytes, { level: 6, mtime: 0 });
  else if (codec === "zstd") output = (await Zstd.load()).compress(bytes, 3);
  else output = await encodeXz(bytes);
  if (output.length > COMPRESSED_INPUT_LIMIT) throw new Error(`The compressed copy exceeds the ${formatMiB(COMPRESSED_INPUT_LIMIT)} browser file limit`);
  const name = "The compressed copy";
  const back = await decodeBytes(name, codec, output, new BoundedSink(name, bytes.length, false, false), bytes.length);
  if (back.length !== bytes.length || back.some((value, index) => value !== bytes[index])) {
    throw new Error("The compressed copy did not read back as the same text");
  }
  return output;
}

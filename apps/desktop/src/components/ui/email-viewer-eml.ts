import { blobSource } from "@/lib/viewer-resource";
import { textPayloadKey, type ViewerSource } from "@/lib/viewer-source";

import type {
  EmailViewerMessage,
  MimeHeader,
  MimePart,
} from "./email-viewer-types";

/**
 * Lenient RFC 822/2045 `.eml` parser producing the `EmailViewerMessage` shape
 * consumed by `EmailViewer`. It never throws on malformed input: unparseable
 * structure degrades to a single text part so the viewer still renders.
 */
export type ParseEmlOptions = {
  /**
   * Stable identity prefix for derived part sources. Defaults to a content
   * hash of the message text so re-parsing the same bytes interns to the
   * same viewer resources.
   */
  identityKey?: string;
};

const MAX_MIME_DEPTH = 24;
const LINE_ENDING_PATTERN = /\r\n?/g;

export function parseEmlMessage(
  emlText: string,
  options: ParseEmlOptions = {},
): EmailViewerMessage {
  const text = emlText.replace(LINE_ENDING_PATTERN, "\n");
  const identityBase = options.identityKey ?? `eml-${textPayloadKey(text)}`;
  const { headers, body } = splitEntity(text);
  const root = parseEntityPart({
    headers,
    body,
    id: "root",
    identityBase,
    depth: 0,
  });

  return {
    id: identityBase,
    headers,
    subject: decodedHeader(headers, "subject"),
    from: decodedHeader(headers, "from"),
    to: decodedHeader(headers, "to"),
    cc: decodedHeader(headers, "cc"),
    bcc: decodedHeader(headers, "bcc"),
    sentAt: headerValue(headers, "date"),
    root,
  };
}

type MimeEntity = {
  headers: readonly MimeHeader[];
  body: string;
};

type ParseEntityInput = MimeEntity & {
  id: string;
  identityBase: string;
  depth: number;
};

function parseEntityPart({
  headers,
  body,
  id,
  identityBase,
  depth,
}: ParseEntityInput): MimePart {
  const contentType = parseParameterizedHeader(
    headerValue(headers, "content-type") ?? "text/plain",
  );
  const mimeType = contentType.value || "text/plain";
  const disposition = parseParameterizedHeader(
    headerValue(headers, "content-disposition") ?? "",
  );
  const fileName =
    readNameParameter(disposition.params, "filename") ??
    readNameParameter(contentType.params, "name");
  const base: MimePart = {
    id,
    mimeType,
    headers,
    fileName: fileName ?? null,
    disposition: disposition.value || null,
    contentId: headerValue(headers, "content-id"),
    contentLocation: headerValue(headers, "content-location"),
  };
  const encoding = (headerValue(headers, "content-transfer-encoding") ?? "")
    .trim()
    .toLowerCase();

  if (depth < MAX_MIME_DEPTH) {
    const boundary = contentType.params["boundary"];
    if (mimeType.startsWith("multipart/") && boundary) {
      const sections = splitMultipartSections(body, boundary);
      if (sections.length > 0) {
        return {
          ...base,
          children: sections.map((section, index) => {
            const entity = splitEntity(section);
            return parseEntityPart({
              ...entity,
              id: `${id}.${index + 1}`,
              identityBase,
              depth: depth + 1,
            });
          }),
        };
      }
    }

    if (mimeType === "message/rfc822" || mimeType === "message/global") {
      const nestedText = decodeBodyToText(body, encoding, "utf-8");
      const nested = splitEntity(nestedText);
      const nestedRoot = parseEntityPart({
        ...nested,
        id: `${id}.m`,
        identityBase,
        depth: depth + 1,
      });
      return {
        ...base,
        // Nested message headers (Subject/From/…) ride on the rfc822 part so
        // the email model can derive the nested viewer's message from it.
        headers: [...headers, ...nested.headers],
        children: [nestedRoot],
      };
    }
  }

  return {
    ...base,
    ...leafSource({
      body,
      encoding,
      fileName,
      id,
      identityBase,
      mimeType,
      charset: contentType.params["charset"],
    }),
  };
}

function leafSource({
  body,
  charset,
  encoding,
  fileName,
  id,
  identityBase,
  mimeType,
}: {
  body: string;
  charset: string | undefined;
  encoding: string;
  fileName: string | null | undefined;
  id: string;
  identityBase: string;
  mimeType: string;
}): Pick<MimePart, "source" | "size"> {
  const identityKey = `${identityBase}:${id}`;
  const resolvedFileName = fileName ?? defaultLeafFileName(mimeType);

  if (isTextualMime(mimeType)) {
    const text = decodeBodyToText(body, encoding, charset);
    const source: ViewerSource = {
      kind: "text",
      text,
      fileName: resolvedFileName,
      mimeType,
      identityKey,
    };
    return { source, size: text.length };
  }

  const bytes = decodeBodyToBytes(body, encoding);
  return {
    source: blobSource(bytes, {
      identityKey,
      fileName: resolvedFileName,
      mimeType,
    }),
    size: bytes.byteLength,
  };
}

function isTextualMime(mimeType: string) {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "image/svg+xml" ||
    mimeType.startsWith("message/")
  );
}

function defaultLeafFileName(mimeType: string) {
  if (mimeType === "text/html") return "message.html";
  if (mimeType === "text/plain") return "message.txt";
  return undefined;
}

// --- entity + header parsing ---------------------------------------------

function splitEntity(text: string): MimeEntity {
  const trimmed = text.startsWith("\n") ? text.slice(1) : text;
  if (trimmed !== text) {
    // Entity starts with a blank line: empty header block, all body.
    return { headers: [], body: trimmed };
  }
  const separator = text.indexOf("\n\n");
  if (separator === -1) {
    // No blank line: treat a colon-bearing block as headers-only, otherwise
    // as a bare body with no headers.
    if (looksLikeHeaderBlock(text)) {
      return { headers: parseHeaderBlock(text), body: "" };
    }
    return { headers: [], body: text };
  }
  const headerBlock = text.slice(0, separator);
  if (!looksLikeHeaderBlock(headerBlock)) {
    return { headers: [], body: text };
  }
  return {
    headers: parseHeaderBlock(headerBlock),
    body: text.slice(separator + 2),
  };
}

function looksLikeHeaderBlock(block: string) {
  const firstLine = block.slice(0, block.indexOf("\n") + 1 || undefined);
  return /^[!-9;-~]+:/.test(firstLine);
}

function parseHeaderBlock(block: string): MimeHeader[] {
  const unfolded: string[] = [];
  for (const line of block.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
      continue;
    }
    unfolded.push(line);
  }

  const headers: MimeHeader[] = [];
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push({
      name: line.slice(0, colon).trim(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return headers;
}

function headerValue(
  headers: readonly MimeHeader[],
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === lower) return header.value;
  }
  return null;
}

function decodedHeader(headers: readonly MimeHeader[], name: string) {
  const value = headerValue(headers, name);
  return value == null ? null : decodeEncodedWords(value);
}

type ParameterizedHeader = {
  value: string;
  params: Record<string, string>;
};

function parseParameterizedHeader(raw: string): ParameterizedHeader {
  const [first, ...rest] = splitOutsideQuotes(raw, ";");
  const params: Record<string, string> = {};
  const continuations = new Map<string, Map<number, string>>();

  for (const segment of rest) {
    const equals = segment.indexOf("=");
    if (equals === -1) continue;
    const rawName = segment.slice(0, equals).trim().toLowerCase();
    let value = segment.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    }

    const continuation = rawName.match(/^(.*)\*(\d+)(\*)?$/);
    if (continuation) {
      const [, baseName, indexText, extended] = continuation;
      const index = Number(indexText);
      let sections = continuations.get(baseName);
      if (!sections) {
        sections = new Map();
        continuations.set(baseName, sections);
      }
      sections.set(
        index,
        extended && index === 0 ? decodeRfc2231Value(value) : decodePercents(value, extended != null),
      );
      continue;
    }

    if (rawName.endsWith("*")) {
      params[rawName.slice(0, -1)] = decodeRfc2231Value(value);
      continue;
    }

    params[rawName] = value;
  }

  for (const [name, sections] of continuations) {
    const ordered = [...sections.entries()].sort((a, b) => a[0] - b[0]);
    params[name] = ordered.map(([, section]) => section).join("");
  }

  return { value: (first ?? "").trim().toLowerCase(), params };
}

function decodeRfc2231Value(value: string) {
  const match = value.match(/^([^']*)'[^']*'([\s\S]*)$/);
  if (!match) return decodePercents(value, true);
  const [, charset, encoded] = match;
  return decodePercentsWithCharset(encoded, charset || "utf-8");
}

function decodePercents(value: string, extended: boolean) {
  return extended ? decodePercentsWithCharset(value, "utf-8") : value;
}

function decodePercentsWithCharset(value: string, charset: string) {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "%" && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(...encoder.encode(char));
  }
  return decodeBytes(new Uint8Array(bytes), charset);
}

function splitOutsideQuotes(value: string, separator: string) {
  const segments: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && value[index - 1] !== "\\") inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

function readNameParameter(
  params: Record<string, string>,
  name: string,
): string | null {
  const value = params[name];
  if (!value) return null;
  return decodeEncodedWords(value);
}

// --- RFC 2047 encoded words -----------------------------------------------

const ENCODED_WORD_PATTERN = /=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi;

export function decodeEncodedWords(value: string): string {
  // Whitespace between two adjacent encoded words is not significant.
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(
    ENCODED_WORD_PATTERN,
    (whole, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === "b"
            ? base64ToBytes(data)
            : qEncodedToBytes(data);
        return decodeBytes(bytes, charset);
      } catch {
        return whole;
      }
    },
  );
}

function qEncodedToBytes(data: string) {
  const bytes: number[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    if (char === "_") {
      bytes.push(0x20);
      continue;
    }
    if (
      char === "=" &&
      /^[0-9A-Fa-f]{2}$/.test(data.slice(index + 1, index + 3))
    ) {
      bytes.push(Number.parseInt(data.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(char.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(bytes);
}

// --- transfer decoding ------------------------------------------------------

function decodeBodyToText(
  body: string,
  encoding: string,
  charset: string | undefined,
) {
  if (encoding === "base64") {
    try {
      return decodeBytes(base64ToBytes(body), charset ?? "utf-8");
    } catch {
      return body;
    }
  }
  if (encoding === "quoted-printable") {
    return decodeBytes(quotedPrintableToBytes(body), charset ?? "utf-8");
  }
  // 7bit / 8bit / binary / unknown: the surrounding message was already
  // decoded to a string, so the payload is used as-is.
  return body;
}

function decodeBodyToBytes(body: string, encoding: string): Uint8Array {
  if (encoding === "base64") {
    try {
      return base64ToBytes(body);
    } catch {
      return new TextEncoder().encode(body);
    }
  }
  if (encoding === "quoted-printable") {
    return quotedPrintableToBytes(body);
  }
  return new TextEncoder().encode(body);
}

function base64ToBytes(data: string) {
  const clean = data.replace(/[^A-Za-z0-9+/=]/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function quotedPrintableToBytes(body: string) {
  // Soft line breaks join the surrounding lines.
  const text = body.replace(/=\n/g, "");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (
      char === "=" &&
      /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))
    ) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(...encoder.encode(char));
  }
  return new Uint8Array(bytes);
}

function decodeBytes(bytes: Uint8Array, charset: string | undefined) {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// --- multipart --------------------------------------------------------------

function splitMultipartSections(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const closingDelimiter = `${delimiter}--`;
  const sections: string[][] = [];
  let current: string[] | null = null;

  for (const line of body.split("\n")) {
    const marker = line.trimEnd();
    if (marker === closingDelimiter) {
      if (current) sections.push(current);
      current = null;
      break;
    }
    if (marker === delimiter) {
      if (current) sections.push(current);
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current) sections.push(current);

  return sections.map((lines) => lines.join("\n"));
}

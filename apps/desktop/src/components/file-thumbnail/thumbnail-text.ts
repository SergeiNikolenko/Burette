import {
  isAbortError,
  isResourceError,
  ResourceError,
} from "@/lib/viewer-errors";
import type {
  ViewerContentBytes,
  ViewerContentIdentity,
  ViewerContentRange,
  ViewerContentStream,
} from "@/lib/viewer-resource";
import type { ViewerSource } from "@/lib/viewer-source";

import {
  cachedThumbnailResource,
  createThumbnailArtifactCache,
} from "./thumbnail-cache";
import {
  TEXT_THUMBNAIL_CACHE_MAX_ENTRIES,
  TEXT_THUMBNAIL_MAX_BYTES,
} from "./thumbnail-limits";
import { shortName, timedThumbnail } from "./thumbnail-profile";

export interface ThumbnailFileMeta {
  fileName: string;
  mimeType?: string;
  sourceKind: ViewerSource["kind"];
}

export type ThumbnailTextContent = ViewerContentIdentity &
  ViewerContentRange &
  ViewerContentStream;

export type ThumbnailBytesContent = ViewerContentIdentity & ViewerContentBytes;

const textCache = createThumbnailArtifactCache<string>({
  maxEntries: TEXT_THUMBNAIL_CACHE_MAX_ENTRIES,
});

export function getThumbnailText(
  meta: ThumbnailFileMeta,
  content: ThumbnailTextContent,
  thumbnailKey: string,
): Promise<string> {
  return cachedThumbnailResource(textCache, thumbnailKey, () =>
    timedThumbnail(`text:fetch ${shortName(meta)}`, async () => {
      if (meta.sourceKind === "url" || content.sourceKind === "url") {
        try {
          return await readThumbnailTextRange(content, "no-store");
        } catch (error) {
          if (shouldReadTextStreamPrefix(error)) {
            return readThumbnailTextStreamPrefix(content, "no-store");
          }
          throw error;
        }
      }
      return readThumbnailTextRange(content);
    }),
  );
}

export function thumbnailFileMeta({
  fileName,
  mimeType,
  sourceKind,
}: ThumbnailFileMeta): ThumbnailFileMeta {
  return { fileName, mimeType, sourceKind };
}

function shouldReadTextStreamPrefix(error: unknown): boolean {
  const candidate = resourceErrorCandidate(error);
  return Boolean(
    candidate &&
      (candidate.kind === "invalid_range" ||
        (candidate.kind === "http_error" && candidate.status === 416)),
  );
}

function resourceErrorCandidate(error: unknown):
  | {
      kind?: unknown;
      status?: unknown;
    }
  | undefined {
  if (!error || typeof error !== "object") return undefined;
  return error as { kind?: unknown; status?: unknown };
}

async function readThumbnailTextRange(
  content: ThumbnailTextContent,
  cache?: RequestCache,
) {
  const rangeRequest = {
    start: 0,
    end: TEXT_THUMBNAIL_MAX_BYTES - 1,
  };
  const range = cache
    ? await content.readRange(rangeRequest, { cache })
    : await content.readRange(rangeRequest);
  return new TextDecoder().decode(range.buffer);
}

async function readThumbnailTextStreamPrefix(
  content: ThumbnailTextContent,
  cache?: RequestCache,
) {
  const stream = cache
    ? await content.readStream({ cache })
    : await content.readStream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainingBytes = TEXT_THUMBNAIL_MAX_BYTES;
  let text = "";

  try {
    while (remainingBytes > 0) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();

      const chunk =
        value.byteLength > remainingBytes
          ? value.slice(0, remainingBytes)
          : value;
      text += decoder.decode(chunk, { stream: true });
      remainingBytes -= chunk.byteLength;

      if (chunk.byteLength < value.byteLength || remainingBytes === 0) {
        cancelThumbnailTextReader(reader);
        return text + decoder.decode();
      }
    }

    cancelThumbnailTextReader(reader);
    return text + decoder.decode();
  } catch (error) {
    throw createThumbnailTextReadError(error);
  }
}

function createThumbnailTextReadError(error: unknown): ResourceError {
  if (isResourceError(error)) return error;
  if (isAbortError(error)) {
    return new ResourceError({
      kind: "aborted",
      message: "Resource load was aborted.",
      cause: error,
    });
  }
  return new ResourceError({
    kind: "fetch_failed",
    message: "Could not read this resource.",
    cause: error,
  });
}

function cancelThumbnailTextReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    /* The preview prefix is already available; cancellation is best-effort. */
  }
}

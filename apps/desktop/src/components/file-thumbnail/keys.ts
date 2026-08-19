import type * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";
import type { ViewerDescriptor } from "@/lib/viewer-source";

import type { ThumbnailAnchor } from "./types";

export interface ThumbnailKeyInput {
  resource: ViewerResource;
  descriptor: ViewerDescriptor;
  unit?: string;
  options?: readonly ThumbnailOption[];
}

export interface ThumbnailRenderKeyInput {
  thumbnailKey: string;
  anchor: ThumbnailAnchor;
  retryKey: React.Key | null;
}

export function getThumbnailKey({
  resource,
  descriptor,
  unit = "first",
  options = [],
}: ThumbnailKeyInput): string {
  return [
    encodePart(`resource:${resource.keys.load}`),
    encodePart(`category:${descriptor.category}`),
    encodePart(`unit:${unit}`),
    ...options.map((option) => encodePart(`option:${option}`)),
  ].join("");
}

export type ThumbnailOption = string & {
  readonly __thumbnailOption: unique symbol;
};

export function thumbnailOption(
  name: string,
  value: string | number,
): ThumbnailOption {
  return `${name}:${String(value)}` as ThumbnailOption;
}

export function getThumbnailRenderKey({
  thumbnailKey,
  anchor,
  retryKey,
}: ThumbnailRenderKeyInput): string {
  return [
    encodePart(`thumbnail:${thumbnailKey}`),
    encodePart(`anchor:${anchor}`),
    encodeRetryKey(retryKey),
  ].join("");
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

function encodeRetryKey(retryKey: React.Key | null): string {
  if (retryKey === null) return encodePart("retry:null:");
  return encodePart(`retry:${typeof retryKey}:${String(retryKey)}`);
}

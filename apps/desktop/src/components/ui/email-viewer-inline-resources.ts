"use client";

import * as React from "react";

import type { ViewerSource } from "@/lib/viewer-source";

import {
  inlineResourceKeyToString,
  MISSING_EMAIL_INLINE_RESOURCE_URL,
} from "./email-viewer-model";
import type { EmailInlineResourceScope } from "./email-viewer-types";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export function useEmailInlineResourceUrls(scope: EmailInlineResourceScope) {
  const placeholderUrls = React.useMemo(
    () => createPlaceholderUrls(scope),
    [scope],
  );
  const [materialized, setMaterialized] = React.useState<{
    scope: EmailInlineResourceScope;
    urls: ReadonlyMap<string, string>;
  }>(() => ({
    scope,
    urls: placeholderUrls,
  }));

  useKeyedMountEffect(joinEffectKey([scope]), () => {
    const nextUrls = new Map<string, string>();
    const objectUrls: string[] = [];

    for (const resource of scope.resources) {
      const source = resource.node.part.source;
      if (!source) continue;

      const url = sourceToInlineUrl(source, objectUrls);
      if (!url) continue;

      for (const key of resource.keys) {
        nextUrls.set(inlineResourceKeyToString(key), url);
      }
    }

    setMaterialized({
      scope,
      urls: nextUrls,
    });

    return () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  });

  return materialized.scope === scope ? materialized.urls : placeholderUrls;
}

function createPlaceholderUrls(scope: EmailInlineResourceScope) {
  const urls = new Map<string, string>();

  for (const resource of scope.resources) {
    for (const key of resource.keys) {
      urls.set(
        inlineResourceKeyToString(key),
        MISSING_EMAIL_INLINE_RESOURCE_URL,
      );
    }
  }

  return urls;
}

function sourceToInlineUrl(source: ViewerSource, objectUrls: string[]) {
  if (source.kind === "url") return source.url;
  if (source.kind === "blob") {
    const url = URL.createObjectURL(source.blob);
    objectUrls.push(url);
    return url;
  }

  return textSourceToDataUrl(source.text, source.mimeType);
}

function textSourceToDataUrl(text: string, mimeType: string | undefined) {
  const bytes = new TextEncoder().encode(text);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType ?? "text/plain;charset=utf-8"};base64,${btoa(binary)}`;
}

"use client";

import * as React from "react";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = React.useState<string | null>(null);

  useKeyedMountEffect(joinEffectKey([blob]), () => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  });

  return url;
}

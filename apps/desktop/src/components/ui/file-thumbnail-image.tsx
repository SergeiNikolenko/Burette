"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { FileThumbnailShimmer } from "./file-thumbnail-shimmer";

export function FileThumbnailImage({
  url,
  alt,
  className,
  fallback,
  onError,
}: {
  url: string;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const didReportErrorRef = React.useRef(false);

  const reportError = React.useCallback(() => {
    if (didReportErrorRef.current) return;
    didReportErrorRef.current = true;
    onError?.();
  }, [onError]);

  // A cached image can complete before React attaches `onLoad`.
  const imgRef = React.useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      if (img.complete) {
        if (img.naturalWidth > 0) setLoaded(true);
        else {
          setFailed(true);
          reportError();
        }
      }
    },
    [reportError],
  );

  if (failed) return <>{fallback}</>;

  return (
    <>
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          reportError();
        }}
        className={cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
      {loaded ? null : <FileThumbnailShimmer />}
    </>
  );
}

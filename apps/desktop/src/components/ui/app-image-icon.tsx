import { useState } from "react";

/** Keep unavailable application artwork from rendering a broken-image symbol. */
export function AppImageIcon({ src, fallback, className }: {
  src: string;
  fallback: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return <span className={className} aria-hidden="true">{fallback}</span>;
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => setFailedSrc(src)}
    />
  );
}

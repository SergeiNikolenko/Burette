"use client";

const emittedViewerDevelopmentWarnings = new Set<string>();

export type ViewerDevelopmentWarningDetails = Record<string, unknown>;

export function warnViewerDevelopmentOnce({
  code,
  details,
  message,
  rootId,
}: {
  code: string;
  details?: ViewerDevelopmentWarningDetails;
  message: string;
  rootId: string;
}) {
  if (process.env.NODE_ENV === "production") return;

  const warningKey = `${rootId}:${code}`;
  if (emittedViewerDevelopmentWarnings.has(warningKey)) return;
  emittedViewerDevelopmentWarnings.add(warningKey);

  console.warn(`[file-viewer] ${message}`, {
    code,
    rootId,
    ...details,
  });
}

export function resetViewerDevelopmentWarningsForTests() {
  emittedViewerDevelopmentWarnings.clear();
}

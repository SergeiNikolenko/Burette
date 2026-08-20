import { Suspense, lazy } from "react";
import { basename } from "../../../lib/sidebar-projects";
import { definePageKind } from "./types";

export type DocumentLocation = { kind: "document"; path: string };

// The page-kinds barrel is statically reachable from the entry chunk, so the
// Retab surface (file-viewer, pdf-viewer, KaTeX CSS) must load behind a lazy
// boundary here, like the Ketcher page kind: molecular-only sessions never pay
// for the document viewer.
const DocumentSurface = lazy(() => import("../../document-page").then((module) => ({
  default: module.DocumentSurface,
})));

export const documentKind = definePageKind<"document", DocumentLocation>({
  kind: "document",
  title: (location) => basename(location.path),
  description: "Open document",
  Component: ({ location }) => (
    <Suspense fallback={null}>
      <DocumentSurface path={location.path} />
    </Suspense>
  ),
  keepAlive: true,
  fromPayload: (data) => (typeof data.path === "string" ? { kind: "document", path: data.path } : null),
  serialize: (location) => ({ path: location.path }),
});

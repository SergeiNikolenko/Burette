import { enumerateLibrary, LibraryInputError, libraryToSdf, type LibraryRequest } from "../lib/library-enumeration.mjs";
import { loadRDKitModule } from "../lib/rdkit-module";

export type LibraryEnumerationProgress = { done: number; total: number };
export type LibraryEnumerationResult = {
  /** The library as one SDF document; empty when no combination gave a product. */
  sdf: string;
  products: number;
  duplicates: number;
  /** Building blocks left out because they could not be read or do not fit their position. */
  skipped: number;
  withoutProduct: number;
  capped: boolean;
};

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<LibraryRequest>) => void;
  postMessage: (message: unknown) => void;
};
// A combination takes well under a millisecond; the dialog needs a few updates per second.
const PROGRESS_INTERVAL_MS = 100;

scope.onmessage = async ({ data }) => {
  try {
    const rdkit = await loadRDKitModule();
    let posted = 0;
    const library = enumerateLibrary(rdkit, data, {
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - posted < PROGRESS_INTERVAL_MS) return;
        posted = now;
        scope.postMessage({ progress: { done, total } satisfies LibraryEnumerationProgress });
      },
    });
    scope.postMessage({
      ok: true,
      result: {
        sdf: libraryToSdf(library),
        products: library.products.length,
        duplicates: library.duplicates,
        skipped: library.positions.reduce((count, position) => count + position.unreadable + position.unmatched, 0),
        withoutProduct: library.withoutProduct,
        capped: library.capped,
      } satisfies LibraryEnumerationResult,
    });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof LibraryInputError ? error.message : "The library could not be enumerated.",
    });
  }
};

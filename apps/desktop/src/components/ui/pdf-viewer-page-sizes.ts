import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import type { PdfPageSize } from "./pdf-viewer-types";
import { joinEffectKey } from "@/lib/effect-key";

export function usePdfPageSizes(resetKey: unknown) {
  const [state, setState] = React.useState<{
    resetKey: unknown;
    pageSizeByNumber: ReadonlyMap<number, PdfPageSize>;
  }>(() => ({ resetKey, pageSizeByNumber: new Map() }));

  const emptyPageSizeByNumber = React.useMemo<ReadonlyMap<number, PdfPageSize>>(
    () => new Map(),
    [],
  );
  const pageSizeByNumber = Object.is(state.resetKey, resetKey)
    ? state.pageSizeByNumber
    : emptyPageSizeByNumber;

  useKeyedMountEffect(joinEffectKey(["pdf-page-sizes", resetKey]), () => {
    setState((previousState) =>
      Object.is(previousState.resetKey, resetKey)
        ? previousState
        : { resetKey, pageSizeByNumber: new Map() },
    );
  });

  const setPageSizes = React.useCallback(
    (pageSizes: Iterable<readonly [number, PdfPageSize]>) => {
      setState((previousState) => {
        const previousPageSizeByNumber = Object.is(
          previousState.resetKey,
          resetKey,
        )
          ? previousState.pageSizeByNumber
          : emptyPageSizeByNumber;

        let nextPageSizeByNumber: Map<number, PdfPageSize> | null = null;
        for (const [pageNumber, size] of pageSizes) {
          const current = (
            nextPageSizeByNumber ?? previousPageSizeByNumber
          ).get(pageNumber);
          if (current?.width === size.width && current.height === size.height) {
            continue;
          }

          nextPageSizeByNumber ??= new Map(previousPageSizeByNumber);
          nextPageSizeByNumber.set(pageNumber, {
            width: size.width,
            height: size.height,
          });
        }

        if (!nextPageSizeByNumber) {
          return previousState;
        }
        return { resetKey, pageSizeByNumber: nextPageSizeByNumber };
      });
    },
    [emptyPageSizeByNumber, resetKey],
  );

  const setPageSize = React.useCallback(
    (pageNumber: number, size: PdfPageSize) => {
      setPageSizes([[pageNumber, size]]);
    },
    [setPageSizes],
  );

  return { pageSizeByNumber, setPageSize, setPageSizes };
}

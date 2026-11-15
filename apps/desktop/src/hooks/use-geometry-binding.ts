import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ShellActions } from "../components/types";
import type { GeometryBinding } from "../lib/geometry-binding";
import { observeGeometryBinding } from "../lib/geometry-binding-readiness";
import { logicalSourceFor, useLogicalSource } from "../lib/science-session/state";
import type { ViewerDocument } from "../types";

/** Reads a new model's baseline before any gesture or computation can own its lease. */
export function useGeometryBinding(document: ViewerDocument, send: ShellActions["runStructureViewerAction"],
  identity: object, accepts: (binding: GeometryBinding) => boolean, enabled = true) {
  const logical = useLogicalSource(document.id);
  const key = useMemo(() => ({ documentId: document.id, path: document.path, runtimePath: document.runtimePath,
    openClaimId: document.openClaimId, identity, logical, enabled }),
    [document.id, document.path, document.runtimePath, document.openClaimId, identity, logical, enabled]);
  const latest = useRef(key);
  const reader = useRef({ send, accepts });
  useLayoutEffect(() => { latest.current = key; reader.current = { send, accepts }; });
  const [state, setState] = useState<{ key: object; binding: GeometryBinding | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return observeGeometryBinding(document, reader.current.send, () => latest.current === key && logicalSourceFor(document.id) === logical,
      (binding) => {
        if (latest.current !== key) return;
        if (!reader.current.accepts(binding)) throw new Error("The scene changed. Read the current source before editing Geometry.");
        setState({ key, binding, error: null });
      }, (error) => {
        if (latest.current === key) setState({ key, binding: null, error: error instanceof Error ? error.message : String(error) });
      });
  }, [key]);
  return state?.key === key ? state : { key, binding: null, error: null };
}

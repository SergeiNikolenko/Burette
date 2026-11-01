import { useEffect, useRef } from "react";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";
import { sourceExtension, useLogicalSource } from "../science-session/state";
import { useOwnedSourceText } from "./owned-source-text";
import { openGeneratedStructure } from "./generated-document-open";
import { preparePolymerRequest, runPolymerTask, type PolymerSettings, type PolymerResult } from "./polymer-task";

/** Role indices are zero-based rows of this single source connection table, including explicit H. */
export function usePolymerSource(document: ViewerDocument | null) {
  useLogicalSource(document?.id ?? null);
  const extension = document ? sourceExtension(document) : "";
  const format: "mol" | "sdf" | null = extension === "sdf" || extension === "sd" ? "sdf" : extension === "mol" ? "mol" : null;
  const usable = document?.renderer === "molstar" && !document.mergedCollection && !document.dockingRequest && format ? document : null;
  const source = useOwnedSourceText(usable, 2_000_000, "Polymer source exceeds 2 MB.");
  const owners = useRef(new Set<() => void>());
  useEffect(() => () => { for (const release of owners.current) release(); owners.current.clear(); }, [source.revision]);
  const prepare = (settings: PolymerSettings, requestCurrent: () => boolean) => {
    const controller = new AbortController();
    const capture = source.capture(() => controller.abort());
    if (!capture || !format || source.text === null) return null;
    let request;
    try { request = preparePolymerRequest({ text: source.text, format }, settings); }
    catch (error) { capture.release(); throw error; }
    const isCurrent = () => !controller.signal.aborted && capture.isCurrent() && requestCurrent();
    const release = () => { controller.abort(); capture.release(); owners.current.delete(release); };
    owners.current.add(release);
    let pending: Promise<PolymerResult | null> | null = null, result: PolymerResult | null = null;
    const build = () => {
      if (!isCurrent()) return Promise.resolve(null);
      if (result) return Promise.resolve(result);
      if (pending) return pending;
      pending = runPolymerTask(request, { signal: controller.signal }).then(value => {
        if (!isCurrent()) return null;
        result = Object.freeze({ ...value, sourceAtomIndices: Object.freeze(value.sourceAtomIndices), repeatIndices: Object.freeze(value.repeatIndices), repeatAlternatives: Object.freeze(value.repeatAlternatives) });
        return result;
      }).finally(() => { pending = null; });
      return pending;
    };
    const create = async (actions: Pick<ShellActions, "openStructureRecords">, validateBeforeAdopt?: () => Promise<boolean>) => {
      const output = await build();
      if (!output || !isCurrent()) return [];
      return openGeneratedStructure(actions, "Polymer", "sdf", output.sdf, isCurrent, { newDocument: true, validateBeforeAdopt });
    };
    return { request, build, create, release, isCurrent };
  };
  return { ...source, format, prepare };
}

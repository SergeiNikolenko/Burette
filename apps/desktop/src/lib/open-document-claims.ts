import { invoke } from "@tauri-apps/api/core";
import { useMoleculeStore } from "../stores/molecule-store";
import { isTauriRuntime } from "./tauri";

export async function abortOpenDocumentClaims(documents: Array<{ openClaimId?: string; id?: string; virtual?: boolean; renderer?: string }>) {
  const claimIds = Array.from(new Set(
    documents
      .map((document) => document.openClaimId)
      .filter((claimId): claimId is string => Boolean(claimId)),
  ));
  await Promise.all(claimIds.map((claimId) => invoke("abort_open_document_claim", { claimId })));
  if (!isTauriRuntime()) return;
  // Virtual collections have no file claim: their unique result IDs own the
  // grid runtime instead. Never release a result already adopted by the store.
  const virtualIds = new Set(documents.flatMap((document) => (
    document.virtual && document.renderer === "grid2d" && document.id
      ? [document.id] : []
  )));
  if (virtualIds.size === 0) return;
  const adoptedIds = new Set(useMoleculeStore.getState().documents.map((document) => document.id));
  const documentIds = [...virtualIds].filter((id) => !adoptedIds.has(id));
  if (documentIds.length > 0) await invoke("grid_close_runtime", { documentIds });
}

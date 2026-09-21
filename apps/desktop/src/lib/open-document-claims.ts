import { invoke } from "@tauri-apps/api/core";

export async function abortOpenDocumentClaims(documents: Array<{ openClaimId?: string }>) {
  const claimIds = Array.from(new Set(
    documents
      .map((document) => document.openClaimId)
      .filter((claimId): claimId is string => Boolean(claimId)),
  ));
  await Promise.all(claimIds.map((claimId) => invoke("abort_open_document_claim", { claimId })));
}

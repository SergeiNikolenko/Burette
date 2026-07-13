import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";

import type { ViewerBridgeMessageBody } from "../lib/viewer-bridge-messages";
import { isTauriRuntime } from "../lib/tauri";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PubChemSearchType = "identity" | "similarity";

export function useAppPubChemMessages({ pushStatus }: { pushStatus: PushStatus }) {
  const handlePubChemSearchMessage = useCallback((body: ViewerBridgeMessageBody) => {
    if (body?.type !== "openPubChemSearch") return false;
    const searchType = body.searchType;
    const smiles = typeof body.smiles === "string" ? body.smiles.trim() : "";
    if ((searchType !== "identity" && searchType !== "similarity") || !validPubChemSmiles(smiles)) {
      pushStatus("PubChem search was rejected because the molecule does not have a complete, valid SMILES.", "error");
      return true;
    }
    void openPubChemSearch(searchType, smiles).then(() => {
      pushStatus(`Opened PubChem ${searchType === "identity" ? "identity" : "90% similarity"} search.`, "success");
    }).catch((error) => {
      pushStatus(`PubChem search failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
    return true;
  }, [pushStatus]);

  return { handlePubChemSearchMessage };
}

async function openPubChemSearch(searchType: PubChemSearchType, smiles: string) {
  if (isTauriRuntime()) {
    await invoke("open_pubchem_search", { searchType, smiles });
    return;
  }
  const url = new URL("https://pubchem.ncbi.nlm.nih.gov/search/search.cgi");
  url.searchParams.set("cmd", "search");
  url.searchParams.set("q_type", "dt");
  url.searchParams.set("q_data", smiles);
  url.searchParams.set("simp_schtp", searchType === "identity" ? "fs" : "90");
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("the browser blocked the new tab");
}

function validPubChemSmiles(smiles: string) {
  return smiles.length > 0
    && smiles.length <= 4096
    && !smiles.includes("*")
    && !Array.from(smiles).some((character) => /[\u0000-\u001F\u007F]/u.test(character));
}

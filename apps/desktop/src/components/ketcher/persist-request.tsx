import { useCallback, useSyncExternalStore } from "react";
import type { KetcherOutputFormat } from "@burette/ketcher-agent-contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download } from "@/components/ui/app-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getKetcherAgentController, subscribeKetcherAgentRegistry, type KetcherPersistWriter } from "../../lib/ketcher-agent";

const PERSIST_FORMAT_LABELS: Record<KetcherOutputFormat, string> = {
  ket: "KET",
  mol: "MOL",
  rxn: "RXN",
  sdf: "SDF",
  smiles: "SMILES",
  reaction_smiles: "Reaction SMILES",
  cdxml: "CDXML",
};

// The user-confirmation boundary for agent `request_persist`: the agent can only
// ask, and the file is written only after the user confirms here and in the save dialog.
export function KetcherPersistRequestPrompt({ tabId, onWrite }: { tabId: string; onWrite: KetcherPersistWriter }) {
  const readRequest = useCallback(() => getKetcherAgentController(tabId)?.getPersistRequest() ?? null, [tabId]);
  const request = useSyncExternalStore(subscribeKetcherAgentRegistry, readRequest);
  if (!request || (request.status !== "awaiting_user" && request.status !== "saving")) return null;
  const saving = request.status === "saving";
  return (
    <Alert className="ketcher-persist-request" aria-label="Agent save request">
      <Download aria-hidden="true" />
      <AlertTitle>Agent wants to save this structure</AlertTitle>
      <AlertDescription>
        Save as <strong>{request.fileName}</strong> ({PERSIST_FORMAT_LABELS[request.format]}). You choose where to save it next.
      </AlertDescription>
      <div className="ketcher-persist-request-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => getKetcherAgentController(tabId)?.cancelPersist()}
        >
          Decline
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void getKetcherAgentController(tabId)?.confirmPersist(onWrite)}
        >
          {saving ? <Spinner /> : null}
          Save as…
        </Button>
      </div>
    </Alert>
  );
}

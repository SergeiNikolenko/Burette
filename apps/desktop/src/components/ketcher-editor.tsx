import { useCallback, useMemo } from "react";
import { Editor } from "ketcher-react";
import type { Ketcher } from "ketcher-core";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

export type KetcherEditorApi = Pick<Ketcher, "addFragment" | "getMolfile" | "getSmiles">;

export function KetcherEditor({
  onReady,
  onStatus,
}: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus: (status: string) => void;
}) {
  const structServiceProvider = useMemo(() => new StandaloneStructServiceProvider(), []);

  const handleInit = useCallback((instance: Ketcher) => {
    onReady(instance);
    onStatus("Ready");
  }, [onReady, onStatus]);

  const handleError = useCallback((message: string) => {
    onStatus(message);
  }, [onStatus]);

  return (
    <Editor
      disableMacromoleculesEditor
      staticResourcesUrl={import.meta.env.BASE_URL}
      structServiceProvider={structServiceProvider}
      onInit={handleInit}
      errorHandler={handleError}
    />
  );
}

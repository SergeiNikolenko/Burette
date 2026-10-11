import { QueryClient, useQuery } from "@tanstack/react-query";
import type { ChemicalEditorTarget, ShellActions } from "../components/types";

// One in-memory cache per webview, shared by settings and file menus. Nothing
// persists across windows or host sessions. Document/workspace stores stay separate.
const editorQueries = new QueryClient();
const noTargets: ChemicalEditorTarget[] = [];

export function useChemicalEditorTargets(
  path: string | null,
  listTargets: ShellActions["listChemicalEditorTargets"],
) {
  const query = useQuery({
    queryKey: ["chemical-editor-targets", path],
    queryFn: () => path ? listTargets(path) : Promise.resolve(noTargets),
    enabled: path !== null,
    // This is local IPC (or a local browser adapter), not an internet request.
    networkMode: "always",
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }, editorQueries);
  return { targets: query.data ?? noTargets, loading: query.isLoading };
}

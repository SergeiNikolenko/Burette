import { useEffect, useRef, useState } from "react";
import * as tauri from "../../lib/tauri";
import type { WorkspaceSearchResult } from "../../types";

export function useFuzzySearch(
  workspaceRoot: string | null,
  query: string,
  enabled: boolean,
  limit = 30,
) {
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const normalized = query.trim();
    if (!enabled || !workspaceRoot || !normalized) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void tauri.searchWorkspace(workspaceRoot, normalized, limit)
        .then((nextResults) => {
          if (!cancelled) setResults(nextResults);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 50);

    return () => {
      cancelled = true;
      setIsSearching(false);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [enabled, limit, query, workspaceRoot]);

  return { results, isSearching };
}

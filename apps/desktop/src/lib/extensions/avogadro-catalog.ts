import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri";
import { AVOGADRO_PLUGIN_INDEX_URL, parseAvogadroPluginIndex, readBoundedText, type AvogadroPlugin } from "./avogadro-plugin-index";

export type AvogadroCatalogSnapshot = {
  plugins: readonly AvogadroPlugin[];
  /** "saved" is the reviewed copy shipped with Burette; "live" is today's index. */
  source: "none" | "saved" | "live";
  status: "idle" | "loading" | "failed";
  error: string | null;
};
type LiveLoader = (signal: AbortSignal) => Promise<string>;
type SavedLoader = () => Promise<unknown>;
const LIVE_TIMEOUT_MS = 20_000;
export const CATALOG_UNREACHABLE = "Could not reach the Avogadro plugin index. Showing the saved list.";
export const CATALOG_INVALID = "The Avogadro plugin index could not be read. Showing the saved list.";

export const loadSavedIndex: SavedLoader = async () => (await import("../../../../../config/avogadro-plugin-index.snapshot.json")).default;

export function liveIndexLoader(native = isTauriRuntime(), fetcher: typeof fetch = globalThis.fetch): LiveLoader {
  if (native) return () => invoke<string>("fetch_avogadro_plugin_index");
  return async signal => readBoundedText(await fetcher(AVOGADRO_PLUGIN_INDEX_URL, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }), signal);
}

/** Saved list first, then one live refresh at a time; a failed refresh keeps the last good list. */
export function createAvogadroCatalog({ loadSaved = loadSavedIndex, loadLive = liveIndexLoader() }: { loadSaved?: SavedLoader; loadLive?: LiveLoader } = {}) {
  let snapshot: AvogadroCatalogSnapshot = { plugins: [], source: "none", status: "idle", error: null };
  let flight: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AvogadroCatalogSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  async function refresh() {
    if (flight) return flight;
    publish({ status: "loading", error: null });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    flight = (async () => {
      if (snapshot.source === "none") {
        try { publish({ plugins: parseAvogadroPluginIndex(await loadSaved()).plugins, source: "saved" }); }
        catch { /* The live index can still provide a list. */ }
      }
      let text: string;
      try { text = await loadLive(controller.signal); }
      catch { publish({ status: "failed", error: CATALOG_UNREACHABLE }); return; }
      try {
        const { plugins } = parseAvogadroPluginIndex(JSON.parse(text));
        if (!plugins.length) throw new Error("empty");
        publish({ plugins, source: "live", status: "idle", error: null });
      } catch { publish({ status: "failed", error: CATALOG_INVALID }); }
    })().finally(() => { clearTimeout(timer); flight = undefined; });
    return flight;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
  };
}

import "./native-workspace-home.css";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PanelEmptyState } from "@/components/ui/panel-empty-state";
import { FileBlank, Search, X } from "@/components/ui/app-icons";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { Spinner } from "@/components/ui/spinner";
import type {
  NativeWorkspaceHome as HomeBridge,
  NativeWorkspaceRecentFile,
  NativeWorkspaceStructureLink,
} from "@/lib/native-mcp-workspace";
import type { ShellActions } from "../types";

const DIRECT_PDB_ID = /^[0-9][A-Za-z0-9]{3}$/u;

// The host owns chat and agent controls. This page only opens files and sketches.
export function NativeWorkspaceHome({ actions, home, active = true }: { actions: ShellActions; home: HomeBridge; active?: boolean }) {
  const [recent, setRecent] = useState<NativeWorkspaceRecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<"recent" | "open" | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NativeWorkspaceStructureLink[]>([]);
  const [searchError, setSearchError] = useState(false);
  const generation = useRef(0);
  const searchGeneration = useRef(0);
  const opening = useRef(false);
  const wasActive = useRef(active);
  const searchEnabled = Boolean(home.searchPlaceholder);
  const featured = home.featured ?? [];

  useEffect(() => {
    const current = ++generation.current;
    opening.current = false;
    setPending(null); setRecent([]); setNotice(null); setLoading(true);
    setQuery(""); setSearchResults([]); setSearching(false); setSearchError(false);
    Promise.resolve().then(() => home.recent())
      .then(files => { if (generation.current === current) setRecent(files); })
      .catch(error => {
        if (generation.current !== current) return;
        console.error("Could not load recent workspace files", error);
        setNotice("recent");
      })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; };
  }, [home, revision]);

  // Refresh recent files silently when the user returns to this tab after
  // opening structures elsewhere in the workspace.
  useEffect(() => {
    const returned = active && !wasActive.current;
    wasActive.current = active;
    if (!returned) return;
    const current = generation.current;
    Promise.resolve().then(() => home.recent())
      .then(files => { if (generation.current === current) setRecent(files); })
      .catch(() => {});
  }, [active, home]);

  useEffect(() => {
    if (!searchEnabled) return undefined;
    const trimmed = query.trim();
    const current = ++searchGeneration.current;
    if (!trimmed) {
      setSearching(false);
      setSearchResults([]);
      setSearchError(false);
      return undefined;
    }
    setSearching(true);
    setSearchError(false);
    const timer = window.setTimeout(() => {
      Promise.resolve().then(() => home.search(trimmed))
        .then(items => {
          if (searchGeneration.current !== current) return;
          setSearchResults(items);
        })
        .catch(() => {
          if (searchGeneration.current !== current) return;
          setSearchResults([]);
          setSearchError(true);
        })
        .finally(() => {
          if (searchGeneration.current === current) setSearching(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      searchGeneration.current++;
    };
  }, [home, query, searchEnabled]);

  const openTarget = async (key: string, link: string) => {
    if (opening.current) return;
    opening.current = true;
    const current = generation.current;
    setPending(key);
    setNotice(null);
    try {
      await home.open(link);
    } catch (error) {
      if (generation.current !== current) return;
      console.error("Could not open recent workspace file", error);
      setNotice("open");
    } finally {
      if (generation.current === current) {
        opening.current = false;
        setPending(null);
      }
    }
  };

  const open = (file: NativeWorkspaceRecentFile) =>
    openTarget(file.path, `/open?path=${encodeURIComponent(file.path)}`);

  const openStructure = (item: NativeWorkspaceStructureLink) =>
    openTarget(item.uri, item.uri);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || opening.current) return;
    if (DIRECT_PDB_ID.test(trimmed)) {
      const id = trimmed.toUpperCase();
      void openTarget(`pdb:${id}`, `/pdb/${id}`);
      return;
    }
    if (searchResults[0]) void openStructure(searchResults[0]);
  };

  const activeQuery = searchEnabled ? query.trim() : "";
  const showRecentEmptyState = !loading && !recent.length && !notice && featured.length === 0;

  // Laid out like a Codex list page (Archive): a large title with its action,
  // then plain pill rows.
  return (
    <div className="native-workspace-home w-full overflow-y-auto overscroll-contain px-5 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <h1 className="native-home-title">{searchEnabled ? "Burette" : "Recent files"}</h1>
          <Button type="button" className="native-home-ketcher" variant="secondary" size="xs" onClick={actions.openKetcher}>Molecular editor</Button>
        </header>
        {searchEnabled ? (
          <form className="native-home-search" role="search" onSubmit={submitSearch}>
            <span className="native-home-search-icon" aria-hidden><Search size={15} /></span>
            <input
              type="search"
              className="native-home-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={home.searchPlaceholder}
              aria-label="Search Protein Data Bank"
              spellCheck={false}
              autoComplete="off"
            />
            {searching ? <Spinner aria-label="Searching Protein Data Bank" /> : null}
            {!searching && query ? (
              <button
                type="button"
                className="native-home-search-clear"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={14} aria-hidden />
              </button>
            ) : null}
          </form>
        ) : null}
        {activeQuery ? (
          <section aria-label="Search results" aria-busy={searching} className="flex flex-col gap-1.5">
            <h2 className="native-home-section-label">Protein Data Bank</h2>
            {searching && !searchResults.length ? (
              <div role="status" className="flex items-center gap-2 px-2 py-[5px] text-sm text-(--color-text-secondary)">
                <Spinner aria-hidden />Searching RCSB PDB…
              </div>
            ) : null}
            {!searching && searchError ? (
              <p role="alert" className="px-2 text-sm text-destructive">Could not search Protein Data Bank. Try again.</p>
            ) : null}
            {!searching && !searchError && !searchResults.length ? (
              <p className="px-2 py-1 text-sm text-(--color-text-secondary)">
                {DIRECT_PDB_ID.test(activeQuery)
                  ? `Press Enter to open PDB ${activeQuery.toUpperCase()}.`
                  : "No matching PDB entries."}
              </p>
            ) : null}
            {searchResults.length > 0 ? (
              <StructureRowList items={searchResults} pending={pending} onOpen={openStructure} />
            ) : null}
          </section>
        ) : (
          <>
            {(loading || recent.length > 0 || showRecentEmptyState) ? (
              <section aria-label="Recent files" aria-busy={loading} className="flex flex-col gap-1.5">
                {searchEnabled && recent.length > 0 ? <h2 className="native-home-section-label">Recent</h2> : null}
                {loading ? <div role="status" className="flex items-center gap-2 px-2 py-[5px] text-sm text-(--color-text-secondary)"><Spinner aria-hidden />Loading recent files…</div> : null}
                {showRecentEmptyState ? <PanelEmptyState title="No recent files" icon={<FileBlank />} /> : null}
                {recent.length > 0 ? <ul className="native-home-list">
                  {recent.map(file => <li key={file.path}>
                    <button type="button" className="native-home-row" disabled={pending !== null} aria-label={`Open ${file.label}`} aria-busy={pending === file.path}
                      onClick={() => void open(file)} title={file.path}>
                      <span className="native-home-row-icon" aria-hidden><FileKindIcon kind={fileKindForPath(file.path)} /></span>
                      <span className="native-home-row-name">{file.label}</span>
                      {folderOf(file.path) ? <span className="native-home-row-folder">{folderOf(file.path)}</span> : null}
                      <span className="native-home-row-time">
                        {pending === file.path ? <Spinner aria-label="Opening file" /> : openedAgo(file.openedAt)}
                      </span>
                    </button>
                  </li>)}
                </ul> : null}
              </section>
            ) : null}
            {featured.length > 0 ? (
              <section aria-label="Examples" className="flex flex-col gap-1.5">
                <h2 className="native-home-section-label">Examples</h2>
                <StructureRowList items={featured} pending={pending} onOpen={openStructure} />
              </section>
            ) : null}
          </>
        )}
        {notice ? <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="break-words text-sm text-destructive">{notice === "recent" ? "Could not load recent files." : "Could not open this file. Try again."}</p>
          {notice === "recent" ? <Button type="button" size="xs" onClick={() => setRevision(value => value + 1)}>Retry</Button> : null}
        </div> : null}
      </div>
    </div>
  );
}

function structureSubtitle(item: NativeWorkspaceStructureLink) {
  const prefix = `${item.name} · `;
  if (item.title?.startsWith(prefix)) return item.title.slice(prefix.length);
  if (item.title && item.title !== item.name) return item.title;
  return item.description ?? "";
}

function StructureRowList({
  items,
  pending,
  onOpen,
}: {
  items: readonly NativeWorkspaceStructureLink[];
  pending: string | null;
  onOpen: (item: NativeWorkspaceStructureLink) => void | Promise<void>;
}) {
  return (
    <ul className="native-home-list">
      {items.map(item => {
        const subtitle = structureSubtitle(item);
        const badge = item.badge ?? "PDB";
        const extension = badge.toLowerCase().replace(/[^a-z0-9]/gu, "") || "pdb";
        return (
          <li key={item.uri}>
            <button
              type="button"
              className="native-home-row"
              disabled={pending !== null}
              aria-label={`Open ${item.title ?? item.name}`}
              aria-busy={pending === item.uri}
              onClick={() => void onOpen(item)}
            >
              <span className="native-home-row-icon" aria-hidden><FileKindIcon kind={fileKindForPath(`${item.name}.${extension}`)} /></span>
              <span className="native-home-row-name">{item.name}</span>
              {subtitle ? <span className="native-home-row-folder">{subtitle}</span> : null}
              <span className="native-home-row-time">
                {pending === item.uri ? <Spinner aria-label="Opening structure" /> : badge}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Downloaded PDB entries and bundled examples live in cache folders whose
// names mean nothing to the user.
function folderOf(path: string) {
  const folders = path.split(/[\\/]/u).slice(1, -1);
  if (folders[folders.length - 1] === "burette-pdb-entries") return "Protein Data Bank";
  if (folders.slice(-2).join("/") === "assets/examples") return "Burette examples";
  return folders.slice(-2).join("/");
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function openedAgo(openedAt: string) {
  const timestamp = Date.parse(openedAt);
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, "hour") : relativeTime.format(Math.round(hours / 24), "day");
}

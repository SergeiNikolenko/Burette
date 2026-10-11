import "./native-workspace-home.css";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PanelEmptyState } from "@/components/ui/panel-empty-state";
import { FileBlank } from "@/components/ui/app-icons";
import { FileKindIcon, fileKindForPath } from "../sidebar/file-kind-icon";
import { Spinner } from "@/components/ui/spinner";
import type { NativeWorkspaceHome as HomeBridge, NativeWorkspaceRecentFile } from "@/lib/native-mcp-workspace";
import type { ShellActions } from "../types";

// The host owns chat and agent controls. This page only opens files and sketches.
export function NativeWorkspaceHome({ actions, home }: { actions: ShellActions; home: HomeBridge }) {
  const [recent, setRecent] = useState<NativeWorkspaceRecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<"recent" | "open" | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const opening = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    opening.current = false;
    setPending(null); setRecent([]); setNotice(null); setLoading(true);
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

  const open = async (file: NativeWorkspaceRecentFile) => {
    if (opening.current) return;
    opening.current = true;
    const current = generation.current;
    setPending(file.path);
    setNotice(null);
    try {
      await home.open(`/open?path=${encodeURIComponent(file.path)}`);
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

  return (
    <div className="native-workspace-home h-full w-full overflow-y-auto overscroll-contain px-5 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-(length:--text-heading-lg) leading-9 font-semibold text-(--color-text)">Recent files</h1>
          <Button type="button" className="native-home-ketcher" variant="secondary" size="xs" onClick={actions.openKetcher}>Ketcher</Button>
        </header>
        <section aria-label="Recent files" aria-busy={loading} className="flex flex-col">
          {loading ? <div role="status" className="flex items-center gap-2 px-5 py-4 text-sm text-(--color-text-secondary)"><Spinner aria-hidden />Loading recent files…</div> : null}
          {!loading && !recent.length && !notice ? <PanelEmptyState title="No recent files" icon={<FileBlank />} /> : null}
          {recent.length > 0 ? <ul className="grid rounded-[20px] border border-(--color-border) px-5 py-4">
            {recent.map(file => <li key={file.path} className="min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_44px]">
              <Button type="button" variant="ghost" disabled={pending !== null} aria-label={`Open ${file.label}`} aria-busy={pending === file.path}
                onClick={() => void open(file)} title={file.path}
                className="h-auto w-full min-w-0 justify-start gap-3 rounded-lg px-0 py-1 text-left font-normal text-(--color-text)">
                <span className="shrink-0 text-(--color-text-secondary) [&_svg]:size-5" aria-hidden><FileKindIcon kind={fileKindForPath(file.path)} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{file.label}</span>
                  {folderOf(file.path) ? <span className="block truncate text-xs text-(--color-text-secondary)">{folderOf(file.path)}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-(--color-text-tertiary) tabular-nums">
                  {pending === file.path ? <Spinner aria-label="Opening file" /> : openedAgo(file.openedAt)}
                </span>
              </Button>
            </li>)}
          </ul> : null}
        </section>
        {notice ? <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="break-words text-sm text-destructive">{notice === "recent" ? "Could not load recent files." : "Could not open this file. Try again."}</p>
          {notice === "recent" ? <Button type="button" size="xs" onClick={() => setRevision(value => value + 1)}>Retry</Button> : null}
        </div> : null}
      </div>
    </div>
  );
}

// Downloaded PDB entries and bundled examples live in cache folders whose
// names mean nothing to the user.
function folderOf(path: string) {
  const folders = path.split("/").slice(1, -1);
  if (folders[folders.length - 1] === "burette-pdb-entries") return "Protein Data Bank";
  if (folders.slice(-3).join("/") === "burette-agent/assets/examples") return "Burette examples";
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

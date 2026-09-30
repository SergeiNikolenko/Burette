import "./native-workspace-home.css";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { NativeWorkspaceHome as HomeBridge, NativeWorkspaceRecentFile } from "@/lib/native-mcp-workspace";
import type { ShellActions } from "../types";

// The host owns chat and agent controls. This page only opens files and sketches.
export function NativeWorkspaceHome({ actions, home }: { actions: ShellActions; home: HomeBridge }) {
  const [recent, setRecent] = useState<NativeWorkspaceRecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    home.recent()
      .then(files => { if (current) setRecent(files); })
      .catch(error => { if (current) setNotice(message(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [home]);

  const open = async (file: NativeWorkspaceRecentFile) => {
    setPending(file.path);
    setNotice(null);
    try {
      await home.open(`/open?path=${encodeURIComponent(file.path)}`);
    } catch (error) {
      setNotice(message(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="native-workspace-home h-full w-full overflow-y-auto px-5 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-sm font-medium text-foreground">Recent files</h1>
          <Button className="native-home-ketcher" variant="ghost" size="sm" onClick={actions.openKetcher}>Ketcher</Button>
        </header>
        <section aria-label="Recent files" className="flex flex-col">
          {loading ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">Loading recent files…</p> : null}
          {!loading && !recent.length && !notice ? <p className="px-2 py-3 text-sm text-muted-foreground">No recent files yet.</p> : null}
          {recent.map(file => (
            <button key={file.path} type="button" disabled={pending !== null}
              onClick={() => void open(file)} title={file.path}
              className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{file.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{folderOf(file.path)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {pending === file.path ? <Spinner /> : openedAgo(file.openedAt)}
              </span>
            </button>
          ))}
        </section>
        {notice ? <p role="alert" className="break-words text-sm text-destructive">{notice}</p> : null}
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
  const minutes = Math.round((Date.parse(openedAt) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, "hour") : relativeTime.format(Math.round(hours / 24), "day");
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

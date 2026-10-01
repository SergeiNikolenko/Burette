import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import whatsNewFeed from "../../../../../config/whats-new.json";
import { isTauriRuntime } from "../../lib/tauri";
import { ExternalLink, Lightbulb } from "../ui/app-icons";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useAppShellPortalContainer } from "../ui/portal-container";

const RELEASES_URL = "https://github.com/SergeiNikolenko/Burette/releases";
const SEEN_VERSION_KEY = "burette.whatsNew.seenVersion";
const VISIBLE_ENTRIES = 3;

type WhatsNewEntry = { version: string; date: string; title: string };

const entries: WhatsNewEntry[] = whatsNewFeed.entries.slice(0, VISIBLE_ENTRIES);
const latestVersion = entries[0]?.version ?? "";
const dayFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

// "25 Sep": en-GB would print "Sept", which breaks the column rhythm.
function formatEntryDate(isoDate: string) {
  const date = new Date(isoDate);
  return `${dayFormat.format(date)} ${monthFormat.format(date)}`;
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function readSeenVersion() {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

async function openReleaseUrl(url: string) {
  if (isTauriRuntime()) await invoke("open_external_url", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

// Sidebar footer row with a short release timeline, modelled on the Codex app's
// "What's new" block: accent dots mark releases the user has not opened
// the popover for yet, rings mark the rest, and a hairline joins the dots.
export function WhatsNew() {
  const [seenVersion, setSeenVersion] = useState(readSeenVersion);
  const portalContainer = useAppShellPortalContainer();
  const isUnseen = (entry: WhatsNewEntry) => seenVersion === null || compareVersions(entry.version, seenVersion) > 0;
  const hasUnseen = entries.some(isUnseen);
  if (entries.length === 0) return null;

  // Mark the feed as read on close so the dots stay visible while it is open.
  const handleOpenChange = (open: boolean) => {
    if (open || !hasUnseen) return;
    try {
      localStorage.setItem(SEEN_VERSION_KEY, latestVersion);
    } catch {
      // Private storage modes only lose the read marker.
    }
    setSeenVersion(latestVersion);
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="sidebar-settings-button sidebar-whats-new-button" aria-label={hasUnseen ? "What's new, new releases" : "What's new"}>
          <span className="sidebar-settings-icon" aria-hidden="true">
            <Lightbulb size={18} color="currentColor" strokeWidth={1.8} />
          </span>
          <span className="sidebar-settings-label">What's new</span>
          {hasUnseen ? <span className="sidebar-whats-new-indicator" aria-hidden="true" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} container={portalContainer} className="w-80 gap-0 p-1">
        <div className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">What's new</div>
        <ul className="m-0 list-none p-0">
          {entries.map((entry) => (
            <li key={entry.version} className="relative">
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-hidden hover:bg-accent focus-visible:bg-accent"
                title={entry.title}
                onClick={() => void openReleaseUrl(`${RELEASES_URL}/tag/v${entry.version}`)}
              >
                <TimelineDot filled={isUnseen(entry)} />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <time dateTime={entry.date} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatEntryDate(entry.date)}
                </time>
              </button>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 -bottom-1/2 left-[15px] my-2 -translate-x-1/2 border-l border-border"
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-hidden hover:bg-accent focus-visible:bg-accent"
              onClick={() => void openReleaseUrl(RELEASES_URL)}
            >
              <TimelineDot filled={false} />
              <span className="min-w-0 flex-1 truncate">Full changelog</span>
              <ExternalLink size={14} color="currentColor" className="shrink-0 opacity-50" />
            </button>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function TimelineDot({ filled }: { filled: boolean }) {
  return (
    <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">
      {filled
        ? <span className="size-[7px] rounded-full bg-(--accent)" />
        : <span className="size-[7px] rounded-full border-[1.33px] border-current text-muted-foreground" />}
    </span>
  );
}

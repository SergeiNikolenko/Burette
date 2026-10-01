import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import whatsNewFeed from "../../../../../config/whats-new.json";
import { isTauriRuntime } from "../../lib/tauri";
import { ExternalLink, Lightbulb } from "../ui/app-icons";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useAppShellPortalContainer } from "../ui/portal-container";
import { ReleaseNotesDialog } from "./release-notes-dialog";

const RELEASES_URL = "https://github.com/SergeiNikolenko/Burette/releases";
const READ_VERSIONS_KEY = "burette.whatsNew.readVersions";
const UNREAD_SINCE_KEY = "burette.whatsNew.unreadSince";
const UNREAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
const VISIBLE_ENTRIES = 3;

export type WhatsNewEntry = (typeof whatsNewFeed.entries)[number];

const entries: WhatsNewEntry[] = whatsNewFeed.entries.slice(0, VISIBLE_ENTRIES);
const feedVersions = whatsNewFeed.entries.map((entry) => entry.version);
const dayFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

// "25 Sep": en-GB would print "Sept", which breaks the column rhythm.
function formatEntryDate(isoDate: string) {
  const date = new Date(isoDate);
  return `${dayFormat.format(date)} ${monthFormat.format(date)}`;
}

// Private storage modes only lose the read markers.
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Ignore unavailable storage.
  }
}

function storeReadVersions(versions: string[]) {
  writeStorage(READ_VERSIONS_KEY, JSON.stringify(versions));
}

const hasUnreadEntries = (readVersions: string[]) =>
  entries.some((entry) => !readVersions.includes(entry.version));

// When an update first brings unread releases, remember when. The row is a
// nudge, so it expires a day later even if it was never opened.
function unreadExpiresAt(): number {
  let since = Number.NaN;
  try {
    since = Number(localStorage.getItem(UNREAD_SINCE_KEY) ?? Number.NaN);
  } catch {
    // Fall through and start the clock now.
  }
  if (!Number.isFinite(since)) {
    since = Date.now();
    writeStorage(UNREAD_SINCE_KEY, String(since));
  }
  return since + UNREAD_LIFETIME_MS;
}

function dismissAll() {
  storeReadVersions(feedVersions);
  writeStorage(UNREAD_SINCE_KEY, null);
  return feedVersions;
}

// A fresh install has nothing to announce: the first run marks the bundled
// feed as read, so only releases that arrive with a later update show up.
function readReadVersions(): string[] {
  try {
    const stored = localStorage.getItem(READ_VERSIONS_KEY);
    if (stored === null) {
      storeReadVersions(feedVersions);
      return feedVersions;
    }
    const parsed: unknown = JSON.parse(stored);
    const read = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    if (!hasUnreadEntries(read)) {
      writeStorage(UNREAD_SINCE_KEY, null);
      return read;
    }
    return Date.now() >= unreadExpiresAt() ? dismissAll() : read;
  } catch {
    return [];
  }
}

async function openReleasesPage() {
  if (isTauriRuntime()) await invoke("open_external_url", { url: RELEASES_URL });
  else window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
}

// Sidebar footer row with a short release timeline, modelled on the Codex app's
// "What's new" block. Each release stays unread, with a blue dot, until its
// notes are opened; read releases show a ring, and a hairline joins the dots.
// The row only appears while an update has brought unread releases, and for
// at most a day after that update.
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState<WhatsNewEntry | null>(null);
  const [readVersions, setReadVersions] = useState(readReadVersions);
  const portalContainer = useAppShellPortalContainer();
  const isUnread = (entry: WhatsNewEntry) => !readVersions.includes(entry.version);
  const hasUnread = hasUnreadEntries(readVersions);

  // Covers a window that stays open past the expiry; launches check on load.
  useEffect(() => {
    if (!hasUnread) return;
    const timer = window.setTimeout(() => setReadVersions(dismissAll()), Math.max(0, unreadExpiresAt() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [hasUnread]);

  // Stay mounted while the popover or dialog is open, even after the last read.
  if (!hasUnread && !open && openEntry === null) return null;

  const showEntry = (entry: WhatsNewEntry) => {
    setOpen(false);
    setOpenEntry(entry);
    if (!isUnread(entry)) return;
    // Keep only versions still in the feed so the stored list stays bounded.
    const next = [...readVersions, entry.version].filter((version) => feedVersions.includes(version));
    storeReadVersions(next);
    if (!hasUnreadEntries(next)) writeStorage(UNREAD_SINCE_KEY, null);
    setReadVersions(next);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sidebar-settings-button sidebar-whats-new-button"
            aria-label={hasUnread ? "What's new, unread releases" : "What's new"}
          >
            <span className="sidebar-settings-icon" aria-hidden="true">
              <Lightbulb size={18} color="currentColor" strokeWidth={1.8} />
            </span>
            <span className="sidebar-settings-label">What's new</span>
            {hasUnread ? <span className="sidebar-whats-new-indicator" aria-hidden="true" /> : null}
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
                  aria-label={isUnread(entry) ? `${entry.title}, unread` : entry.title}
                  onClick={() => showEntry(entry)}
                >
                  <TimelineDot filled={isUnread(entry)} />
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
                onClick={() => {
                  setOpen(false);
                  void openReleasesPage();
                }}
              >
                <TimelineDot filled={false} />
                <span className="min-w-0 flex-1 truncate">Full changelog</span>
                <ExternalLink size={14} color="currentColor" className="shrink-0 opacity-50" />
              </button>
            </li>
          </ul>
        </PopoverContent>
      </Popover>
      <ReleaseNotesDialog entry={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}

function TimelineDot({ filled }: { filled: boolean }) {
  return (
    <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">
      {filled
        ? <span className="size-[7px] rounded-full bg-(--whats-new-dot)" />
        : <span className="size-[7px] rounded-full border-[1.33px] border-current text-muted-foreground opacity-70" />}
    </span>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import previewFormatRegistry from "../../../../../config/preview-formats.json";
import type { SidebarProjectItem } from "../../lib/sidebar-projects";
import type { SshProject } from "../../lib/ssh-projects";
import { PinFilled, SidebarFolder, SidebarGlobe, Stack } from "../ui/app-icons";
import { useAppShellPortalContainer } from "../ui/portal-container";
import { FileKindIcon, fileKindForPath } from "./file-kind-icon";
import "../editor-area/tab-hover-preview.css";
import "./sidebar-hover-card.css";

// Codex sidebar thread hover card: the first hover waits, a row entered while
// the card is open (or just closed) swaps it at once, and presses, scrolling,
// Escape and leaving the sidebar close it. It sits right of the row, top
// aligned, and stays 8px inside the window.
const OPEN_DELAY_MS = 250;
const SKIP_DELAY_MS = 300;
const SIDE_OFFSET_PX = 2;
const VIEWPORT_PADDING_PX = 8;
const ROW_SELECTOR = "[data-sidebar-hover-card]";

export type SidebarHoverCardInfo = {
  title: string;
  titleIcon?: ReactNode;
  timestamp?: number | null;
  rows: Array<{ id: string; icon: ReactNode; label: ReactNode }>;
};

// Rows publish what their card shows; the single layer reads it when it opens.
const cards = new Map<string, SidebarHoverCardInfo>();

export function useSidebarHoverCard(info: SidebarHoverCardInfo) {
  const id = useId();
  useLayoutEffect(() => {
    cards.set(id, info);
  });
  useLayoutEffect(() => () => {
    cards.delete(id);
  }, [id]);
  return { "data-sidebar-hover-card": id };
}

type Shown = { id: string; anchor: HTMLElement; moved: boolean; keyboard: boolean; now: number };

export function SidebarHoverCard({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef(shown);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const reducedMotion = useReducedMotion();
  const container = useAppShellPortalContainer();
  useLayoutEffect(() => {
    shownRef.current = shown;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer = 0;
    let pendingRow: HTMLElement | null = null;
    // A pressed row stays quiet until the pointer leaves it.
    let suppressedRow: HTMLElement | null = null;
    let closedAt = -Infinity;
    const cancel = () => { window.clearTimeout(timer); timer = 0; pendingRow = null; };
    const dismiss = (allowSkipDelay: boolean) => {
      cancel();
      if (shownRef.current) closedAt = allowSkipDelay ? performance.now() : -Infinity;
      setShown(null);
    };
    const close = () => dismiss(false);
    const show = (row: HTMLElement, keyboard: boolean) => {
      const rowId = row.dataset.sidebarHoverCard;
      if (!rowId || !row.isConnected || !cards.has(rowId)) return;
      setShown((current) => ({
        id: rowId, anchor: row, keyboard, now: Date.now(),
        moved: current != null && current.anchor !== row,
      }));
    };
    const rowOf = (target: EventTarget | null) => (
      target instanceof Element ? target.closest<HTMLElement>(ROW_SELECTOR) : null
    );

    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const row = rowOf(event.target);
      if (row !== suppressedRow) suppressedRow = null;
      // Row controls (pin, menu, rename) carry their own tooltips.
      const control = event.target instanceof Element ? event.target.closest("button, input") : null;
      if (!row || (control && control !== row && row.contains(control))) {
        if (shownRef.current || pendingRow) dismiss(true);
        return;
      }
      if (row === suppressedRow || row === pendingRow || shownRef.current?.anchor === row) return;
      cancel();
      if (shownRef.current || performance.now() - closedAt < SKIP_DELAY_MS) {
        show(row, false);
        return;
      }
      pendingRow = row;
      timer = window.setTimeout(() => {
        timer = 0;
        pendingRow = null;
        show(row, false);
      }, OPEN_DELAY_MS);
    };
    const press = (event: Event) => {
      suppressedRow = rowOf(event.target);
      close();
    };
    const pointerLeave = () => { suppressedRow = null; dismiss(true); };
    const focusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(`${ROW_SELECTOR}:focus-visible`)) return;
      cancel();
      show(target, true);
    };
    const focusOut = () => { if (shownRef.current?.keyboard) close(); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };

    root.addEventListener("pointerover", pointerOver);
    root.addEventListener("pointerleave", pointerLeave);
    root.addEventListener("pointerdown", press, true);
    root.addEventListener("contextmenu", press, true);
    root.addEventListener("dragstart", press, true);
    root.addEventListener("scroll", close, true);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", close);
    return () => {
      cancel();
      root.removeEventListener("pointerover", pointerOver);
      root.removeEventListener("pointerleave", pointerLeave);
      root.removeEventListener("pointerdown", press, true);
      root.removeEventListener("contextmenu", press, true);
      root.removeEventListener("dragstart", press, true);
      root.removeEventListener("scroll", close, true);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", close);
    };
  }, [rootRef]);

  // Side right, start aligned; flips left and shifts up to stay in the window.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!shown || !card) return;
    const rect = shown.anchor.getBoundingClientRect();
    let left = rect.right + SIDE_OFFSET_PX;
    if (left + card.offsetWidth > window.innerWidth - VIEWPORT_PADDING_PX) {
      left = Math.max(VIEWPORT_PADDING_PX, rect.left - SIDE_OFFSET_PX - card.offsetWidth);
    }
    const top = Math.max(VIEWPORT_PADDING_PX, Math.min(rect.top, window.innerHeight - VIEWPORT_PADDING_PX - card.offsetHeight));
    card.style.transform = `translate(${left}px, ${top}px)`;
  }, [shown]);

  // The card describes its row to assistive technology, as Codex does.
  useEffect(() => {
    const anchor = shown?.anchor;
    if (!anchor) return;
    anchor.setAttribute("aria-describedby", id);
    return () => anchor.removeAttribute("aria-describedby");
  }, [id, shown?.anchor]);

  const info = shown && shown.anchor.isConnected ? cards.get(shown.id) : undefined;
  if (!shown || !info || !container) return null;
  const duration = reducedMotion || shown.keyboard ? 0 : 0.15;
  return createPortal(
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      className="sidebar-hover-card"
      data-moved={shown.moved && !reducedMotion && !shown.keyboard ? "" : undefined}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={shown.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: [0.23, 1, 0.32, 1] }}
        >
          <SidebarHoverCardContent info={info} now={shown.now} />
        </motion.div>
      </AnimatePresence>
    </div>,
    container,
  );
}

function SidebarHoverCardContent({ info, now }: { info: SidebarHoverCardInfo; now: number }) {
  const timestamp = info.timestamp ?? null;
  return (
    <div className="sidebar-hover-card-frame">
      <div className="sidebar-hover-card-header">
        <div className="sidebar-hover-card-heading">
          <div className="sidebar-hover-card-title">{info.title}</div>
          {info.titleIcon ? <span className="sidebar-hover-card-title-icon">{info.titleIcon}</span> : null}
        </div>
        {timestamp != null ? (
          <time className="sidebar-hover-card-time" dateTime={new Date(timestamp).toISOString()}>
            {compactAge(timestamp, now)}
          </time>
        ) : null}
      </div>
      {info.rows.filter((row) => row.label != null && row.label !== "").map((row) => (
        <div key={row.id} className="sidebar-hover-card-row">
          <span className="sidebar-hover-card-icon" aria-hidden="true">{row.icon}</span>
          <span className="sidebar-hover-card-label">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

// Codex compact ages: minutes and hours elapsed, then calendar days, weeks,
// months and years; the floor is "1m".
function compactAge(timestamp: number, now: number) {
  const minutes = Math.max(1, Math.floor((now - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const startOfDay = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000));
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

const formatDescriptions = new Map(previewFormatRegistry.formats.flatMap((format) => (
  format.extensions.map((extension) => [extension.toLowerCase(), format.description] as const)
)));

function homeRelativePath(path: string) {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

function parentDirectory(path: string) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

function structureCountLabel(count: number) {
  return count > 0 ? `${count} structure${count === 1 ? "" : "s"}` : null;
}

function pinnedIcon(pinned: boolean) {
  return pinned ? <PinFilled aria-label="Pinned" /> : undefined;
}

export function structureHoverCard(item: SidebarProjectItem): SidebarHoverCardInfo {
  const extension = item.extension.toLowerCase();
  return {
    title: item.title,
    titleIcon: pinnedIcon(item.isPinned),
    timestamp: item.openedAt,
    rows: [
      { id: "folder", icon: <SidebarFolder />, label: homeRelativePath(parentDirectory(item.path)) },
      {
        id: "kind",
        icon: <FileKindIcon kind={fileKindForPath(item.path, item.extension)} />,
        label: formatDescriptions.get(extension) ?? (extension ? `${extension.toUpperCase()} file` : null),
      },
    ],
  };
}

export function folderHoverCard({ title, path, items, pinned = false }: {
  title: string;
  path: string | null;
  items: SidebarProjectItem[];
  pinned?: boolean;
}): SidebarHoverCardInfo {
  const openedAt = items.reduce<number | null>((latest, item) => (
    item.openedAt != null && (latest == null || item.openedAt > latest) ? item.openedAt : latest
  ), null);
  return {
    title,
    titleIcon: pinnedIcon(pinned),
    timestamp: openedAt,
    rows: [
      { id: "folder", icon: <SidebarFolder />, label: path ? homeRelativePath(path) : null },
      { id: "count", icon: <Stack />, label: structureCountLabel(items.length) },
    ],
  };
}

export function sshProjectHoverCard({ project, status, available, failed }: {
  project: SshProject;
  status: string;
  available: boolean;
  failed: boolean;
}): SidebarHoverCardInfo {
  return {
    title: project.name,
    titleIcon: pinnedIcon(Boolean(project.pinned)),
    timestamp: project.openedAt,
    rows: [
      { id: "host", icon: <SidebarGlobe />, label: project.host },
      { id: "root", icon: <SidebarFolder />, label: project.root },
      // Like Codex, only a remote host that is not connected gets a status row.
      ...(available ? [] : [{ id: "status", icon: <span className={failed ? "ssh-connection-dot failed" : "ssh-connection-dot"} />, label: status }]),
    ],
  };
}

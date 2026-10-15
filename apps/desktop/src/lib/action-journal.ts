import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";

// The action journal records what the user did — clicks, menu commands,
// shortcuts, opened files, job starts and outcomes — into ActionJournal.jsonl
// next to BuretteApp.log, so a bug report can be replayed step by step. Text
// typed into fields is never recorded, only that a field changed.

export type ActionJournalKind = "session" | "click" | "change" | "shortcut" | "menu" | "status" | "file" | "job";

type ActionJournalEntry = {
  at: string;
  kind: ActionJournalKind;
  action: string;
  target?: string;
  scope?: string;
  detail?: unknown;
};

const FLUSH_DELAY_MS = 750;
const MAX_PENDING = 400;
const LABEL_CHARS = 120;
const ACTIONABLE_SELECTOR = [
  "button", "a[href]", "summary", "select", "input", "textarea",
  "[role=button]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=tab]",
  "[role=option]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=treeitem]", "[role=row]",
].join(",");
const SCOPE_SELECTOR = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=toolbar],[role=tablist],[role=tree],nav,aside,section[aria-label],header[aria-label]";
const RECORDED_VALUE_INPUTS = new Set(["checkbox", "radio", "range", "number", "color"]);

let pending: ActionJournalEntry[] = [];
let flushTimer: number | null = null;
const instrumentedDocuments = new WeakSet<Document>();

function localTimestamp(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (value: number, size = 2) => String(Math.trunc(Math.abs(value))).padStart(size, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

function flush() {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.length === 0) return;
  const entries = pending;
  pending = [];
  void invoke("append_action_journal", { entries }).catch(() => {});
}

export function journalAction(kind: ActionJournalKind, action: string, fields: { target?: string | null; scope?: string | null; detail?: unknown } = {}) {
  if (!isTauriRuntime()) return;
  const entry: ActionJournalEntry = { at: localTimestamp(), kind, action };
  if (fields.target) entry.target = fields.target;
  if (fields.scope) entry.scope = fields.scope;
  if (fields.detail !== undefined && fields.detail !== null) entry.detail = fields.detail;
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push(entry);
  if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

function compact(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

function labelledBy(element: Element) {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) return "";
  return ids.split(/\s+/u).map(id => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
}

function elementLabel(element: Element) {
  const field = element as HTMLInputElement;
  return compact(
    element.getAttribute("aria-label")
    || labelledBy(element)
    || field.labels?.[0]?.textContent
    || element.getAttribute("title")
    || element.getAttribute("placeholder")
    || element.getAttribute("name")
    || element.textContent,
  ) || element.tagName.toLowerCase();
}

function elementScope(element: Element) {
  const scopes: string[] = [];
  let current = element.parentElement?.closest(SCOPE_SELECTOR) ?? null;
  while (current && scopes.length < 3) {
    const label = compact(current.getAttribute("aria-label") || labelledBy(current)) || current.getAttribute("role") || current.tagName.toLowerCase();
    scopes.unshift(label);
    current = current.parentElement?.closest(SCOPE_SELECTOR) ?? null;
  }
  const frame = element.ownerDocument.defaultView?.frameElement;
  if (frame) scopes.unshift(compact(frame.getAttribute("title") || frame.getAttribute("aria-label")) || "frame");
  return scopes.join(" › ");
}

function elementRole(element: Element) {
  return element.getAttribute("role") || element.tagName.toLowerCase();
}

function elementState(element: Element) {
  const state: Record<string, string> = {};
  for (const name of ["aria-pressed", "aria-checked", "aria-selected", "aria-expanded"]) {
    const value = element.getAttribute(name);
    if (value !== null) state[name.slice(5)] = value;
  }
  return Object.keys(state).length > 0 ? state : undefined;
}

// Frames have their own Element constructors, so `instanceof` misses their
// nodes; check the DOM shape instead.
function eventElement(event: Event) {
  const node = event.target as Element | null;
  return node && typeof node.closest === "function" ? node : null;
}

function recordClick(event: MouseEvent) {
  const target = eventElement(event)?.closest(ACTIONABLE_SELECTOR) ?? null;
  if (!target || target.matches("input:not([type=checkbox]):not([type=radio]),textarea,select")) return;
  journalAction("click", elementRole(target), {
    target: elementLabel(target),
    scope: elementScope(target),
    detail: elementState(target),
  });
}

function recordChange(event: Event) {
  const target = eventElement(event);
  if (!target?.matches("input,select,textarea")) return;
  const tag = target.tagName.toLowerCase();
  const type = tag === "input" ? (target as HTMLInputElement).type : tag;
  if (type === "password" || type === "file") return;
  const value = tag === "select"
    ? compact((target as HTMLSelectElement).selectedOptions[0]?.textContent || (target as HTMLSelectElement).value)
    : type === "checkbox" || type === "radio"
      ? String((target as HTMLInputElement).checked)
      : RECORDED_VALUE_INPUTS.has(type) ? (target as HTMLInputElement).value : undefined;
  journalAction("change", type, {
    target: elementLabel(target),
    scope: elementScope(target),
    detail: value === undefined ? undefined : { value },
  });
}

function recordShortcut(event: KeyboardEvent) {
  if (event.repeat || !(event.metaKey || event.ctrlKey || event.altKey) || ["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
  const combo = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Cmd", event.key.length === 1 ? event.key.toUpperCase() : event.key]
    .filter(Boolean).join("+");
  journalAction("shortcut", combo);
}

function instrumentDocument(target: Document) {
  if (instrumentedDocuments.has(target)) return;
  instrumentedDocuments.add(target);
  target.addEventListener("click", recordClick, true);
  target.addEventListener("change", recordChange, true);
  target.addEventListener("keydown", recordShortcut, true);
  // Viewer, grid and editor surfaces render in same-origin iframes; follow
  // each frame load so their controls are journaled too.
  target.addEventListener("load", (event) => {
    const frame = eventElement(event);
    if (frame?.tagName !== "IFRAME") return;
    try {
      const frameDocument = (frame as HTMLIFrameElement).contentDocument;
      if (frameDocument) instrumentDocument(frameDocument);
    } catch {
      // Cross-origin frames stay opaque.
    }
  }, true);
}

export function installActionJournal() {
  if (!isTauriRuntime()) return;
  instrumentDocument(document);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  journalAction("session", "window-opened", { detail: { url: location.search || "/" } });
}

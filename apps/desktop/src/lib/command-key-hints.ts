// Holding ⌘ numbers the rows that ⌘1–⌘9 would open, the way the Codex sidebar
// does. The numbers follow the visible order on screen: sidebar structure rows
// when the sidebar is showing any, otherwise the editor tabs. The same list
// drives the shortcut itself, so a badge always names what its key opens.

const HINT_ATTRIBUTE = "data-command-hint";
const HINT_DELAY_MS = 180;
const SIDEBAR_ROW_SELECTOR = ".sidebar-scroll [data-sidebar-structure-path]";
const TAB_SELECTOR = ".tab-strip .tab-shell";

function isRendered(element: HTMLElement) {
  return element.getClientRects().length > 0 && !element.closest('[data-expanded="false"]');
}

export function commandHintTargets(): HTMLElement[] {
  const seenPaths = new Set<string>();
  // Pinned structures also appear inside their project; number each file once.
  const rows = Array.from(document.querySelectorAll<HTMLElement>(SIDEBAR_ROW_SELECTOR)).filter((row) => {
    const path = row.dataset.sidebarStructurePath ?? "";
    if (!isRendered(row) || seenPaths.has(path)) return false;
    seenPaths.add(path);
    return true;
  });
  const targets = rows.length > 0
    ? rows
    : Array.from(document.querySelectorAll<HTMLElement>(TAB_SELECTOR)).filter(isRendered);
  return targets.slice(0, 9);
}

export function activateCommandHintTarget(position: number) {
  const target = commandHintTargets()[position - 1];
  if (!target) return false;
  const clickable = target.matches(TAB_SELECTOR) ? target.querySelector<HTMLElement>('[role="tab"]') : target;
  clickable?.click();
  return Boolean(clickable);
}

function clearHints() {
  for (const element of document.querySelectorAll(`[${HINT_ATTRIBUTE}]`)) element.removeAttribute(HINT_ATTRIBUTE);
}

export function watchCommandKeyHints() {
  let timer: number | null = null;
  const hide = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    clearHints();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const bareCommand = (event.key === "Meta" || event.key === "Control") && !event.altKey && !event.shiftKey;
    if (!bareCommand) {
      hide();
      return;
    }
    if (event.repeat || timer !== null) return;
    // A short hold keeps ⌘C, ⌘S and friends from flashing badges.
    timer = window.setTimeout(() => {
      commandHintTargets().forEach((target, index) => target.setAttribute(HINT_ATTRIBUTE, String(index + 1)));
    }, HINT_DELAY_MS);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Meta" || event.key === "Control") hide();
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", hide);
  window.addEventListener("pointerdown", hide, true);
  return () => {
    hide();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", hide);
    window.removeEventListener("pointerdown", hide, true);
  };
}

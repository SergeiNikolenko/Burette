import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus } from "../ui/app-icons";
import { useAppShellPortalContainer } from "../ui/portal-container";
import { useTabThumbnail } from "./tab-thumbnails";
import "./tab-hover-preview.css";

// Codex tab thumbnails: the first hover waits, moving to another tab swaps the
// card at once, and any press on the tab closes it.
const OPEN_DELAY_MS = 250;
const CARD_WIDTH_PX = 322;
const VIEWPORT_GUTTER_PX = 8;
const ANCHOR_GAP_PX = 2;

export type TabPreviewInfo = { title: string; subtitle: string | null; active: boolean; newTab: boolean };

type Shown = { tabId: string; anchor: HTMLElement; left: number; top: number; moved: boolean; keyboard: boolean };

export function TabHoverPreview({ stripRef, describe }: {
  stripRef: RefObject<HTMLElement | null>;
  describe: (tabId: string) => TabPreviewInfo | null;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef(shown);
  const describeRef = useRef(describe);
  const id = useId();
  const reducedMotion = useReducedMotion();
  const container = useAppShellPortalContainer();
  useLayoutEffect(() => {
    shownRef.current = shown;
    describeRef.current = describe;
  });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let timer = 0;
    let pendingShell: HTMLElement | null = null;
    // A pressed tab stays quiet until the pointer leaves it.
    let suppressedShell: HTMLElement | null = null;
    const cancel = () => { window.clearTimeout(timer); timer = 0; pendingShell = null; };
    const dismiss = () => { cancel(); setShown(null); };
    const show = (shell: HTMLElement, keyboard: boolean) => {
      const tabId = shell.dataset.tabId;
      if (!tabId || !shell.isConnected) return;
      const rect = shell.getBoundingClientRect();
      const maxLeft = window.innerWidth - VIEWPORT_GUTTER_PX - CARD_WIDTH_PX;
      setShown((current) => ({
        tabId, anchor: shell, keyboard,
        left: Math.max(VIEWPORT_GUTTER_PX, Math.min(rect.left, maxLeft)),
        top: rect.bottom + ANCHOR_GAP_PX,
        moved: current != null && current.anchor !== shell,
      }));
    };
    const shellOf = (target: EventTarget | null) => (
      target instanceof Element ? target.closest<HTMLElement>(".tab-shell[data-tab-id]") : null
    );

    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const shell = shellOf(event.target);
      if (shell !== suppressedShell) suppressedShell = null;
      if (!shell) {
        if (event.target instanceof Element && event.target.closest("button")) dismiss();
        return;
      }
      if (shell === suppressedShell || shell === pendingShell || shownRef.current?.anchor === shell) return;
      cancel();
      if (shownRef.current) {
        show(shell, false);
        return;
      }
      if (describeRef.current(shell.dataset.tabId ?? "")?.active) return;
      pendingShell = shell;
      timer = window.setTimeout(() => {
        timer = 0;
        pendingShell = null;
        show(shell, false);
      }, OPEN_DELAY_MS);
    };
    const press = (event: Event) => {
      suppressedShell = shellOf(event.target);
      dismiss();
    };
    const pointerLeave = () => { suppressedShell = null; dismiss(); };
    const focusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab" || !target.matches(":focus-visible")) return;
      const shell = shellOf(target);
      if (shell) { cancel(); show(shell, true); }
    };
    const focusOut = () => { if (shownRef.current?.keyboard) dismiss(); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };

    strip.addEventListener("pointerover", pointerOver);
    strip.addEventListener("pointerleave", pointerLeave);
    strip.addEventListener("pointerdown", press, true);
    strip.addEventListener("contextmenu", press, true);
    strip.addEventListener("dragstart", press, true);
    strip.addEventListener("scroll", dismiss, true);
    strip.addEventListener("focusin", focusIn);
    strip.addEventListener("focusout", focusOut);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", dismiss);
    return () => {
      cancel();
      strip.removeEventListener("pointerover", pointerOver);
      strip.removeEventListener("pointerleave", pointerLeave);
      strip.removeEventListener("pointerdown", press, true);
      strip.removeEventListener("contextmenu", press, true);
      strip.removeEventListener("dragstart", press, true);
      strip.removeEventListener("scroll", dismiss, true);
      strip.removeEventListener("focusin", focusIn);
      strip.removeEventListener("focusout", focusOut);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [stripRef]);

  // The card describes its tab to assistive technology, as Codex does.
  useEffect(() => {
    const tab = shown?.anchor.querySelector<HTMLElement>('[role="tab"]');
    if (!tab) return;
    tab.setAttribute("aria-describedby", id);
    return () => tab.removeAttribute("aria-describedby");
  }, [id, shown?.anchor]);

  const info = shown && shown.anchor.isConnected ? describe(shown.tabId) : null;
  if (!shown || !info || !container) return null;
  const duration = reducedMotion || shown.keyboard ? 0 : 0.15;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="tab-hover-preview"
      data-moved={shown.moved && !reducedMotion ? "" : undefined}
      style={{ transform: `translate(${shown.left}px, ${shown.top}px)` }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={shown.tabId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: [0.23, 1, 0.32, 1] }}
        >
          <TabPreviewCard tabId={shown.tabId} info={info} />
        </motion.div>
      </AnimatePresence>
    </div>,
    container,
  );
}

function TabPreviewCard({ tabId, info }: { tabId: string; info: TabPreviewInfo }) {
  const image = useTabThumbnail(info.newTab ? null : tabId);
  return (
    <div className="tab-hover-preview-frame">
      <div className="tab-hover-preview-header">
        <div className="tab-hover-preview-title">{info.title}</div>
        {image && info.subtitle ? <div className="tab-hover-preview-subtitle">{info.subtitle}</div> : null}
      </div>
      <div className="tab-hover-preview-body">
        {image ? <img alt="" src={image} className="tab-hover-preview-image" /> : (
          <div className="tab-hover-preview-fill">
            {info.newTab ? <><Plus aria-hidden />New tab</> : "Tab is suspended"}
          </div>
        )}
      </div>
    </div>
  );
}

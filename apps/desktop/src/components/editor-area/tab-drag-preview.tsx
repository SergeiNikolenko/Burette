import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppShellPortalContainer } from "../ui/portal-container";
import { useTabThumbnail } from "./tab-thumbnails";
import "./tab-hover-preview.css";

export function TabDragPreview({ tabId, title }: { tabId: string; title: string }) {
  const container = useAppShellPortalContainer();
  const image = useTabThumbnail(tabId);
  const card = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const insertion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!card.current) return;
      card.current.style.visibility = "visible";
      card.current.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 16}px)`;
      const strip = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".tab-strip");
      if (cue.current) cue.current.textContent = strip ? "Move tab" : "";
      if (insertion.current) {
        const shells = strip ? [...strip.querySelectorAll<HTMLElement>(".tab-shell")].filter(shell => shell.dataset.tabId !== tabId) : [];
        const next = shells.find(shell => { const rect = shell.getBoundingClientRect(); return event.clientX < rect.left + rect.width / 2; });
        const anchor = next ?? shells.at(-1);
        const rect = anchor?.getBoundingClientRect();
        insertion.current.style.visibility = rect ? "visible" : "hidden";
        if (rect) insertion.current.style.transform = `translate(${next ? rect.left - 2 : rect.right + 2}px, ${rect.top}px)`;
      }
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [tabId]);
  return container ? createPortal(
    <>
    <div ref={insertion} aria-hidden style={{ position: "fixed", top: 0, left: 0, width: 2, height: 28, borderRadius: 1, background: "var(--color-text)", visibility: "hidden", pointerEvents: "none", zIndex: 2147483646 }} />
    <div ref={card} className="tab-hover-preview" aria-hidden style={{ visibility: "hidden", zIndex: 2147483647, width: 240 }}>
      <div className="tab-hover-preview-header" style={{ padding: 8 }}>
        <div className="tab-hover-preview-title">{title}</div>
      </div>
      {image ? <img src={image} alt="" className="tab-hover-preview-image" /> : null}
      <div ref={cue} className="tab-hover-preview-title" style={{ paddingInline: 8 }} />
    </div>
    </>, container,
  ) : null;
}

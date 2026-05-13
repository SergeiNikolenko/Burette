import { useEffect } from "react";

export function useScrollActiveTabIntoView(activeTabId: string | null) {
  useEffect(() => {
    if (!activeTabId) return;

    const tab = document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    if (!tab) return;

    const strip = tab.closest<HTMLElement>("[data-tab-strip]");
    if (strip) {
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      const fullyVisible = tabRect.left >= stripRect.left && tabRect.right <= stripRect.right;
      if (fullyVisible) return;
    }

    tab.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);
}

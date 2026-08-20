export const PPTX_SCROLL_IDLE_MS = 120;

export interface PptxScrollActivity {
  handleScroll(): void;
  isScrolling(): boolean;
  onIdle(callback: () => void): () => void;
}

export function createPptxScrollActivity(
  idleMs = PPTX_SCROLL_IDLE_MS,
): PptxScrollActivity {
  let isScrolling = false;
  let timer = 0;
  const waiters = new Set<() => void>();

  return {
    handleScroll() {
      isScrolling = true;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        isScrolling = false;
        const pending = [...waiters];
        waiters.clear();
        for (const callback of pending) callback();
      }, idleMs);
    },
    isScrolling: () => isScrolling,
    onIdle(callback: () => void) {
      waiters.add(callback);
      return () => waiters.delete(callback);
    },
  };
}

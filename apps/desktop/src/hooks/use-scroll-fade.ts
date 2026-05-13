import { useCallback, useRef, useState } from "react";

export function useScrollFade(axis: "vertical" | "horizontal" = "vertical") {
  const [scrolledStart, setScrolledStart] = useState(false);
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const updateScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    if (axis === "vertical") {
      setScrolledStart(element.scrollTop > 4);
      setScrolledEnd(element.scrollHeight - element.scrollTop - element.clientHeight > 4);
      return;
    }

    setScrolledStart(element.scrollLeft > 4);
    setScrolledEnd(element.scrollWidth - element.scrollLeft - element.clientWidth > 4);
  }, [axis]);

  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      if (element) updateScroll();
    },
    [updateScroll],
  );

  return { setRef, scrolledStart, scrolledEnd, onScroll: updateScroll };
}

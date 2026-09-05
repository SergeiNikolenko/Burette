import { useLayoutEffect, useState, type RefObject } from "react"

function measureContentOverflow(
  container: HTMLElement | null,
  content: HTMLElement | null,
) {
  if (!container || !content) {
    return false
  }

  const contentOverflows =
    content.scrollWidth > content.clientWidth + 1 ||
    content.getBoundingClientRect().width > container.clientWidth + 1

  if (!contentOverflows) {
    return false
  }

  return content.scrollWidth > container.clientWidth + 1
}

export function useDisplayOverflowTruncated(
  containerRef: RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
  contentRef?: RefObject<HTMLElement | null>,
) {
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef?.current ?? container

    if (!container || !content) {
      setIsTruncated(false)
      return
    }

    const update = () => {
      setIsTruncated(measureContentOverflow(container, content))
    }

    update()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(update)
    observer.observe(container)
    if (content !== container) {
      observer.observe(content)
    }

    return () => {
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remeasure when display content changes
  }, deps)

  return isTruncated
}

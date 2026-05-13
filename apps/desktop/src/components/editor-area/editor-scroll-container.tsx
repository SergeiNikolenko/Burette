import type { ReactNode, Ref } from "react";

const FADE_DISTANCE = 120;
const SCROLLBAR_GUTTER = "18px";
const FADE_MASK_VERTICAL = "linear-gradient(to bottom, transparent 5%, black 15%, black 85%, transparent)";
const FADE_MASK_GUTTER = `linear-gradient(to right, black ${SCROLLBAR_GUTTER}, transparent ${SCROLLBAR_GUTTER}, transparent calc(100% - ${SCROLLBAR_GUTTER}), black calc(100% - ${SCROLLBAR_GUTTER}))`;
const FADE_MASK = `${FADE_MASK_VERTICAL}, ${FADE_MASK_GUTTER}`;

export const EDITOR_SAFE_SCROLL_MARGIN = FADE_DISTANCE + 20;
export const EDITOR_SCROLLBAR_GUTTER = SCROLLBAR_GUTTER;

function ProgressiveBlur({ position }: { position: "top" | "bottom" }) {
  const isTop = position === "top";
  const topFade = "linear-gradient(to bottom, black 40%, transparent 80%)";
  const bottomFade = "linear-gradient(to top, black 20%, transparent 60%)";
  return (
    <div
      className="editor-progressive-blur"
      style={{
        height: FADE_DISTANCE,
        left: SCROLLBAR_GUTTER,
        right: SCROLLBAR_GUTTER,
        [isTop ? "top" : "bottom"]: 0,
        WebkitMaskImage: isTop ? topFade : bottomFade,
        maskImage: isTop ? topFade : bottomFade,
      }}
    />
  );
}

export function EditorScrollContainer({
  ref,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="editor-scroll-container-shell">
      <div
        ref={ref}
        className="editor-scroll-container"
        style={{
          WebkitMaskImage: FADE_MASK,
          maskImage: FADE_MASK,
          borderTop: "12px solid transparent",
          borderBottom: "12px solid transparent",
        }}
      >
        {children}
      </div>
      <ProgressiveBlur position="top" />
      <ProgressiveBlur position="bottom" />
    </div>
  );
}

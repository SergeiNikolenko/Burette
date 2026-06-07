import type { ReactNode, Ref } from "react";

const SCROLLBAR_GUTTER = "18px";
const FADE_MASK_VERTICAL = "linear-gradient(to bottom, transparent 5%, black 15%, black 85%, transparent)";
const FADE_MASK_GUTTER = `linear-gradient(to right, black ${SCROLLBAR_GUTTER}, transparent ${SCROLLBAR_GUTTER}, transparent calc(100% - ${SCROLLBAR_GUTTER}), black calc(100% - ${SCROLLBAR_GUTTER}))`;
const FADE_MASK = `${FADE_MASK_VERTICAL}, ${FADE_MASK_GUTTER}`;

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
          WebkitMaskComposite: "source-over",
          maskComposite: "add",
          borderTop: "12px solid transparent",
          borderBottom: "12px solid transparent",
        }}
      >
        {children}
      </div>
    </div>
  );
}

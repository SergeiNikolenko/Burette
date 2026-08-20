"use client";

import * as React from "react";
import { Check, Clipboard } from "lucide-react";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import {
  MERMAID_VIEWER_STYLES,
  describeDiagram,
  estimateDiagramBodyHeight,
  readDiagramLimitMessage,
  renderDiagram,
  type DiagramState,
} from "@/components/ui/mermaid-renderer";

export { resetMermaidRendererForTests as resetMarkdownMermaidRendererForTests } from "@/components/ui/mermaid-renderer";

const MERMAID_VIEWPORT_ROOT_MARGIN = "640px 0px";

// A per-instance async store for one diagram's mermaid render. Kept per
// component (not module-global) so instances never share state — no cross-
// render notify fan-out and no shared cache keyed by a render-order id.
type MermaidDiagramStore = {
  key: string;
  result: DiagramState | null;
  listeners: Set<() => void>;
};

export function MarkdownGreenfieldDiagram({
  caption,
  componentName,
  onContentReady,
  source,
  title,
}: {
  caption?: string;
  componentName?: string;
  onContentReady?: () => void;
  source: string;
  title?: string;
}) {
  const limitMessage = React.useMemo(
    () => readDiagramLimitMessage(source),
    [source],
  );
  const diagramId = React.useId().replace(/:/g, "");
  const elementId = `markdown-diagram-${diagramId}`;
  const description = React.useMemo(() => describeDiagram(source), [source]);
  const bodyHeight = React.useMemo(
    () => estimateDiagramBodyHeight(source),
    [source],
  );
  const descriptionId = description
    ? `markdown-diagram-description-${diagramId}`
    : undefined;
  const captionId = caption
    ? `markdown-diagram-caption-${diagramId}`
    : undefined;
  const describedBy =
    [descriptionId, captionId].filter(Boolean).join(" ") || undefined;
  const [figureRef, isRenderEligible] = useMermaidRenderEligibility({
    disabled: Boolean(limitMessage),
    source,
  });

  // Derive the displayed state: a limit message fails immediately; otherwise the
  // state follows this instance's async mermaid store (loading until resolved).
  const storeRef = React.useRef<MermaidDiagramStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = { key: "", listeners: new Set(), result: null };
  }
  const store = storeRef.current;
  const renderKey =
    limitMessage || !isRenderEligible ? "" : `${elementId}\0${source}`;
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      store.listeners.add(onStoreChange);
      // Kick off (or restart on source change) the render here, in the store
      // subscription, so no effect is needed.
      if (!limitMessage && store.key !== renderKey) {
        store.key = renderKey;
        store.result = null;
        void renderDiagram(source, elementId).then((result) => {
          if (store.key !== renderKey) return;
          store.result = result;
          for (const listener of store.listeners) listener();
        });
      }
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    [elementId, limitMessage, renderKey, source, store],
  );
  const getSnapshot = React.useCallback(
    () => (store.key === renderKey ? store.result : null),
    [renderKey, store],
  );
  const resolvedState = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  );
  const state: DiagramState = limitMessage
    ? { status: "failed", message: limitMessage }
    : (resolvedState ?? { status: "loading" });

  useKeyedLayoutEffect(
    joinEffectKey([bodyHeight, onContentReady, state.status]),
    () => {
      onContentReady?.();
    },
  );

  return (
    <figure
      ref={figureRef}
      aria-describedby={describedBy}
      aria-label={title || "Mermaid diagram"}
      className="group bg-muted/30 my-5 min-h-40 overflow-hidden rounded-md border"
      data-diagram-language="mermaid"
      data-diagram-renderer={
        state.status === "ready" ? state.renderer : undefined
      }
      data-diagram-reserved-height={bodyHeight}
      data-diagram-state={state.status}
      data-pretext-component={componentName}
      role="group"
      style={
        {
          "--pretext-diagram-body-height": `${bodyHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="bg-muted/60 flex h-9 items-center gap-1 border-b px-3">
        <span className="text-muted-foreground min-w-0 truncate text-xs font-medium">
          {title || "mermaid"}
        </span>
        <DiagramCopyButton
          ariaLabel="Copy diagram source"
          className="ml-auto"
          text={source}
        />
      </div>
      {description ? (
        <p
          className="sr-only"
          data-pretext-diagram-description=""
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
      <div
        aria-label="Mermaid diagram body"
        className="h-(--pretext-diagram-body-height) overflow-auto p-4"
        data-pretext-diagram-body=""
        onKeyDown={(event) => {
          const element = event.currentTarget;
          if (event.key === "ArrowRight") {
            element.scrollLeft += 50;
            event.preventDefault();
          } else if (event.key === "ArrowLeft") {
            element.scrollLeft -= 50;
            event.preventDefault();
          } else if (event.key === "End") {
            element.scrollLeft = Math.max(
              0,
              element.scrollWidth - element.clientWidth,
            );
            event.preventDefault();
          } else if (event.key === "Home") {
            element.scrollLeft = 0;
            event.preventDefault();
          }
        }}
        role="region"
        tabIndex={0}
      >
        {state.status === "ready" ? (
          <>
            <style data-pretext-mermaid-styles="">
              {MERMAID_VIEWER_STYLES}
            </style>
            <div
              className="text-foreground"
              data-pretext-mermaid-svg=""
              dangerouslySetInnerHTML={{ __html: state.svg }}
            />
          </>
        ) : (
          <>
            {state.status === "failed" ? (
              <p
                className="border-destructive/25 bg-destructive/10 text-destructive mb-3 rounded border px-3 py-2 text-sm"
                data-pretext-diagram-error=""
                role="alert"
              >
                {state.message}
              </p>
            ) : null}
            <pre
              aria-label="Mermaid diagram source"
              className="text-muted-foreground m-0 overflow-x-auto font-mono text-[0.82em] leading-relaxed"
              tabIndex={0}
            >
              {source}
            </pre>
          </>
        )}
      </div>
      {caption ? (
        <figcaption
          className="bg-muted/30 text-muted-foreground border-t px-3 py-2 text-sm"
          data-pretext-diagram-caption=""
          id={captionId}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function useMermaidRenderEligibility({
  disabled,
  source,
}: {
  disabled: boolean;
  source: string;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [isEligible, setIsEligible] = React.useState(
    () => !disabled && typeof IntersectionObserver === "undefined",
  );

  useKeyedLayoutEffect(joinEffectKey([disabled, source]), () => {
    if (disabled) {
      setIsEligible(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsEligible(true);
      return;
    }
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting && (entry?.intersectionRatio ?? 0) <= 0) {
          return;
        }
        setIsEligible(true);
        observer.disconnect();
      },
      { root: null, rootMargin: MERMAID_VIEWPORT_ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  return [ref, isEligible] as const;
}

function DiagramCopyButton({
  ariaLabel,
  className,
  text,
}: {
  ariaLabel: string;
  className?: string;
  text: string;
}) {
  const [isCopied, setIsCopied] = React.useState(false);

  return (
    <button
      aria-label={isCopied ? "Copied" : ariaLabel}
      className={[
        "text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:outline-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setIsCopied(true);
          window.setTimeout(() => setIsCopied(false), 1200);
        });
      }}
    >
      {isCopied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Clipboard aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

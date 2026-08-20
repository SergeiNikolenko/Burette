"use client";

import * as React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
  BadgeAlert,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Info,
  Lightbulb,
  Link2,
  TriangleAlert,
} from "lucide-react";

import {
  diffLineKind,
  isSafeHighlightedCodeLine,
  MARKDOWN_CODE_HIGHLIGHT_STYLES,
  normalizeCodeLanguage,
  renderCodeLine,
  useMarkdownCodeLineHtml,
} from "./markdown-greenfield-code-highlight";
import { MarkdownGreenfieldDiagram } from "./markdown-greenfield-diagram";
import type { MarkdownGreenfieldChunk } from "./markdown-greenfield-document";
import type {
  MarkdownHastElement,
  MarkdownHastNode,
  MarkdownHastRoot,
} from "./markdown-hast-types";
import {
  sanitizeMarkdownImageUrl,
  sanitizeMarkdownMediaUrl,
  sanitizeMarkdownUrl,
} from "./markdown-url-policy";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

const MarkdownContentReadyContext = React.createContext<(() => void) | null>(
  null,
);

// The rendered body size at 100% zoom. Every other size (headings, code,
// tables, footnotes) is authored in `em` relative to this, so scaling this one
// value with the zoom `fontScale` resizes the whole document as one system.
export const MARKDOWN_GREENFIELD_BASE_FONT_PX = 15.5;
// Tailwind v4's default spacing unit (0.25rem). Scaling it with the zoom
// fontScale keeps padding/margins proportional to the body text.
export const MARKDOWN_GREENFIELD_BASE_SPACING_REM = 0.25;
const MARKDOWN_CODE_VIRTUALIZATION_LINE_THRESHOLD = 100;
const MARKDOWN_CODE_VIRTUALIZED_OVERSCAN_LINES = 12;
const MARKDOWN_CODE_VIRTUALIZED_VIEWPORT_HEIGHT_PX = 512;
const MARKDOWN_CODE_VIRTUALIZED_LINE_HEIGHT_FALLBACK_PX = 24;
const MARKDOWN_TABLE_VIRTUALIZATION_ROW_THRESHOLD = 80;
const MARKDOWN_TABLE_VIRTUALIZATION_CELL_THRESHOLD = 600;
const MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX = 36;
const MARKDOWN_TABLE_VIRTUALIZED_VIEWPORT_HEIGHT_PX = 560;
const MARKDOWN_TABLE_VIRTUALIZED_OVERSCAN_ROWS = 8;
const MARKDOWN_TABLE_NATIVE_FIND_ROWS_PER_ENTRY = 8;
const MARKDOWN_RENDERED_CHUNK_CACHE_LIMIT = 96;

const markdownRenderedChunkCache = new Map<string, React.ReactNode>();

export const MarkdownGreenfieldChunkRenderer = React.memo(
  function MarkdownGreenfieldChunkRenderer({
    activeMatchOccurrence,
    chunk,
    fontScale = 1,
    onContentReady,
    searchQuery,
    urlFragmentNavigation = true,
  }: {
    activeMatchOccurrence?: number;
    chunk: MarkdownGreenfieldChunk;
    fontScale?: number;
    onContentReady?: () => void;
    searchQuery?: string;
    urlFragmentNavigation?: boolean;
  }) {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const notifyContentReady = React.useCallback(() => {
      onContentReady?.();
    }, [onContentReady]);
    const renderedChildren = React.useMemo(
      () =>
        renderCachedHastChunkChildren(
          chunk,
          searchQuery,
          activeMatchOccurrence,
          { urlFragmentNavigation },
        ),
      [activeMatchOccurrence, chunk, searchQuery, urlFragmentNavigation],
    );

    useKeyedLayoutEffect(joinEffectKey([chunk.id, notifyContentReady]), () => {
      notifyContentReady();
      const element = ref.current;
      if (!element || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(notifyContentReady);
      observer.observe(element);
      return () => observer.disconnect();
    });

    if (chunk.isHostile) {
      return <MarkdownGreenfieldHostileChunk chunk={chunk} />;
    }

    return (
      <MarkdownContentReadyContext.Provider value={notifyContentReady}>
        <div
          ref={ref}
          className="markdown-greenfield-content text-foreground min-w-0 leading-relaxed"
          data-slot="markdown-greenfield-content"
          // Scale both the font and the spacing scale with zoom so vertical
          // rhythm tracks the type size. Tailwind v4 spacing utilities resolve to
          // calc(var(--spacing) * n), so overriding --spacing here scales every
          // margin/padding/gap inside the document at once.
          style={
            {
              "--spacing": `${(MARKDOWN_GREENFIELD_BASE_SPACING_REM * fontScale).toFixed(5)}rem`,
              fontSize: `${MARKDOWN_GREENFIELD_BASE_FONT_PX * fontScale}px`,
            } as React.CSSProperties
          }
        >
          {renderedChildren}
        </div>
      </MarkdownContentReadyContext.Provider>
    );
  },
);

function renderCachedHastChunkChildren(
  chunk: MarkdownGreenfieldChunk,
  searchQuery?: string,
  activeMatchOccurrence?: number,
  options: { urlFragmentNavigation: boolean } = {
    urlFragmentNavigation: true,
  },
) {
  const normalizedQuery = normalizeMarkdownSearchQuery(searchQuery);
  const cacheKey = joinEffectKey([
    "markdown-rendered-chunk",
    chunk,
    normalizedQuery,
    normalizedQuery ? (activeMatchOccurrence ?? -1) : -1,
    options.urlFragmentNavigation,
  ]);
  const cached = readRenderedChunkCache(cacheKey);
  if (cached !== undefined || markdownRenderedChunkCache.has(cacheKey)) {
    return cached;
  }

  const rendered = renderHastChildrenUncached({
    activeMatchOccurrence,
    children: chunk.hastChildren,
    normalizedQuery,
    urlFragmentNavigation: options.urlFragmentNavigation,
  });
  writeRenderedChunkCache(cacheKey, rendered);
  return rendered;
}

function renderHastChildren(
  children: readonly MarkdownHastNode[],
  searchQuery?: string,
  activeMatchOccurrence?: number,
  options: { urlFragmentNavigation: boolean } = {
    urlFragmentNavigation: true,
  },
) {
  return renderHastChildrenUncached({
    activeMatchOccurrence,
    children,
    normalizedQuery: normalizeMarkdownSearchQuery(searchQuery),
    urlFragmentNavigation: options.urlFragmentNavigation,
  });
}

function renderHastChildrenUncached({
  activeMatchOccurrence,
  children,
  normalizedQuery,
  urlFragmentNavigation,
}: {
  activeMatchOccurrence?: number;
  children: readonly MarkdownHastNode[];
  normalizedQuery: string;
  urlFragmentNavigation: boolean;
}) {
  const root: MarkdownHastRoot = {
    type: "root",
    children: children.map(cloneHastNode),
  };
  if (!urlFragmentNavigation) {
    suppressDomFragmentIds(root.children);
  }

  if (normalizedQuery) {
    // The counter tracks rendered occurrences in document order so the one at
    // activeMatchOccurrence (the chunk-local index of the toolbar's current
    // match) can be marked active and styled distinctly from the rest.
    highlightMarkdownSearchMatches(root.children, normalizedQuery, {
      count: 0,
      active: activeMatchOccurrence ?? -1,
    });
  }

  return toJsxRuntime(root as never, {
    Fragment,
    components: markdownComponents,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
}

function readRenderedChunkCache(key: string) {
  if (!markdownRenderedChunkCache.has(key)) return undefined;
  const rendered = markdownRenderedChunkCache.get(key);
  markdownRenderedChunkCache.delete(key);
  markdownRenderedChunkCache.set(key, rendered);
  return rendered;
}

function writeRenderedChunkCache(key: string, rendered: React.ReactNode) {
  markdownRenderedChunkCache.set(key, rendered);
  while (
    markdownRenderedChunkCache.size > MARKDOWN_RENDERED_CHUNK_CACHE_LIMIT
  ) {
    const oldestKey = markdownRenderedChunkCache.keys().next().value;
    if (!oldestKey) break;
    markdownRenderedChunkCache.delete(oldestKey);
  }
}

function normalizeMarkdownSearchQuery(searchQuery: string | undefined) {
  return searchQuery?.trim().toLowerCase() ?? "";
}

const markdownComponents = {
  a: ({
    children,
    href,
    node: _node,
    rel: _rel,
    target: _target,
    ...props
  }: any) => {
    const safeHref = sanitizeMarkdownUrl(href ?? "");
    if (!safeHref) return <span>{children}</span>;
    const text = reactNodeText(children);
    const kind = linkKindForHref(safeHref);
    const form = linkFormForHref({
      href: safeHref,
      text,
    });
    const external = kind === "external";
    return (
      <a
        {...props}
        className={[
          "text-primary decoration-muted-foreground/50 visited:text-muted-foreground font-medium [overflow-wrap:anywhere] underline underline-offset-4 hover:decoration-current",
          kind === "fragment" ? "decoration-dotted" : "",
          form !== "inline" ? "font-mono" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-pretext-link-form={form}
        data-pretext-link-kind={kind}
        href={safeHref}
        aria-label={footnoteLabelForLink({
          href: safeHref,
          label: props["aria-label"],
          text,
        })}
        rel={external ? "noopener noreferrer" : undefined}
        target={external ? "_blank" : undefined}
      >
        {children}
        {external ? (
          <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
        ) : null}
      </a>
    );
  },
  br: ({ node: _node, ...props }: any) => (
    <br {...props} data-pretext-line-break="soft" />
  ),
  abbr: ({ node: _node, ...props }: any) => (
    <abbr
      {...props}
      className="cursor-help underline decoration-dotted"
      data-pretext-raw-inline=""
    />
  ),
  blockquote: ({ children, node, ...props }: any) => {
    const alertKind = readDataProperty(node, "dataPretextAlertKind");
    const alertTitle = readDataProperty(node, "dataPretextAlertTitle");
    if (alertKind) {
      const label = String(alertTitle || alertKind);
      const Icon = alertIconForKind(alertKind);
      const alertProps = withoutPretextAlertMetadata(props);
      return (
        <aside
          {...alertProps}
          aria-label={label}
          className="bg-muted/35 my-5 rounded-md border px-4 py-3"
          data-pretext-alert-kind={alertKind}
          role="note"
        >
          <div
            className="text-foreground mb-2 flex items-center gap-2 text-[0.9em] font-semibold"
            data-pretext-alert-title=""
          >
            <Icon className="size-[1.15em]" aria-hidden="true" />
            {label}
          </div>
          <div
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            data-pretext-alert-body=""
          >
            {children}
          </div>
        </aside>
      );
    }

    return (
      <blockquote
        {...props}
        className="border-border text-muted-foreground my-4 border-l-2 pl-4 italic [&_blockquote]:my-3 [&_ol]:list-[lower-alpha] [&>ul]:my-2"
      >
        {children}
      </blockquote>
    );
  },
  code: ({ children, className, node: _node, ...props }: any) => (
    <code
      {...props}
      className={[
        "bg-muted rounded px-1 py-0.5 font-mono text-[0.88em]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </code>
  ),
  caption: ({ node: _node, ...props }: any) => (
    <caption
      {...props}
      className="text-muted-foreground caption-top px-3 py-2 text-left text-[0.85em] font-medium"
    />
  ),
  del: ({ node: _node, ...props }: any) => (
    <del
      {...props}
      className="text-muted-foreground decoration-muted-foreground/70 decoration-2"
      data-pretext-strikethrough=""
    />
  ),
  details: ({ node: _node, ...props }: any) => (
    <details {...props} className="bg-muted/25 my-4 rounded-md border p-3" />
  ),
  dl: ({ node: _node, ...props }: any) => (
    <dl {...props} className="my-4 space-y-2" data-pretext-definition-list="" />
  ),
  dt: ({ node: _node, ...props }: any) => (
    <dt {...props} className="font-semibold" data-pretext-definition-term="" />
  ),
  dd: ({ node: _node, ...props }: any) => (
    <dd
      {...props}
      className="text-muted-foreground ml-4"
      data-pretext-definition-description=""
    />
  ),
  div: ({ children, node, ...props }: any) => {
    const calloutKind = readTrustedDataProperty(node, "dataPretextCalloutKind");
    if (calloutKind) {
      const title =
        readTrustedDataProperty(node, "dataPretextCalloutTitle") ||
        calloutTitle(calloutKind);
      return (
        <aside
          aria-label={title}
          className="bg-muted/35 my-5 rounded-md border px-4 py-3"
          data-pretext-callout-kind={calloutKind}
          role="note"
        >
          <div className="mb-2 text-[0.9em] font-semibold">{title}</div>
          <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {children}
          </div>
        </aside>
      );
    }

    const componentName = readDataProperty(node, "dataPretextComponentName");
    const trusted = isTrustedPretextComponentNode(node);
    if (trusted && hasDataProperty(node, "dataPretextComponentFallback")) {
      return (
        <div
          data-pretext-component-fallback=""
          data-pretext-component-fallback-name={readDataProperty(
            node,
            "dataPretextComponentFallbackName",
          )}
          data-pretext-component-fallback-reason={readDataProperty(
            node,
            "dataPretextComponentFallbackReason",
          )}
          data-pretext-component-fallback-source={readDataProperty(
            node,
            "dataPretextComponentFallbackSource",
          )}
        >
          {children}
        </div>
      );
    }
    if (trusted && componentName === "Metric") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      return (
        <div
          className="bg-muted/25 my-4 w-fit max-w-full min-w-0 rounded-md border px-4 py-3"
          data-pretext-component="Metric"
        >
          <div className="text-muted-foreground text-[0.9em] [overflow-wrap:anywhere]">
            {readOptionalString(componentProps.label)}
          </div>
          <div className="text-[1.55em] font-semibold [overflow-wrap:anywhere]">
            {readOptionalString(componentProps.value)}
          </div>
        </div>
      );
    }
    if (trusted && componentName === "Badge") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      return (
        <span
          className="bg-muted/35 inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[0.9em] font-medium [overflow-wrap:anywhere]"
          data-pretext-component="Badge"
        >
          {readOptionalString(componentProps.label)}
        </span>
      );
    }
    if (trusted && componentName === "Callout") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      const kind = readOptionalString(componentProps.kind) ?? "note";
      const title =
        readOptionalString(componentProps.title) ?? calloutTitle(kind);
      return (
        <aside
          aria-label={title}
          className="bg-muted/35 my-5 rounded-md border px-4 py-3"
          data-pretext-callout-kind={kind}
          data-pretext-component="Callout"
          role="note"
        >
          <div className="mb-2 text-[0.9em] font-semibold">{title}</div>
          <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {children}
          </div>
        </aside>
      );
    }
    if (trusted && componentName === "Accordion") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      return (
        <details
          className="bg-muted/25 my-4 rounded-md border p-3"
          data-pretext-component="Accordion"
        >
          <summary className="cursor-pointer font-medium">
            {readOptionalString(componentProps.title)}
          </summary>
          <div className="mt-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {children}
          </div>
        </details>
      );
    }
    if (trusted && componentName === "Tabs") {
      return <MarkdownTabs node={readHastElement(node)} />;
    }
    if (trusted && componentName === "Image") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      return (
        <MarkdownImageSurface
          alt={readOptionalString(componentProps.alt) ?? ""}
          componentName="Image"
          height={readOptionalNumber(componentProps.height)}
          src={readOptionalString(componentProps.src) ?? ""}
          title={readOptionalString(componentProps.title)}
          width={readOptionalNumber(componentProps.width)}
        />
      );
    }
    if (trusted && componentName === "Video") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      return (
        <MarkdownVideoSurface
          controls={readOptionalBoolean(componentProps.controls) ?? true}
          label={readOptionalString(componentProps.label) ?? "Video"}
          loop={readOptionalBoolean(componentProps.loop) ?? false}
          muted={readOptionalBoolean(componentProps.muted) ?? false}
          src={readOptionalString(componentProps.src) ?? ""}
          title={readOptionalString(componentProps.title)}
        />
      );
    }
    if (trusted && componentName === "Diagram") {
      const componentProps = readComponentProps(
        readDataProperty(node, "dataPretextComponentProps"),
      );
      if (
        componentProps.type === "mermaid" &&
        typeof componentProps.source === "string"
      ) {
        return (
          <MarkdownMeasuredDiagram
            caption={readOptionalString(componentProps.caption)}
            componentName="Diagram"
            source={componentProps.source}
            title={readOptionalString(componentProps.title)}
          />
        );
      }
    }

    return <div {...withoutInternalPretextMetadata(props)}>{children}</div>;
  },
  h1: headingComponent(
    "h1",
    "mt-6 mb-3 first:mt-0",
    "text-[1.55em] leading-tight font-semibold tracking-tight",
  ),
  h2: headingComponent(
    "h2",
    "mt-7 mb-3 first:mt-0",
    "text-[1.3em] leading-snug font-semibold tracking-tight",
  ),
  h3: headingComponent(
    "h3",
    "mt-5 mb-2 first:mt-0",
    "text-[1.1em] leading-snug font-semibold",
  ),
  h4: headingComponent(
    "h4",
    "mt-4 mb-2 first:mt-0",
    "text-[1em] leading-snug font-semibold",
  ),
  h5: headingComponent(
    "h5",
    "mt-4 mb-1.5 first:mt-0",
    "text-[0.95em] leading-snug font-semibold",
  ),
  h6: headingComponent(
    "h6",
    "mt-4 mb-1.5 first:mt-0",
    "text-[0.9em] leading-snug font-semibold text-muted-foreground",
  ),
  hr: ({ node: _node, ...props }: any) => (
    <hr
      {...props}
      className="border-border my-10 border-0 border-t"
      data-pretext-thematic-break=""
    />
  ),
  kbd: ({ node: _node, ...props }: any) => (
    <kbd
      {...props}
      className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[0.85em]"
      data-pretext-raw-inline=""
    />
  ),
  mark: ({ node: _node, ...props }: any) => {
    const isActiveMatch = "data-pretext-search-match-active" in props;
    return (
      <mark
        {...props}
        aria-current={isActiveMatch ? "true" : undefined}
        className={[
          "text-foreground rounded px-1",
          isActiveMatch
            ? "bg-amber-400 ring-1 ring-amber-500/70 dark:bg-amber-500/70"
            : "bg-yellow-200/70 dark:bg-yellow-400/30",
        ].join(" ")}
        data-pretext-raw-inline=""
      />
    );
  },
  img: ({ alt, height, node, src, title, width }: any) => {
    if (!hasDataProperty(node, "dataPretextMarkdownImage")) return null;
    return (
      <MarkdownImageSurface
        alt={alt ?? ""}
        height={readOptionalNumber(height)}
        src={src ?? ""}
        title={title}
        width={readOptionalNumber(width)}
      />
    );
  },
  input: ({ checked, node: _node, type, ...props }: any) => {
    if (type !== "checkbox") return null;
    return (
      <input
        {...props}
        aria-label={checked ? "Completed task" : "Incomplete task"}
        aria-readonly="true"
        checked={checked}
        className="border-border accent-primary mr-2 size-3.5 rounded align-[-0.15em]"
        data-pretext-task-checkbox={checked ? "checked" : "unchecked"}
        disabled
        readOnly
        type="checkbox"
      />
    );
  },
  li: ({ children, className, node, ...props }: any) => {
    const isTask = hasDescendantElement(readHastElement(node), "input");
    return (
      <li
        {...props}
        className={[
          "leading-relaxed",
          isTask ? "list-none pl-0" : "",
          "[&>p]:my-1",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-pretext-task-list-item={isTask ? "" : undefined}
      >
        {children}
      </li>
    );
  },
  ol: ({ className, node: _node, ...props }: any) => (
    <ol
      {...props}
      className={[
        "my-3 ml-5 list-decimal space-y-1 [&_ol]:list-[lower-alpha]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  ),
  p: ({ node, ...props }: any) => {
    const element = readHastElement(node);
    const onlyImage =
      element?.children.filter((child) => !isWhitespaceText(child)).length ===
        1 &&
      readHastElement(
        element.children.find((child) => !isWhitespaceText(child)),
      )?.tagName === "img";
    if (onlyImage) {
      return (
        <div
          {...props}
          className="my-3 min-w-0 leading-relaxed [overflow-wrap:anywhere]"
        />
      );
    }
    return (
      <p
        {...props}
        className="my-4 min-w-0 leading-7 [overflow-wrap:anywhere]"
      />
    );
  },
  span: ({ className, node: _node, ...props }: any) => {
    const classes = String(className ?? "");
    if (classes.includes("katex-display")) {
      return (
        <span
          {...props}
          aria-label="Math block"
          className={[classes, "block overflow-x-auto"]
            .filter(Boolean)
            .join(" ")}
          data-pretext-math-block=""
          role="region"
          tabIndex={0}
          onKeyDown={handleHorizontalScrollKeyDown}
        />
      );
    }
    return (
      <span
        {...props}
        className={classes || undefined}
        data-pretext-math-inline={classes.includes("katex") ? "" : undefined}
      />
    );
  },
  pre: ({ children, node, ...props }: any) => {
    const code = readPreCodeElement(node);
    if (
      hasDataProperty(node, "dataMarkdownFrontmatterSource") ||
      hasDataProperty(code, "dataMarkdownFrontmatterSource")
    ) {
      return (
        <pre
          {...props}
          className="bg-muted/25 my-4 overflow-x-auto rounded-md border p-4 font-mono text-[0.9em] leading-[1.7] whitespace-pre"
          data-markdown-frontmatter-source=""
          role="region"
          tabIndex={0}
          onKeyDown={handleHorizontalScrollKeyDown}
        >
          <code>{extractHastNodeText(code).replace(/\n$/, "")}</code>
        </pre>
      );
    }

    const language = normalizeCodeLanguage(readCodeLanguage(code));
    if (language === "mermaid") {
      const metadata = readCodeMetadata(code);
      return (
        <MarkdownMeasuredDiagram
          caption={metadata.caption}
          source={extractHastNodeText(code).replace(/\n$/, "")}
          title={metadata.title}
        />
      );
    }

    return (
      <MarkdownCodeBlock
        language={language ?? "text"}
        metadata={readCodeMetadata(code)}
        source={extractHastNodeText(code).replace(/\n$/, "")}
      >
        {children}
      </MarkdownCodeBlock>
    );
  },
  section: ({ children, className, node, ...props }: any) => {
    const isFootnotes = hasDataProperty(node, "dataFootnotes");
    return (
      <section
        {...props}
        aria-label={isFootnotes ? "Footnotes" : props["aria-label"]}
        className={[
          isFootnotes
            ? "text-muted-foreground mt-10 border-t pt-5 text-[0.9em]"
            : "my-5",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </section>
    );
  },
  strong: ({ node: _node, ...props }: any) => (
    <strong {...props} className="font-semibold" />
  ),
  summary: ({ node: _node, ...props }: any) => (
    <summary {...props} className="cursor-pointer font-medium" />
  ),
  q: ({ cite, node: _node, ...props }: any) => (
    <q
      {...props}
      cite={sanitizeMarkdownUrl(cite ?? "") || undefined}
      className="italic"
      data-pretext-raw-inline=""
    />
  ),
  ins: ({ cite, node: _node, ...props }: any) => (
    <ins
      {...props}
      cite={sanitizeMarkdownUrl(cite ?? "") || undefined}
      className="underline decoration-green-600/60"
      data-pretext-raw-inline=""
    />
  ),
  cite: ({ node: _node, ...props }: any) => (
    <cite {...props} className="italic" data-pretext-raw-inline="" />
  ),
  dfn: ({ node: _node, ...props }: any) => (
    <dfn {...props} className="italic" data-pretext-raw-inline="" />
  ),
  samp: ({ node: _node, ...props }: any) => (
    <samp {...props} className="font-mono" data-pretext-raw-inline="" />
  ),
  small: ({ node: _node, ...props }: any) => (
    <small
      {...props}
      className="text-muted-foreground text-[0.85em]"
      data-pretext-raw-inline=""
    />
  ),
  sub: ({ node: _node, ...props }: any) => (
    <sub {...props} className="align-sub" data-pretext-raw-inline="" />
  ),
  sup: ({ node: _node, ...props }: any) => (
    <sup {...props} className="align-super" data-pretext-raw-inline="" />
  ),
  time: ({ node: _node, ...props }: any) => (
    <time {...props} data-pretext-raw-inline="" />
  ),
  var: ({ node: _node, ...props }: any) => (
    <var {...props} className="font-mono italic" data-pretext-raw-inline="" />
  ),
  table: MarkdownTable,
  tbody: ({ node: _node, ...props }: any) => <tbody {...props} />,
  td: ({ align, node, ...props }: any) => {
    const resolvedAlign = align ?? readHastElement(node)?.properties?.align;
    return (
      <td
        {...props}
        align={typeof resolvedAlign === "string" ? resolvedAlign : undefined}
        className="border-border border-t px-3 py-1.5 align-top [overflow-wrap:break-word] [&[align=center]]:text-center [&[align=right]]:text-right [&[align=right]]:tabular-nums"
      />
    );
  },
  th: ({ align, node, ...props }: any) => {
    const resolvedAlign = align ?? readHastElement(node)?.properties?.align;
    return (
      <th
        {...props}
        align={typeof resolvedAlign === "string" ? resolvedAlign : undefined}
        className="border-border bg-muted/55 border-b px-3 py-1.5 text-left align-top font-medium [overflow-wrap:break-word] [&[align=center]]:text-center [&[align=right]]:text-right [&[align=right]]:tabular-nums"
        scope="col"
      />
    );
  },
  thead: ({ node: _node, ...props }: any) => <thead {...props} />,
  tr: ({ node: _node, ...props }: any) => <tr {...props} />,
  ul: ({ className, node: _node, ...props }: any) => (
    <ul
      {...props}
      className={[
        "my-3 ml-5 list-disc space-y-1 [&_ul]:list-[circle]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  ),
};

function headingComponent(
  Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  blockClassName: string,
  textClassName: string,
) {
  return function Heading({ children, node, ...props }: any) {
    const id =
      typeof props.id === "string"
        ? props.id
        : readDataProperty(node, "dataPretextFragmentId");
    const text =
      extractHastText(readHastElement(node)) || reactNodeText(children);
    delete props.dataPretextFragmentId;
    delete props["data-pretext-fragment-id"];
    if (!id) {
      return (
        <Tag {...props} className={`${blockClassName} ${textClassName}`}>
          {children}
        </Tag>
      );
    }
    return (
      <div className={`group/heading relative ${blockClassName}`}>
        <Tag {...props} className={textClassName}>
          {children}
        </Tag>
        <HeadingAnchor id={id} text={text} />
      </div>
    );
  };
}

// A GitHub-style anchor that appears in the left gutter on hover/focus and
// copies a deep link to the heading. Kept as a sibling of the heading (not a
// child) so it never leaks into the heading's accessible name.
function HeadingAnchor({ id, text }: { id: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      aria-label={`Copy link to ${text}`}
      className="text-muted-foreground hover:text-foreground absolute top-1/2 -left-7 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-opacity group-hover/heading:opacity-100 focus-visible:opacity-100"
      type="button"
      onClick={() => {
        copyHeadingLink(id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Link2 className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

function MarkdownGreenfieldHostileChunk({
  chunk,
}: {
  chunk: MarkdownGreenfieldChunk;
}) {
  const sourceLines = React.useMemo(
    () => chunk.sourceText.split(/\r\n|[\n\r\u2028\u2029]/),
    [chunk.sourceText],
  );
  const [scrollTop, setScrollTop] = React.useState(0);
  const lineHeight = 24;
  const viewportHeight = 576;
  const start = Math.max(0, Math.floor(scrollTop / lineHeight) - 12);
  const end = Math.min(
    sourceLines.length,
    Math.ceil((scrollTop + viewportHeight) / lineHeight) + 12,
  );
  const mountedLines = sourceLines.slice(start, end);
  const omittedLines = Math.max(0, sourceLines.length - mountedLines.length);

  return (
    <section
      aria-label="Large Markdown block"
      className="bg-muted/25 text-muted-foreground overflow-hidden rounded-md border text-sm"
      data-markdown-hostile-fallback=""
      data-markdown-hostile-line-count={sourceLines.length}
      data-markdown-hostile-mounted-lines={mountedLines.length}
      data-markdown-hostile-omitted-lines={omittedLines}
      data-markdown-hostile-virtualized=""
    >
      <div className="bg-muted/55 text-foreground flex items-center justify-between gap-3 border-b px-3 py-2 font-medium">
        Large Markdown block
        <button
          aria-label="Copy large Markdown block source"
          className="text-muted-foreground text-xs underline underline-offset-4"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(chunk.sourceText)}
        >
          Copy
        </button>
      </div>
      <pre
        aria-label="Large Markdown source preview"
        className="bg-background/60 max-h-[36rem] overflow-auto font-mono text-[13px] whitespace-pre"
        data-markdown-hostile-preview=""
        role="region"
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <code
          className="relative block min-w-max"
          data-markdown-hostile-scroll-canvas=""
          style={{ height: Math.max(sourceLines.length, 1) * lineHeight }}
        >
          {mountedLines.map((line, index) => {
            const lineNumber = start + index + 1;
            return (
              <span
                key={lineNumber}
                className="absolute inset-x-0 grid grid-cols-[4rem_minmax(0,1fr)] px-4"
                data-markdown-hostile-line={lineNumber}
                style={{
                  height: lineHeight,
                  lineHeight: `${lineHeight}px`,
                  top: (lineNumber - 1) * lineHeight,
                }}
              >
                <span
                  aria-hidden="true"
                  className="text-muted-foreground pr-4 text-right select-none"
                >
                  {lineNumber}
                </span>
                <span>{line || " "}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </section>
  );
}

function MarkdownCodeBlock({
  children: _children,
  language,
  metadata,
  source,
}: {
  children: React.ReactNode;
  language: string;
  metadata: ReturnType<typeof readCodeMetadata>;
  source: string;
}) {
  const [copyFailed, setCopyFailed] = React.useState(false);
  const title = metadata.title || language;
  const sourceLines = React.useMemo(() => source.split("\n"), [source]);
  const lineNumberStart = metadata.lineNumberStart ?? 1;
  const lineNumberMaxDigits = String(
    lineNumberStart + Math.max(0, sourceLines.length - 1),
  ).length;

  const copy = React.useCallback(
    async (selectedOnly: boolean) => {
      const selection = window.getSelection();
      const selectedText =
        selectedOnly && selection?.rangeCount
          ? selection.toString().trimEnd()
          : "";
      try {
        await navigator.clipboard?.writeText(selectedText || source);
        setCopyFailed(false);
      } catch {
        setCopyFailed(true);
      }
    },
    [source],
  );

  return (
    <figure
      aria-label={`${title} code block`}
      // text-[1em] keeps the code block on the document's scaling em cascade:
      // a host stylesheet (e.g. the demo's rehype-pretty-code rule) may pin
      // [data-rehype-pretty-code-figure] to a fixed font-size, which would stop
      // the block from following the zoom control. A utility-layer size wins.
      className="bg-muted/25 my-5 overflow-hidden rounded-md border text-[1em]"
      data-pretext-code-language={language}
      data-rehype-pretty-code-figure=""
      role="group"
    >
      <figcaption className="bg-muted/55 flex items-center justify-between gap-3 border-b px-3 py-2 text-sm">
        <span
          className="text-muted-foreground font-mono text-xs font-medium"
          data-pretext-code-title={metadata.title || undefined}
        >
          {title}
        </span>
        <span className="flex items-center gap-2">
          {copyFailed ? (
            <span aria-label="Copy failed" className="text-destructive text-xs">
              Copy failed
            </span>
          ) : null}
          <button
            aria-label="Copy code block"
            className="text-muted-foreground text-xs underline underline-offset-4"
            type="button"
            onClick={() => void copy(false)}
          >
            Copy
          </button>
          <button
            aria-label="Copy selected code or block"
            className="sr-only"
            type="button"
            onClick={() => void copy(true)}
          />
        </span>
      </figcaption>
      <MarkdownCodeSource
        language={language}
        lineNumberMaxDigits={lineNumberMaxDigits}
        lineNumberStart={lineNumberStart}
        metadata={metadata}
        sourceLines={sourceLines}
      />
      {metadata.caption ? (
        <figcaption
          className="text-muted-foreground border-t px-3 py-2 text-[0.9em]"
          data-pretext-code-caption=""
        >
          {metadata.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

type MarkdownCodeMetadata = ReturnType<typeof readCodeMetadata>;

const MarkdownCodeSource = React.memo(function MarkdownCodeSource({
  language,
  lineNumberMaxDigits,
  lineNumberStart,
  metadata,
  sourceLines,
}: {
  language: string;
  lineNumberMaxDigits: number;
  lineNumberStart: number;
  metadata: MarkdownCodeMetadata;
  sourceLines: readonly string[];
}) {
  const isVirtualized =
    sourceLines.length > MARKDOWN_CODE_VIRTUALIZATION_LINE_THRESHOLD;
  const lineHtmlByIndex = useMarkdownCodeLineHtml({
    end: isVirtualized ? 0 : sourceLines.length,
    highlightPattern: metadata.highlightPattern,
    language,
    sourceLines,
    start: 0,
  });

  if (isVirtualized) {
    return (
      <MarkdownVirtualizedCodeSource
        language={language}
        lineNumberMaxDigits={lineNumberMaxDigits}
        lineNumberStart={lineNumberStart}
        metadata={metadata}
        sourceLines={sourceLines}
      />
    );
  }

  return (
    <>
      <style data-pretext-code-highlight-styles="">
        {MARKDOWN_CODE_HIGHLIGHT_STYLES}
      </style>
      <pre
        aria-label={`${language} code source`}
        className="overflow-x-auto p-3 [overflow-wrap:normal] [&_code]:min-w-max"
        data-pretext-code-source=""
        role="region"
        tabIndex={0}
        onKeyDown={handleHorizontalScrollKeyDown}
      >
        <code
          {...markdownCodeElementProps({
            language,
            lineNumberMaxDigits,
            lineNumberStart,
            metadata,
          })}
        >
          {sourceLines.map((line, index) => (
            <MarkdownCodeLine
              key={index}
              index={index}
              language={language}
              line={line}
              lineHtml={lineHtmlByIndex.get(index)}
              lineNumberStart={lineNumberStart}
              metadata={metadata}
            />
          ))}
        </code>
      </pre>
    </>
  );
});

function MarkdownVirtualizedCodeSource({
  language,
  lineNumberMaxDigits,
  lineNumberStart,
  metadata,
  sourceLines,
}: {
  language: string;
  lineNumberMaxDigits: number;
  lineNumberStart: number;
  metadata: MarkdownCodeMetadata;
  sourceLines: readonly string[];
}) {
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const codeRef = React.useRef<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [lineHeight, setLineHeight] = React.useState(
    MARKDOWN_CODE_VIRTUALIZED_LINE_HEIGHT_FALLBACK_PX,
  );
  const [viewportHeight, setViewportHeight] = React.useState(
    MARKDOWN_CODE_VIRTUALIZED_VIEWPORT_HEIGHT_PX,
  );
  const start = Math.max(
    0,
    Math.floor(scrollTop / lineHeight) -
      MARKDOWN_CODE_VIRTUALIZED_OVERSCAN_LINES,
  );
  const end = Math.min(
    sourceLines.length,
    Math.ceil((scrollTop + viewportHeight) / lineHeight) +
      MARKDOWN_CODE_VIRTUALIZED_OVERSCAN_LINES,
  );
  const mountedLines = sourceLines.slice(start, end);
  const lineWidthCh = React.useMemo(
    () => widestMarkdownCodeLineWidthCh(sourceLines),
    [sourceLines],
  );
  const lineHtmlByIndex = useMarkdownCodeLineHtml({
    end,
    highlightPattern: metadata.highlightPattern,
    language,
    sourceLines,
    start,
  });

  useKeyedLayoutEffect(joinEffectKey([language, sourceLines.length]), () => {
    const updateMetrics = () => {
      const measuredLineHeight = measureMarkdownCodeLineHeight(codeRef.current);
      if (measuredLineHeight > 0) {
        setLineHeight((current) =>
          Math.abs(current - measuredLineHeight) > 0.5
            ? measuredLineHeight
            : current,
        );
      }
      const measuredViewportHeight = preRef.current?.clientHeight ?? 0;
      if (measuredViewportHeight > 0) {
        setViewportHeight((current) =>
          Math.abs(current - measuredViewportHeight) > 0.5
            ? measuredViewportHeight
            : current,
        );
      }
    };

    updateMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMetrics);
    if (preRef.current) observer.observe(preRef.current);
    if (codeRef.current) observer.observe(codeRef.current);
    return () => observer.disconnect();
  });

  return (
    <>
      <style data-pretext-code-highlight-styles="">
        {MARKDOWN_CODE_HIGHLIGHT_STYLES}
      </style>
      <pre
        ref={preRef}
        aria-label={`${language} code source`}
        className="max-h-[32rem] overflow-auto overflow-x-auto p-3 [overflow-wrap:normal] [&_code]:min-w-max"
        data-pretext-code-line-count={sourceLines.length}
        data-pretext-code-mounted-lines={mountedLines.length}
        data-pretext-code-source=""
        data-pretext-code-virtualized=""
        role="region"
        tabIndex={0}
        onKeyDown={handleHorizontalScrollKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <code
          ref={codeRef}
          {...markdownCodeElementProps({
            language,
            lineNumberMaxDigits,
            lineNumberStart,
            metadata,
            start,
            virtualized: true,
          })}
          style={markdownVirtualizedCodeCanvasStyle({
            language,
            lineNumberStart,
            lineWidthCh,
            metadata,
            start,
            totalLines: sourceLines.length,
          })}
        >
          {mountedLines.map((line, offset) => {
            const index = start + offset;
            return (
              <MarkdownCodeLine
                key={index}
                index={index}
                language={language}
                line={line}
                lineHtml={lineHtmlByIndex.get(index)}
                lineNumberStart={lineNumberStart}
                metadata={metadata}
                totalLines={sourceLines.length}
                virtualized
              />
            );
          })}
        </code>
      </pre>
    </>
  );
}

function MarkdownCodeLine({
  index,
  language,
  line,
  lineHtml,
  lineNumberStart,
  metadata,
  totalLines,
  virtualized = false,
}: {
  index: number;
  language: string;
  line: string;
  lineHtml: string | undefined;
  lineNumberStart: number;
  metadata: MarkdownCodeMetadata;
  totalLines?: number;
  virtualized?: boolean;
}) {
  const lineNumber = lineNumberStart + index;
  const diffKind = diffLineKind(line);
  return (
    <span
      aria-label={metadata.showLineNumbers ? `Line ${lineNumber}` : undefined}
      aria-posinset={
        metadata.showLineNumbers && virtualized ? index + 1 : undefined
      }
      aria-setsize={
        metadata.showLineNumbers && virtualized ? totalLines : undefined
      }
      className={[
        markdownCodeLineClassName(diffKind),
        virtualized ? "absolute right-0 left-0" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-highlighted-line={
        metadata.highlightedLines.has(index + 1) ? "" : undefined
      }
      data-line=""
      data-pretext-code-diff-line={diffKind ?? undefined}
      data-pretext-code-line-number={
        metadata.showLineNumbers ? lineNumber : undefined
      }
      role={metadata.showLineNumbers ? "listitem" : undefined}
      style={
        virtualized
          ? {
              height: "var(--markdown-code-line-height)",
              top: `calc(${index} * var(--markdown-code-line-height))`,
            }
          : undefined
      }
    >
      {renderCodeLine({
        fallbackLanguage: language,
        line,
        lineHtml,
        pattern: metadata.highlightPattern,
      })}
    </span>
  );
}

function markdownCodeElementProps({
  language,
  lineNumberMaxDigits,
  lineNumberStart,
  metadata,
  start = 0,
  virtualized = false,
}: {
  language: string;
  lineNumberMaxDigits: number;
  lineNumberStart: number;
  metadata: MarkdownCodeMetadata;
  start?: number;
  virtualized?: boolean;
}) {
  return {
    "aria-label": metadata.showLineNumbers
      ? `${language} numbered code lines`
      : undefined,
    className: [
      "block font-mono text-[0.9em] leading-[1.45]",
      virtualized ? "relative" : "",
      metadata.showLineNumbers
        ? "[counter-reset:line] before:content-[counter(line)]"
        : "",
      metadata.highlightedLines.size
        ? "[&>[data-highlighted-line]]:bg-primary/10"
        : "",
      metadata.highlightPattern
        ? "[&_[data-highlighted-chars]]:bg-primary/20 [&_[data-highlighted-chars]]:rounded"
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    "data-language": language,
    "data-line-numbers": metadata.showLineNumbers ? "" : undefined,
    "data-line-numbers-max-digits": metadata.showLineNumbers
      ? lineNumberMaxDigits
      : undefined,
    "data-pretext-code-virtualized": virtualized ? "" : undefined,
    role: metadata.showLineNumbers ? "list" : undefined,
    style: metadata.showLineNumbers
      ? { counterSet: `line ${lineNumberStart + start - 1}` }
      : undefined,
  };
}

function markdownVirtualizedCodeCanvasStyle({
  language,
  lineNumberStart,
  lineWidthCh,
  metadata,
  start,
  totalLines,
}: {
  language: string;
  lineNumberStart: number;
  lineWidthCh: number;
  metadata: MarkdownCodeMetadata;
  start: number;
  totalLines: number;
}): React.CSSProperties {
  return {
    "--markdown-code-line-height": markdownCodeLineHeightCss(language),
    counterSet: metadata.showLineNumbers
      ? `line ${lineNumberStart + start - 1}`
      : undefined,
    height: `calc(${Math.max(totalLines, 1)} * var(--markdown-code-line-height))`,
    minWidth: markdownCodeMinWidth(lineWidthCh, metadata.showLineNumbers),
  } as React.CSSProperties;
}

function markdownCodeLineClassName(diffKind: ReturnType<typeof diffLineKind>) {
  return [
    "block min-h-5 box-border whitespace-pre",
    diffKind === "add" ? "bg-emerald-500/10" : "",
    diffKind === "remove" ? "bg-red-500/10" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function markdownCodeLineHeightCss(language: string) {
  return language === "text" || language === "plaintext"
    ? "0.95em"
    : "calc(1.45em + var(--spacing) * 1)";
}

function markdownCodeMinWidth(lineWidthCh: number, showLineNumbers: boolean) {
  const contentWidth = `${Math.max(1, lineWidthCh)}ch`;
  return showLineNumbers
    ? `max(100%, calc(${contentWidth} + var(--spacing) * 22))`
    : `max(100%, ${contentWidth})`;
}

function widestMarkdownCodeLineWidthCh(lines: readonly string[]) {
  return lines.reduce(
    (widest, line) => Math.max(widest, markdownCodeLineWidthCh(line)),
    1,
  );
}

function markdownCodeLineWidthCh(line: string) {
  let width = 0;
  for (const character of line) {
    if (character === "\t") {
      width += 4 - (width % 4);
    } else {
      width += 1;
    }
  }
  return width;
}

function measureMarkdownCodeLineHeight(code: HTMLElement | null) {
  if (!code) return 0;
  const sample = document.createElement("span");
  sample.className = markdownCodeLineClassName(null);
  sample.dataset.line = "";
  sample.style.position = "absolute";
  sample.style.visibility = "hidden";
  sample.textContent = " ";
  code.appendChild(sample);
  const height = sample.getBoundingClientRect().height || sample.offsetHeight;
  sample.remove();
  return height;
}

function MarkdownMeasuredDiagram({
  caption,
  componentName,
  source,
  title,
}: {
  caption?: string;
  componentName?: string;
  source: string;
  title?: string;
}) {
  const notifyContentReady = React.useContext(MarkdownContentReadyContext);
  return (
    <MarkdownGreenfieldDiagram
      caption={caption}
      componentName={componentName}
      onContentReady={notifyContentReady ?? undefined}
      source={source}
      title={title}
    />
  );
}

function MarkdownImageSurface({
  alt,
  componentName,
  height,
  src,
  title,
  width,
}: {
  alt: string;
  componentName?: string;
  height?: number;
  src: string;
  title?: string;
  width?: number;
}) {
  const notifyContentReady = React.useContext(MarkdownContentReadyContext);
  const safeSrc = sanitizeMarkdownImageUrl(src);
  const explicitAspectRatio =
    width && height ? `${width} / ${height}` : undefined;
  const [state, setState] = React.useState<
    "blocked" | "failed" | "loading" | "ready"
  >(safeSrc ? "loading" : "blocked");
  const [aspectRatio, setAspectRatio] = React.useState(
    () => explicitAspectRatio ?? "",
  );
  const captionId = React.useId();

  // Reset load state when the source/aspect-ratio inputs change by adjusting
  // state during render (React's prop-change pattern) instead of in an effect.
  const sourceResetKey = `${safeSrc}::${explicitAspectRatio ?? ""}`;
  const [prevSourceResetKey, setPrevSourceResetKey] =
    React.useState(sourceResetKey);
  if (sourceResetKey !== prevSourceResetKey) {
    setPrevSourceResetKey(sourceResetKey);
    setState(safeSrc ? "loading" : "blocked");
    setAspectRatio(explicitAspectRatio ?? "");
  }

  useKeyedLayoutEffect(
    joinEffectKey([aspectRatio, notifyContentReady, state]),
    () => {
      notifyContentReady?.();
    },
  );

  return (
    <figure
      aria-label={
        state === "failed" ? `Image failed: ${alt}` : alt || title || "Image"
      }
      className="my-5 w-fit max-w-full"
      data-pretext-component={componentName}
      data-pretext-image-height={height}
      data-pretext-image-state={state}
      data-pretext-image-src={safeSrc || undefined}
      data-pretext-image-width={width}
      role="group"
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {safeSrc ? (
        <div
          className="bg-muted/25 relative flex min-h-48 max-w-full items-center justify-center overflow-hidden rounded-md border"
          data-pretext-image-frame=""
          style={aspectRatio ? { aspectRatio } : undefined}
        >
          {state === "loading" ? (
            <span className="text-muted-foreground absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm">
              Loading image
            </span>
          ) : null}
          {state === "failed" ? (
            <div
              className="text-muted-foreground absolute inset-0 flex items-center justify-center px-4 text-center text-sm"
              role="alert"
            >
              Could not load image{alt ? `: ${alt}` : ""}
            </div>
          ) : null}
          {state === "failed" ? (
            <div
              aria-label={alt || "Image"}
              className="text-muted-foreground text-sm"
              data-pretext-image-state="failed"
              role="img"
            >
              Image failed to load: {alt}
              <button
                className="ml-2 text-xs underline underline-offset-4"
                type="button"
                onClick={() => setState("loading")}
              >
                Retry image
              </button>
            </div>
          ) : (
            <img
              alt={alt}
              aria-describedby={title ? captionId : undefined}
              className={[
                "block max-h-[70vh] max-w-full object-contain transition-opacity",
                state === "loading" ? "opacity-0" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              decoding="async"
              loading="lazy"
              src={safeSrc}
              title={title}
              onError={(event) => {
                event.currentTarget.setAttribute(
                  "data-pretext-image-state",
                  "failed",
                );
                setState("failed");
              }}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight) {
                  setAspectRatio(
                    `${image.naturalWidth} / ${image.naturalHeight}`,
                  );
                }
                setState("ready");
              }}
            />
          )}
        </div>
      ) : (
        <span
          aria-label={alt || "Blocked image"}
          className="bg-muted/35 text-muted-foreground flex min-h-24 items-center rounded-md border border-dashed px-4 text-sm"
          role="img"
        >
          {alt || "Blocked image"}
        </span>
      )}
      {title ? (
        <figcaption
          id={captionId}
          className="text-muted-foreground mt-2 text-[0.9em]"
          data-pretext-image-caption=""
        >
          {title}
        </figcaption>
      ) : null}
    </figure>
  );
}

function MarkdownVideoSurface({
  controls = true,
  label,
  loop = false,
  muted = false,
  src,
  title,
}: {
  controls?: boolean;
  label: string;
  loop?: boolean;
  muted?: boolean;
  src: string;
  title?: string;
}) {
  const notifyContentReady = React.useContext(MarkdownContentReadyContext);
  const safeSrc = sanitizeMarkdownMediaUrl(src);
  const [failed, setFailed] = React.useState(false);
  useKeyedLayoutEffect(
    joinEffectKey([failed, notifyContentReady, safeSrc]),
    () => {
      notifyContentReady?.();
    },
  );
  if (!safeSrc) {
    return (
      <div
        aria-label={`Video blocked: ${label}`}
        className="bg-muted/35 text-muted-foreground my-5 rounded-md border border-dashed p-4 text-sm"
        data-pretext-component="Video"
        data-pretext-video-state="blocked"
        role="group"
      >
        {label}
      </div>
    );
  }
  return (
    <figure
      aria-label={failed ? `Video failed to load: ${label}` : label}
      className="my-5 max-w-full"
      data-pretext-component="Video"
      data-pretext-video-state={failed ? "failed" : "ready"}
      role="group"
    >
      <video
        className="bg-muted block max-h-[70vh] max-w-full rounded-md border"
        controls={controls}
        loop={loop}
        muted={muted}
        preload="metadata"
        src={safeSrc}
        title={title}
        onError={() => setFailed(true)}
      />
      {title ? (
        <figcaption className="text-muted-foreground mt-2 text-[0.9em]">
          {title}
        </figcaption>
      ) : null}
    </figure>
  );
}

function MarkdownTabs({ node }: { node: MarkdownHastElement | null }) {
  const props = readComponentProps(
    readDataProperty(node, "dataPretextComponentProps"),
  );
  const tabs = (node?.children ?? [])
    .map(readHastElement)
    .filter((child): child is MarkdownHastElement => {
      return (
        child?.tagName === "div" &&
        readDataProperty(child, "dataPretextComponentName") === "Tab"
      );
    });
  const [selected, setSelected] = React.useState(0);
  const baseId = React.useId();
  const label = readOptionalString(props.label) ?? "Tabs";

  const select = (index: number) =>
    setSelected((index + tabs.length) % tabs.length);

  return (
    <div className="my-5" data-pretext-component="Tabs">
      <div aria-label={label} className="flex gap-1 border-b" role="tablist">
        {tabs.map((tab, index) => {
          const tabProps = readComponentProps(
            readDataProperty(tab, "dataPretextComponentProps"),
          );
          const title =
            readOptionalString(tabProps.title) ?? `Tab ${index + 1}`;
          const active = selected === index;
          return (
            <button
              key={index}
              aria-controls={`${baseId}-panel-${index}`}
              aria-selected={active}
              className="px-3 py-2 text-sm font-medium"
              id={`${baseId}-tab-${index}`}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
              onClick={() => select(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  const nextIndex = (index + 1) % tabs.length;
                  select(nextIndex);
                  document
                    .getElementById(`${baseId}-tab-${nextIndex}`)
                    ?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  select(tabs.length - 1);
                  document
                    .getElementById(`${baseId}-tab-${tabs.length - 1}`)
                    ?.focus();
                } else if (event.key === "Home") {
                  event.preventDefault();
                  select(0);
                  document.getElementById(`${baseId}-tab-0`)?.focus();
                }
              }}
            >
              {title}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={index}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={selected !== index}
          id={`${baseId}-panel-${index}`}
          className="pt-3"
          role="tabpanel"
        >
          {renderHastChildren(tab.children)}
        </div>
      ))}
    </div>
  );
}

// Tags whose text is verbatim source (code) or already a highlight; wrapping a
// match inside them would corrupt the rendered output, so they are skipped.
const MARKDOWN_SEARCH_SKIP_TAGS = new Set([
  "code",
  "pre",
  "mark",
  "script",
  "style",
  "textarea",
]);

// Browser-find-style highlighting for the in-app search: wraps every case-
// insensitive occurrence of the active query in a <mark> so matches are visible
// where the search navigates. Mutates the freshly cloned chunk tree in place,
// matching the same trimmed-substring semantics as the toolbar match count.
type MarkdownSearchHighlightContext = { active: number; count: number };

function highlightMarkdownSearchMatches(
  nodes: MarkdownHastNode[],
  lowerQuery: string,
  context: MarkdownSearchHighlightContext,
) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === "text" && typeof node.value === "string") {
      const replacement = splitMarkdownTextForSearch(
        node.value,
        lowerQuery,
        context,
      );
      if (replacement) {
        nodes.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
      continue;
    }
    if (node.type === "element" && Array.isArray(node.children)) {
      const tagName = (node as MarkdownHastElement).tagName.toLowerCase();
      if (MARKDOWN_SEARCH_SKIP_TAGS.has(tagName)) continue;
      highlightMarkdownSearchMatches(node.children, lowerQuery, context);
    }
  }
}

function splitMarkdownTextForSearch(
  value: string,
  lowerQuery: string,
  context: MarkdownSearchHighlightContext,
): MarkdownHastNode[] | null {
  const lowerValue = value.toLowerCase();
  let matchStart = lowerValue.indexOf(lowerQuery);
  if (matchStart === -1) return null;

  const out: MarkdownHastNode[] = [];
  let cursor = 0;
  while (matchStart !== -1) {
    if (matchStart > cursor) {
      out.push({ type: "text", value: value.slice(cursor, matchStart) });
    }
    const matchEnd = matchStart + lowerQuery.length;
    const isActive = context.count === context.active;
    context.count += 1;
    out.push({
      type: "element",
      tagName: "mark",
      properties: isActive
        ? { dataPretextSearchMatch: "", dataPretextSearchMatchActive: "" }
        : { dataPretextSearchMatch: "" },
      children: [{ type: "text", value: value.slice(matchStart, matchEnd) }],
    });
    cursor = matchEnd;
    matchStart = lowerValue.indexOf(lowerQuery, cursor);
  }
  if (cursor < value.length) {
    out.push({ type: "text", value: value.slice(cursor) });
  }
  return out;
}

function cloneHastNode<T extends MarkdownHastNode>(node: T): T {
  if (!("children" in node) || !Array.isArray(node.children)) {
    return { ...node };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      cloneHastNode(child as MarkdownHastNode),
    ),
    properties: readHastElement(node)?.properties
      ? { ...readHastElement(node)!.properties }
      : undefined,
  } as T;
}

function suppressDomFragmentIds(nodes: MarkdownHastNode[]) {
  for (const node of nodes) {
    const element = readHastElement(node);
    if (!element) continue;

    const id = element.properties?.id;
    if (
      typeof id === "string" &&
      id &&
      shouldSuppressDomFragmentId(element, id)
    ) {
      element.properties = {
        ...element.properties,
        dataPretextFragmentId: id,
      };
      delete element.properties.id;
    }

    suppressDomFragmentIds(element.children);
  }
}

function shouldSuppressDomFragmentId(element: MarkdownHastElement, id: string) {
  return /^h[1-6]$/.test(element.tagName) || /^user-content-fn/.test(id);
}

function readDataProperty(node: unknown, property: string) {
  const element = readHastElement(node);
  const value =
    element?.properties?.[property] ?? element?.properties?.[toKebab(property)];
  return typeof value === "string" ? value : "";
}

function readStringProperty(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readTrustedDataProperty(node: unknown, property: string) {
  if (!isTrustedPretextComponentNode(node)) return "";
  return readDataProperty(node, property);
}

function isTrustedPretextComponentNode(node: unknown) {
  return readHastElement(node)?.properties?.pretextComponentTrusted === true;
}

function hasDataProperty(node: unknown, property: string) {
  const element = readHastElement(node);
  return (
    element?.properties != null &&
    (Object.hasOwn(element.properties, property) ||
      Object.hasOwn(element.properties, toKebab(property)))
  );
}

function withoutPretextAlertMetadata(props: Record<string, unknown>) {
  const next = { ...props };
  delete next.dataPretextAlertKind;
  delete next.dataPretextAlertTitle;
  delete next["data-pretext-alert-kind"];
  delete next["data-pretext-alert-title"];
  return next;
}

function withoutInternalPretextMetadata(props: Record<string, unknown>) {
  const next = { ...props };
  for (const key of Object.keys(next)) {
    if (/^dataPretext(?:Component|Callout|Heading)/.test(key)) {
      delete next[key];
    }
    if (/^data-pretext-(?:component|callout|heading)/.test(key)) {
      delete next[key];
    }
    if (key === "pretextComponentTrusted") {
      delete next[key];
    }
  }
  return next;
}

function readHastElement(node: unknown): MarkdownHastElement | null {
  return node &&
    typeof node === "object" &&
    (node as MarkdownHastElement).type === "element"
    ? (node as MarkdownHastElement)
    : null;
}

function readPreCodeElement(node: unknown): MarkdownHastElement | null {
  const pre = readHastElement(node);
  if (pre?.tagName !== "pre") return null;
  const code =
    pre.children
      .map(readHastElement)
      .find((child): child is MarkdownHastElement =>
        Boolean(child && child.tagName === "code"),
      ) ?? null;
  return code;
}

function readCodeLanguage(code: MarkdownHastElement | null) {
  const className = code?.properties?.className;
  const classes = Array.isArray(className) ? className : [className];
  const languageClass = classes.find(
    (value): value is string =>
      typeof value === "string" && value.startsWith("language-"),
  );
  const language = languageClass?.slice("language-".length).toLowerCase();
  if (language === "mmd" || language === "mermaid-js") return "mermaid";
  return language ?? null;
}

function readCodeMetadata(code: MarkdownHastElement | null) {
  return parseCodeMetadata(readDataProperty(code, "dataPretextCodeMeta"));
}

function parseCodeMetadata(meta: string) {
  const result: {
    caption?: string;
    highlightedLines: Set<number>;
    highlightPattern: string;
    lineNumberStart?: number;
    showLineNumbers: boolean;
    title?: string;
  } = {
    highlightedLines: new Set<number>(),
    highlightPattern: "",
    showLineNumbers: false,
  };
  for (const match of meta.matchAll(
    /(?:^|\s)(title|caption)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g,
  )) {
    const key = match[1] as "caption" | "title";
    result[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  const lineNumbers = /(?:^|\s)showLineNumbers(?:\{(\d+)\})?(?=\s|$)/i.exec(
    meta,
  );
  if (lineNumbers) {
    result.showLineNumbers = true;
    result.lineNumberStart = lineNumbers[1] ? Number(lineNumbers[1]) : 1;
  }
  for (const match of meta.matchAll(/\{(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\}/g)) {
    for (const value of match[1]!.split(",")) {
      addHighlightedCodeLineSpec(result.highlightedLines, value);
    }
  }
  const highlightPattern = /\/([^/\n]+)\//.exec(meta);
  result.highlightPattern = highlightPattern?.[1] ?? "";
  return result;
}

function addHighlightedCodeLineSpec(lines: Set<number>, spec: string) {
  const range = /^(\d+)-(\d+)$/.exec(spec);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (!isSafeHighlightedCodeLine(start) || !isSafeHighlightedCodeLine(end)) {
      return;
    }
    if (end < start || end - start > 500) return;
    for (let line = start; line <= end; line += 1) lines.add(line);
    return;
  }

  const line = Number(spec);
  if (isSafeHighlightedCodeLine(line)) lines.add(line);
}

function toKebab(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function alertIconForKind(kind: string) {
  switch (kind) {
    case "note":
      return Info;
    case "tip":
      return Lightbulb;
    case "warning":
      return TriangleAlert;
    case "caution":
      return CircleAlert;
    default:
      return BadgeAlert;
  }
}

function calloutTitle(kind: string) {
  const titles: Record<string, string> = {
    caution: "Caution",
    important: "Important",
    note: "Note",
    tip: "Tip",
    warning: "Warning",
  };
  return titles[kind] ?? "Note";
}

function linkKindForHref(href: string) {
  if (href.startsWith("#")) return "fragment";
  if (href.startsWith("/")) return "root";
  if (/^mailto:/i.test(href)) return "email";
  if (/^(?:https?:)?\/\//i.test(href)) return "external";
  return "relative";
}

function linkFormForHref({ href, text }: { href: string; text: string }) {
  if (/^mailto:/i.test(href) && href.slice("mailto:".length) === text) {
    return "email-autolink";
  }
  if (
    /^https?:\/\/www\./i.test(href) &&
    href.replace(/^https?:\/\//i, "") === text
  ) {
    return "autolink";
  }
  if (href === text && /^(?:https?:)?\/\//i.test(href)) return "autolink";
  return "inline";
}

function footnoteLabelForLink({
  href,
  label,
  text,
}: {
  href: string;
  label: unknown;
  text: string;
}) {
  const display = footnoteDisplayForHref(href, text);
  if (/^#(?:user-content-)?fnref-/i.test(href)) {
    return "Back to footnote reference ↩";
  }
  if (/^#(?:user-content-)?fn-/i.test(href)) {
    return `Footnote${display ? ` ${display}` : ""}`;
  }
  if (typeof label === "string" && label) return label;
  return undefined;
}

function footnoteDisplayForHref(href: string, text: string) {
  const visibleText = text.trim().replace(/^\[|\]$/g, "");
  if (/^\d+[a-z]?$/i.test(visibleText)) return visibleText;

  const match = /^#(?:user-content-)?fn(?:ref)?-([A-Za-z0-9_-]+)/i.exec(href);
  if (!match) return "";
  return match[1]!.replace(/-/g, " ");
}

function reactNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  return "";
}

function hasDescendantElement(
  element: MarkdownHastElement | null,
  tagName: string,
): boolean {
  if (!element) return false;
  return element.children.some((child) => {
    const childElement = readHastElement(child);
    return (
      childElement?.tagName === tagName ||
      hasDescendantElement(childElement, tagName)
    );
  });
}

function isWhitespaceText(node: MarkdownHastNode) {
  return (
    node.type === "text" &&
    typeof node.value === "string" &&
    node.value.trim() === ""
  );
}

function extractHastText(element: MarkdownHastElement | null): string {
  return extractHastNodeText(element);
}

function extractHastNodeText(
  node: MarkdownHastNode | null | undefined,
): string {
  if (!node) return "";
  if (node.type === "text" && typeof node.value === "string") return node.value;
  const element = readHastElement(node);
  if (!element) return "";
  return element.children.map(extractHastNodeText).join("");
}

type MarkdownTableModel = {
  caption: MarkdownHastElement | null;
  captionText: string;
  cellCount: number;
  columnCount: number;
  rows: MarkdownTableRowModel[];
  tsv: string;
};

type MarkdownTableRowModel = {
  cells: MarkdownTableCellModel[];
  key: string;
  rowIndex: number;
};

type MarkdownTableCellModel = {
  align: MarkdownTableCellAlign | null;
  children: readonly MarkdownHastNode[];
  columnIndex: number;
  headerId: string | null;
  headers: string | null;
  isHeader: boolean;
  key: string;
  text: string;
};

type MarkdownTableCellAlign = "center" | "char" | "justify" | "left" | "right";

type MarkdownTableFindEntry = {
  key: string;
  rowIndex: number;
  text: string;
};

function MarkdownTable({ node, style, ...props }: any) {
  const table = readHastElement(node);
  const model = React.useMemo(() => readMarkdownTableModel(table), [table]);
  if (model && shouldVirtualizeMarkdownTable(model)) {
    return <MarkdownVirtualTable model={model} style={style} />;
  }

  const ariaColumnCount = model?.columnCount ?? tableColumnCount(table);
  const columnCount = ariaColumnCount ?? 0;
  return (
    <div
      aria-label="Markdown table"
      className="group relative my-4 overflow-hidden rounded-lg border"
      data-markdown-table-region=""
      role="region"
      tabIndex={0}
      onKeyDown={handleHorizontalScrollKeyDown}
    >
      <TableCopyButton copyText={model?.tsv} />
      <div className="overflow-x-auto" data-markdown-table-scroll="">
        <table
          {...props}
          aria-colcount={ariaColumnCount}
          aria-rowcount={model?.rows.length ?? tableRowCount(table)}
          className="w-full border-collapse text-[0.85em]"
          data-markdown-table=""
          style={{
            ...style,
            minWidth: markdownTableMinWidth(columnCount, style?.minWidth),
          }}
        />
      </div>
    </div>
  );
}

function MarkdownVirtualTable({
  model,
  style,
}: {
  model: MarkdownTableModel;
  style?: React.CSSProperties;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = React.useRef<number | null>(null);
  const [viewport, setViewport] = React.useState({
    height: MARKDOWN_TABLE_VIRTUALIZED_VIEWPORT_HEIGHT_PX,
    scrollTop: 0,
  });
  const visibleWindow = React.useMemo(
    () =>
      markdownVirtualTableVisibleWindow({
        rowCount: model.rows.length,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.height,
      }),
    [model.rows.length, viewport.height, viewport.scrollTop],
  );
  const visibleRows = React.useMemo(
    () => model.rows.slice(visibleWindow.start, visibleWindow.end),
    [model.rows, visibleWindow.end, visibleWindow.start],
  );
  const findEntries = React.useMemo(
    () => markdownTableFindEntries(model.rows),
    [model.rows],
  );
  const updateViewport = React.useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setViewport({
      height:
        element.clientHeight || MARKDOWN_TABLE_VIRTUALIZED_VIEWPORT_HEIGHT_PX,
      scrollTop: element.scrollTop,
    });
  }, []);
  const handleScroll = React.useCallback(() => {
    if (scrollFrameRef.current != null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateViewport();
    });
  }, [updateViewport]);
  const revealRow = React.useCallback((rowIndex: number) => {
    const top = rowIndex * MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX;
    scrollRef.current?.scrollTo?.({ behavior: "auto", top });
    if (scrollRef.current) scrollRef.current.scrollTop = top;
    setViewport((current) => ({
      height: scrollRef.current?.clientHeight || current.height,
      scrollTop: top,
    }));
  }, []);

  useKeyedLayoutEffect(
    joinEffectKey(["markdown-virtual-table-viewport", model.rows.length]),
    () => {
      updateViewport();
      return () => {
        if (scrollFrameRef.current != null) {
          cancelAnimationFrame(scrollFrameRef.current);
        }
      };
    },
  );

  return (
    <div
      aria-label="Markdown table"
      className="group relative my-4 overflow-hidden rounded-lg border"
      data-markdown-table-region=""
      data-markdown-table-virtualized-region=""
      role="region"
      tabIndex={0}
      onKeyDown={handleHorizontalScrollKeyDown}
    >
      <TableCopyButton copyText={model.tsv} />
      <div
        ref={scrollRef}
        className="max-h-[560px] overflow-auto"
        data-markdown-table-scroll=""
        onScroll={handleScroll}
      >
        <table
          aria-colcount={model.columnCount}
          aria-rowcount={model.rows.length}
          className="w-full border-collapse text-[0.85em]"
          data-markdown-table=""
          data-markdown-table-mounted-rows={visibleRows.length}
          data-markdown-table-total-rows={model.rows.length}
          data-markdown-table-virtualized=""
          style={{
            ...style,
            minWidth: markdownTableMinWidth(model.columnCount, style?.minWidth),
          }}
        >
          {model.caption ? (
            <caption className="text-muted-foreground bg-background sticky top-0 z-20 caption-top px-3 py-2 text-left font-medium">
              {renderHastChildren(model.caption.children)}
            </caption>
          ) : null}
          <tbody>
            {visibleWindow.start > 0 ? (
              <MarkdownVirtualTableSpacerRow
                columnCount={model.columnCount}
                height={
                  visibleWindow.start * MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX
                }
              />
            ) : null}
            {visibleRows.map((row) => (
              <MarkdownVirtualTableRow key={row.key} row={row} />
            ))}
            {visibleWindow.end < model.rows.length ? (
              <MarkdownVirtualTableSpacerRow
                columnCount={model.columnCount}
                height={
                  (model.rows.length - visibleWindow.end) *
                  MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX
                }
              />
            ) : null}
          </tbody>
        </table>
        <MarkdownVirtualTableNativeFindIndex
          entries={findEntries}
          revealRow={revealRow}
        />
      </div>
    </div>
  );
}

function MarkdownVirtualTableRow({ row }: { row: MarkdownTableRowModel }) {
  return (
    <tr
      aria-rowindex={row.rowIndex + 1}
      className="border-b"
      data-markdown-table-row=""
      data-pretext-table-row-index={row.rowIndex + 1}
      style={{
        height: MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX,
      }}
    >
      {row.cells.map((cell) => (
        <MarkdownVirtualTableCell key={cell.key} cell={cell} />
      ))}
    </tr>
  );
}

function MarkdownVirtualTableCell({ cell }: { cell: MarkdownTableCellModel }) {
  const Cell = cell.isHeader ? "th" : "td";
  return (
    <Cell
      align={cell.align ?? undefined}
      aria-colindex={cell.columnIndex + 1}
      className={markdownTableCellClassName({
        align: cell.align,
        isHeader: cell.isHeader,
      })}
      data-markdown-table-cell=""
      data-pretext-table-column-index={cell.columnIndex + 1}
      headers={cell.isHeader ? undefined : (cell.headers ?? undefined)}
      id={cell.headerId ?? undefined}
      scope={cell.isHeader ? "col" : undefined}
    >
      <span className="block truncate">
        {renderHastChildren(cell.children)}
      </span>
    </Cell>
  );
}

function MarkdownVirtualTableSpacerRow({
  columnCount,
  height,
}: {
  columnCount: number;
  height: number;
}) {
  return (
    <tr aria-hidden="true" data-markdown-table-spacer-row="">
      <td colSpan={columnCount} style={{ height, padding: 0 }} />
    </tr>
  );
}

function MarkdownVirtualTableNativeFindIndex({
  entries,
  revealRow,
}: {
  entries: readonly MarkdownTableFindEntry[];
  revealRow: (rowIndex: number) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 h-px w-px overflow-hidden opacity-0"
      data-markdown-table-native-find-index=""
      data-markdown-table-native-find-entries={entries.length}
    >
      {entries.map((entry) => (
        <MarkdownVirtualTableNativeFindEntry
          key={entry.key}
          entry={entry}
          revealRow={revealRow}
        />
      ))}
    </div>
  );
}

function MarkdownVirtualTableNativeFindEntry({
  entry,
  revealRow,
}: {
  entry: MarkdownTableFindEntry;
  revealRow: (rowIndex: number) => void;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  useKeyedLayoutEffect(joinEffectKey([entry.key, entry.rowIndex]), () => {
    const element = ref.current;
    if (!element) return;
    element.setAttribute("hidden", "until-found");

    const handleBeforeMatch = () => {
      revealRow(entry.rowIndex);
      requestAnimationFrame(() => {
        element.setAttribute("hidden", "until-found");
      });
    };

    element.addEventListener("beforematch", handleBeforeMatch);
    return () => {
      element.removeEventListener("beforematch", handleBeforeMatch);
    };
  });

  return (
    <span
      ref={ref}
      className="absolute top-0 left-0 block h-px w-px overflow-hidden whitespace-pre"
      data-markdown-table-native-find-entry=""
      data-markdown-table-native-find-row={entry.rowIndex + 1}
    >
      {entry.text || " "}
    </span>
  );
}

function readMarkdownTableModel(
  table: MarkdownHastElement | null,
): MarkdownTableModel | null {
  if (!table) return null;
  const caption = table.children
    .map(readHastElement)
    .find(
      (child): child is MarkdownHastElement => child?.tagName === "caption",
    );
  const rows = tableRows(table).map((row, rowIndex) =>
    readMarkdownTableRowModel(row, rowIndex),
  );
  if (!rows.length) return null;

  const columnCount = rows.reduce(
    (max, row) => Math.max(max, row.cells.length),
    0,
  );
  const cellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
  return {
    caption: caption ?? null,
    captionText: normalizeTableCellText(extractHastNodeText(caption)),
    cellCount,
    columnCount,
    rows,
    tsv: serializeMarkdownTableModelAsTsv(rows),
  };
}

function readMarkdownTableRowModel(
  row: MarkdownHastElement,
  rowIndex: number,
): MarkdownTableRowModel {
  return {
    cells: tableCells(row).map((cell, columnIndex) =>
      readMarkdownTableCellModel(cell, rowIndex, columnIndex),
    ),
    key: `row-${rowIndex}`,
    rowIndex,
  };
}

function readMarkdownTableCellModel(
  cell: MarkdownHastElement,
  rowIndex: number,
  columnIndex: number,
): MarkdownTableCellModel {
  return {
    align: readMarkdownTableCellAlign(cell.properties?.align),
    children: cell.children,
    columnIndex,
    headerId: readStringProperty(cell.properties?.id),
    headers: readStringProperty(cell.properties?.headers),
    isHeader: cell.tagName === "th",
    key: `cell-${rowIndex}-${columnIndex}`,
    text: normalizeTableCellText(extractHastNodeText(cell)),
  };
}

function readMarkdownTableCellAlign(
  value: unknown,
): MarkdownTableCellAlign | null {
  return value === "center" ||
    value === "char" ||
    value === "justify" ||
    value === "left" ||
    value === "right"
    ? value
    : null;
}

function shouldVirtualizeMarkdownTable(model: MarkdownTableModel) {
  return (
    model.rows.length >= MARKDOWN_TABLE_VIRTUALIZATION_ROW_THRESHOLD ||
    model.cellCount >= MARKDOWN_TABLE_VIRTUALIZATION_CELL_THRESHOLD
  );
}

function markdownVirtualTableVisibleWindow({
  rowCount,
  scrollTop,
  viewportHeight,
}: {
  rowCount: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  const visibleStart = Math.max(
    0,
    Math.floor(scrollTop / MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX) -
      MARKDOWN_TABLE_VIRTUALIZED_OVERSCAN_ROWS,
  );
  const visibleCount =
    Math.ceil(viewportHeight / MARKDOWN_TABLE_VIRTUALIZED_ROW_HEIGHT_PX) +
    MARKDOWN_TABLE_VIRTUALIZED_OVERSCAN_ROWS * 2;
  return {
    end: Math.min(rowCount, visibleStart + Math.max(1, visibleCount)),
    start: visibleStart,
  };
}

function markdownTableFindEntries(
  rows: readonly MarkdownTableRowModel[],
): MarkdownTableFindEntry[] {
  const entries: MarkdownTableFindEntry[] = [];
  for (
    let rowIndex = 0;
    rowIndex < rows.length;
    rowIndex += MARKDOWN_TABLE_NATIVE_FIND_ROWS_PER_ENTRY
  ) {
    const chunkRows = rows.slice(
      rowIndex,
      rowIndex + MARKDOWN_TABLE_NATIVE_FIND_ROWS_PER_ENTRY,
    );
    entries.push({
      key: `table-find-${rowIndex}`,
      rowIndex,
      text: chunkRows
        .map((row) => row.cells.map((cell) => cell.text).join("\t"))
        .join("\n"),
    });
  }
  return entries;
}

function serializeMarkdownTableModelAsTsv(
  rows: readonly MarkdownTableRowModel[],
) {
  return rows
    .map((row) => row.cells.map((cell) => cell.text).join("\t"))
    .join("\n");
}

function markdownTableMinWidth(
  columnCount: number,
  fallback: React.CSSProperties["minWidth"],
) {
  return columnCount >= 4 ? `${Math.max(640, columnCount * 160)}px` : fallback;
}

function markdownTableCellClassName({
  align,
  isHeader,
}: {
  align: string | null;
  isHeader: boolean;
}) {
  return [
    "min-w-0 border-r px-3 py-1.5 last:border-r-0",
    isHeader
      ? "border-b bg-muted/55 text-left font-medium"
      : "border-t align-top",
    align === "center" ? "text-center" : "",
    align === "right" ? "text-right tabular-nums" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function handleHorizontalScrollKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
) {
  const element =
    event.currentTarget.querySelector<HTMLElement>(
      "[data-markdown-table-scroll]",
    ) ?? event.currentTarget;
  if (event.key === "ArrowRight") {
    element.scrollLeft += 50;
    event.preventDefault();
  } else if (event.key === "ArrowLeft") {
    element.scrollLeft -= 50;
    event.preventDefault();
  } else if (event.key === "End") {
    element.scrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    event.preventDefault();
  } else if (event.key === "Home") {
    element.scrollLeft = 0;
    event.preventDefault();
  }
}

function tableRowCount(table: MarkdownHastElement | null) {
  if (!table) return undefined;
  return countDescendantElements(table, "tr");
}

function tableColumnCount(table: MarkdownHastElement | null) {
  const firstRow = findDescendantElement(table, "tr");
  if (!firstRow) return undefined;
  return firstRow.children.filter((child) => {
    const element = readHastElement(child);
    return element?.tagName === "td" || element?.tagName === "th";
  }).length;
}

function tableRows(element: MarkdownHastElement) {
  const rows: MarkdownHastElement[] = [];
  for (const child of element.children) {
    const childElement = readHastElement(child);
    if (!childElement) continue;
    if (childElement.tagName === "tr") {
      rows.push(childElement);
    } else if (
      childElement.tagName === "thead" ||
      childElement.tagName === "tbody" ||
      childElement.tagName === "tfoot"
    ) {
      rows.push(...tableRows(childElement));
    }
  }
  return rows;
}

function tableCells(row: MarkdownHastElement) {
  return row.children
    .map(readHastElement)
    .filter(
      (child): child is MarkdownHastElement =>
        child?.tagName === "td" || child?.tagName === "th",
    );
}

function countDescendantElements(
  element: MarkdownHastElement,
  tagName: string,
): number {
  return element.children.reduce((sum, child) => {
    const childElement = readHastElement(child);
    if (!childElement) return sum;
    return (
      sum +
      (childElement.tagName === tagName ? 1 : 0) +
      countDescendantElements(childElement, tagName)
    );
  }, 0);
}

function findDescendantElement(
  element: MarkdownHastElement | null,
  tagName: string,
): MarkdownHastElement | null {
  if (!element) return null;
  for (const child of element.children) {
    const childElement = readHastElement(child);
    if (!childElement) continue;
    if (childElement.tagName === tagName) return childElement;
    const found = findDescendantElement(childElement, tagName);
    if (found) return found;
  }
  return null;
}

// A subtle hover copy affordance in the table's top-right corner, replacing the
// persistent chrome bar so the table reads as a clean document table.
function TableCopyButton({ copyText }: { copyText?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      aria-label="Copy table as TSV"
      className="bg-background/90 text-muted-foreground hover:text-foreground absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      type="button"
      onClick={(event) => {
        copyTable(event.currentTarget, copyText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function copyTable(button: HTMLButtonElement, copyText?: string) {
  const region = button.closest('[role="region"]');

  const selection = window.getSelection();
  const selectedText =
    selection &&
    selection.rangeCount > 0 &&
    region?.contains(selection.anchorNode)
      ? selection.toString()
      : "";
  if (selectedText.trim()) {
    void navigator.clipboard?.writeText(selectedText.trim());
    return;
  }

  if (copyText != null) {
    void navigator.clipboard?.writeText(copyText);
    return;
  }

  const table = region?.querySelector("table");
  if (!table) return;
  void navigator.clipboard?.writeText(serializeTableAsTsv(table));
}

function serializeTableAsTsv(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td"))
        .map((cell) => normalizeTableCellText(cell.textContent ?? ""))
        .join("\t"),
    )
    .join("\n");
}

function normalizeTableCellText(value: string) {
  return value.trim().replace(/[\t\r\n ]+/g, " ");
}

function copyHeadingLink(id: string) {
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  void navigator.clipboard?.writeText(`${base}#${id}`);
}

function readComponentProps(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function readOptionalNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

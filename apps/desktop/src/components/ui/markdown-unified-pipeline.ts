"use client";

import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkDirective from "remark-directive";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkSmartypants from "remark-smartypants";
import { unified } from "unified";
import { VFile } from "vfile";

import type {
  MarkdownHastElement,
  MarkdownHastNode,
  MarkdownHastRoot,
} from "./markdown-hast-types";
import { createMarkdownSourceMap } from "./markdown-source-map";

export type MarkdownUnifiedDocument = {
  hast: MarkdownHastRoot;
  mdast: MarkdownMdastRoot;
  messages: MarkdownUnifiedMessage[];
  sourceMap: ReturnType<typeof createMarkdownSourceMap>;
};

export type MarkdownUnifiedMessage = {
  column?: number;
  fatal?: boolean | null;
  line?: number;
  reason: string;
  ruleId?: string | null;
  source?: string | null;
};

export type MarkdownUnifiedOptions = {
  gfm?: MarkdownGfmOptions;
};

export const MARKDOWN_REMARK_PLUGINS = [
  "remark-parse",
  "remark-directive",
  "remark-gfm",
  "remark-breaks",
  "remark-math",
  "remark-gemoji",
  "remark-markdown-prose-transforms",
  "remark-smartypants",
  "remark-markdown-github-alerts",
  "remark-markdown-definition-lists",
  "remark-markdown-components",
  "remark-markdown-code-metadata",
  "remark-markdown-trusted-images",
] as const;

export const MARKDOWN_REHYPE_PLUGINS = [
  "remark-rehype",
  "rehype-raw",
  "rehype-slug",
  "rehype-sanitize",
  "rehype-markdown-trusted-metadata",
  "rehype-markdown-safe-inputs",
  "rehype-katex",
] as const;

type MarkdownGfmOptions = {
  singleTilde?: boolean;
  stringLength?: (value: string) => number;
  tableCellPadding?: boolean;
  tablePipeAlign?: boolean;
};

type MarkdownMdastNode = {
  children?: MarkdownMdastNode[];
  data?: {
    hProperties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  lang?: string;
  meta?: string;
  position?: {
    end?: {
      column?: number;
      line?: number;
      offset?: number;
    };
    start?: {
      column?: number;
      line?: number;
      offset?: number;
    };
  };
  type: string;
  value?: string;
};

type MarkdownMdastRoot = MarkdownMdastNode & {
  children: MarkdownMdastNode[];
  type: "root";
};

type MarkdownMdastParagraph = MarkdownMdastNode & {
  children: MarkdownMdastNode[];
  type: "paragraph";
};

type MarkdownComponent = {
  children?: MarkdownMdastNode[];
  name: string;
  props: Record<string, string>;
};

const GITHUB_ALERT_LABELS = {
  caution: "Caution",
  important: "Important",
  note: "Note",
  tip: "Tip",
  warning: "Warning",
} as const;

const MARKDOWN_KATEX_OPTIONS = {
  maxExpand: 1000,
  maxSize: 10,
  strict: "ignore",
  trust: false,
} as const;
const MARKDOWN_KATEX_RENDER_CACHE_LIMIT = 512;
const MARKDOWN_KATEX_RENDER_CACHE_RENDERER = "rehype-katex@7.0.1";
const MARKDOWN_KATEX_RENDER_CACHE_CONFIG = markdownKatexConfigKey(
  MARKDOWN_KATEX_OPTIONS,
);

type MarkdownHastParent = MarkdownHastElement | MarkdownHastRoot;

type MarkdownKatexCacheMode = "display" | "inline";

type MarkdownKatexCacheEntry = {
  message?: MarkdownKatexCacheMessage;
  nodes: MarkdownHastNode[];
};

type MarkdownKatexCacheMessage = {
  reason: string;
  ruleId?: string | null;
  source?: string | null;
};

type MarkdownKatexMatch = {
  displayMode: boolean;
  messagePosition?: MarkdownHastElement["position"];
  mode: MarkdownKatexCacheMode;
  scope: MarkdownHastElement;
  source: string;
};

type MarkdownKatexRenderMiss = {
  endMarkerId: string;
  key: string;
  messagePosition?: MarkdownHastElement["position"];
  startMarkerId: string;
};

type MarkdownKatexRenderPlaceholder = {
  key: string;
  messagePosition?: MarkdownHastElement["position"];
  placeholderId: string;
};

type MarkdownKatexCachedMessageReplay = {
  message: MarkdownKatexCacheMessage;
  messagePosition?: MarkdownHastElement["position"];
};

type MarkdownKatexRenderState = {
  cachedMessages: MarkdownKatexCachedMessageReplay[];
  firstMissByKey: Map<string, MarkdownKatexRenderMiss>;
  firstMisses: MarkdownKatexRenderMiss[];
  nextMarkerId: number;
  placeholders: MarkdownKatexRenderPlaceholder[];
  renderedByKey: Map<string, MarkdownKatexCacheEntry>;
};

type MarkdownMdastProcessor = ReturnType<typeof createMarkdownMdastProcessor>;
type MarkdownHastProcessor = ReturnType<typeof createMarkdownHastProcessor>;

let defaultMarkdownMdastProcessor: MarkdownMdastProcessor | null = null;
let defaultMarkdownHastProcessor: MarkdownHastProcessor | null = null;
let markdownUnifiedSanitizeSchema: ReturnType<
  typeof createUncachedMarkdownUnifiedSanitizeSchema
> | null = null;
const markdownKatexRenderCache = new Map<string, MarkdownKatexCacheEntry>();
const markdownKatexRenderCacheStats = {
  hits: 0,
  misses: 0,
  sameDocumentHits: 0,
  writes: 0,
};

export function createMarkdownUnifiedDocument(
  markdown: string,
  options: MarkdownUnifiedOptions = {},
): MarkdownUnifiedDocument {
  const file = new VFile({ value: markdown });
  const mdastProcessor = getMarkdownMdastProcessor(options);
  const parsedMdast = mdastProcessor.parse(file) as MarkdownMdastRoot;
  const mdast = mdastProcessor.runSync(
    parsedMdast as never,
    file,
  ) as MarkdownMdastRoot;
  const hastProcessor = getMarkdownHastProcessor();
  const hast = hastProcessor.runSync(mdast as never, file) as MarkdownHastRoot;
  const sourceMap = createMarkdownSourceMap(markdown);
  injectMarkdownFrontmatter(hast, sourceMap.text);

  return {
    hast,
    mdast,
    messages: file.messages.map(markdownUnifiedMessageFromVFileMessage),
    sourceMap,
  };
}

function getMarkdownMdastProcessor(
  options: MarkdownUnifiedOptions,
): MarkdownMdastProcessor {
  if (options.gfm) return createMarkdownMdastProcessor(options);
  if (!defaultMarkdownMdastProcessor) {
    defaultMarkdownMdastProcessor = createMarkdownMdastProcessor({});
  }
  return defaultMarkdownMdastProcessor;
}

function createMarkdownMdastProcessor(options: MarkdownUnifiedOptions) {
  return unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkGfm, options.gfm)
    .use(remarkBreaks)
    .use(remarkMath)
    .use(remarkGemoji)
    .use(remarkMarkdownProseTransforms)
    .use(remarkSmartypants)
    .use(remarkMarkdownGithubAlerts)
    .use(remarkMarkdownDefinitionLists)
    .use(remarkMarkdownComponents)
    .use(remarkMarkdownCodeMetadata)
    .use(remarkMarkdownTrustedImages);
}

function getMarkdownHastProcessor(): MarkdownHastProcessor {
  if (!defaultMarkdownHastProcessor) {
    defaultMarkdownHastProcessor = createMarkdownHastProcessor();
  }
  return defaultMarkdownHastProcessor;
}

function createMarkdownHastProcessor() {
  return unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSanitize, getMarkdownUnifiedSanitizeSchema())
    .use(rehypeMarkdownTrustedMetadata)
    .use(rehypeMarkdownSafeInputs)
    .use(rehypeMarkdownCachedKatex, MARKDOWN_KATEX_OPTIONS);
}

function getMarkdownUnifiedSanitizeSchema() {
  if (!markdownUnifiedSanitizeSchema) {
    markdownUnifiedSanitizeSchema =
      createUncachedMarkdownUnifiedSanitizeSchema();
  }
  return markdownUnifiedSanitizeSchema;
}

function createUncachedMarkdownUnifiedSanitizeSchema() {
  return {
    ...defaultSchema,
    clobberPrefix: "user-content-",
    attributes: {
      ...defaultSchema.attributes,
      "*": [
        ...(defaultSchema.attributes?.["*"] ?? []),
        "ariaDescribedBy",
        "ariaHidden",
        "ariaLabel",
        "ariaLabelledBy",
        "className",
        "dataFootnoteBackref",
        "dataFootnoteRef",
        "dataFootnotes",
        "dataPretextComponentFallback",
        "dataPretextComponentFallbackName",
        "dataPretextComponentFallbackReason",
        "dataPretextComponentFallbackSource",
        "dataPretextComponentName",
        "dataPretextComponentProps",
        "dataPretextMarkdownImage",
        "dataPretextAlertKind",
        "dataPretextAlertTitle",
        "dataPretextCalloutKind",
        "dataPretextCalloutTitle",
        "id",
      ],
      a: [
        ...(defaultSchema.attributes?.a ?? []),
        "ariaDescribedBy",
        "dataFootnoteBackref",
        "dataFootnoteRef",
        "href",
        "id",
        "title",
      ],
      code: [
        ...(defaultSchema.attributes?.code ?? []),
        "className",
        "dataPretextCodeMeta",
      ],
      img: [
        ...(defaultSchema.attributes?.img ?? []),
        "dataPretextMarkdownImage",
      ],
      ins: [...(defaultSchema.attributes?.ins ?? []), "cite"],
      input: ["checked", "disabled", "type"],
      li: [...(defaultSchema.attributes?.li ?? []), "className"],
      ol: [...(defaultSchema.attributes?.ol ?? []), "start"],
      section: [
        ...(defaultSchema.attributes?.section ?? []),
        "className",
        "dataFootnotes",
      ],
      time: [...(defaultSchema.attributes?.time ?? []), "dateTime"],
      sup: [...(defaultSchema.attributes?.sup ?? []), "id"],
      td: [...(defaultSchema.attributes?.td ?? []), "align"],
      th: [...(defaultSchema.attributes?.th ?? []), "align"],
      q: [...(defaultSchema.attributes?.q ?? []), "cite"],
    },
    tagNames: [
      ...(defaultSchema.tagNames ?? []),
      "abbr",
      "caption",
      "cite",
      "dd",
      "details",
      "dfn",
      "dl",
      "dt",
      "figcaption",
      "figure",
      "input",
      "ins",
      "kbd",
      "mark",
      "q",
      "samp",
      "section",
      "small",
      "summary",
      "time",
      "var",
    ],
  };
}

function markdownUnifiedMessageFromVFileMessage(message: {
  column?: number;
  fatal?: boolean | null;
  line?: number;
  reason: string;
  ruleId?: string | null;
  source?: string | null;
}): MarkdownUnifiedMessage {
  return {
    column: message.column,
    fatal: message.fatal,
    line: message.line,
    reason: message.reason,
    ruleId: message.ruleId,
    source: message.source,
  };
}

function injectMarkdownFrontmatter(hast: MarkdownHastRoot, markdown: string) {
  const frontmatter = readMarkdownFrontmatter(markdown);
  if (!frontmatter) return;
  hast.children = [
    createFrontmatterElement(frontmatter),
    ...hast.children.filter((child) => {
      const line = child.position?.start?.line ?? Number.POSITIVE_INFINITY;
      return line > frontmatter.endLine;
    }),
  ];
}

function readMarkdownFrontmatter(markdown: string) {
  const lines = markdown.split(/\r\n|[\n\r\u2028\u2029]/);
  const first = lines[0]?.trim();
  const kind = first === "---" ? "yaml" : first === "+++" ? "toml" : "";
  if (!kind) return null;
  const closeIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === first,
  );
  if (closeIndex <= 0) return null;
  const body = lines.slice(1, closeIndex);
  if (!body.some((line) => line.trim())) return null;
  return {
    body,
    endLine: closeIndex + 1,
    kind,
    raw: lines.slice(0, closeIndex + 1).join("\n"),
  };
}

function createFrontmatterElement(frontmatter: {
  body: string[];
  endLine: number;
  kind: string;
  raw: string;
}): MarkdownHastElement {
  const lastLine =
    frontmatter.raw.split(/\r\n|[\n\r\u2028\u2029]/).at(-1) ?? "";
  return {
    type: "element",
    tagName: "div",
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: {
        line: frontmatter.endLine,
        column: lastLine.length + 1,
        offset: frontmatter.raw.length,
      },
    },
    properties: {
      dataMarkdownFrontmatter: frontmatter.kind,
    },
    children: [
      {
        type: "element",
        tagName: "pre",
        properties: { dataMarkdownFrontmatterSource: "" },
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { dataMarkdownFrontmatterSource: "" },
            children: [{ type: "text", value: frontmatter.raw }],
          },
        ],
      },
      {
        type: "element",
        tagName: "dl",
        properties: { dataMarkdownFrontmatterMetadata: "" },
        children: frontmatterEntries(frontmatter).flatMap(
          ([key, value, kind]) => [
            {
              type: "element" as const,
              tagName: "dt",
              properties: {},
              children: [{ type: "text" as const, value: key }],
            },
            {
              type: "element" as const,
              tagName: "dd",
              properties: { dataFrontmatterValueKind: kind },
              children: [{ type: "text" as const, value }],
            },
          ],
        ),
      },
    ],
  };
}

function frontmatterEntries(frontmatter: { body: string[]; kind: string }) {
  return frontmatter.kind === "toml"
    ? tomlFrontmatterEntries(frontmatter.body)
    : yamlFrontmatterEntries(frontmatter.body);
}

function yamlFrontmatterEntries(
  lines: string[],
): Array<[string, string, string]> {
  const entries: Array<[string, string, string]> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim();
    if (value.startsWith("{") || value.startsWith("[{")) continue;
    if (/^\[.*\]$/.test(value)) {
      entries.push([
        key,
        value
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim())
          .join(", "),
        "list",
      ]);
    } else if (value) {
      entries.push([key, value.replace(/^["']|["']$/g, ""), "scalar"]);
    } else {
      const items: string[] = [];
      while (/^\s+-\s+/.test(lines[index + 1] ?? "")) {
        index += 1;
        items.push((lines[index] ?? "").replace(/^\s+-\s+/, "").trim());
      }
      if (items.length) entries.push([key, items.join(", "), "list"]);
    }
  }
  return entries;
}

function tomlFrontmatterEntries(
  lines: string[],
): Array<[string, string, string]> {
  const entries: Array<[string, string, string]> = [];
  let section = "";
  for (const line of lines) {
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line.trim());
    if (sectionMatch) {
      section = `${sectionMatch[1]}.`;
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = `${section}${match[1]}`;
    const value = match[2]!.trim();
    if (/^\[.*\]$/.test(value)) {
      entries.push([
        key,
        value
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim().replace(/^["']|["']$/g, ""))
          .join(", "),
        "list",
      ]);
    } else {
      entries.push([key, value.replace(/^["']|["']$/g, ""), "scalar"]);
    }
  }
  return entries;
}

function remarkMarkdownGithubAlerts() {
  return function transform(tree: unknown) {
    for (const node of (tree as MarkdownMdastRoot).children) {
      transformGithubAlertBlockquote(node);
    }
  };
}

function remarkMarkdownProseTransforms() {
  return function transform(tree: unknown) {
    visitMarkdownMdastNodes(tree as MarkdownMdastRoot, (node) => {
      if (node.type !== "text" || typeof node.value !== "string") return;
      node.value = node.value
        .replace(/--/g, "—")
        .replace(/\.\.\./g, "…")
        .replace(/->/g, "→")
        .replace(/\b1\/2\b/g, "½");
    });
  };
}

function transformGithubAlertBlockquote(node: MarkdownMdastNode) {
  if (node.type !== "blockquote") return;

  const blockquote = node;
  const first = blockquote.children?.[0];
  if (!first || first.type !== "paragraph") return;

  const alert = readGithubAlertMarker(first as MarkdownMdastParagraph);
  if (!alert) return;

  blockquote.data = {
    ...blockquote.data,
    hProperties: {
      ...(blockquote.data?.hProperties as Record<string, unknown> | undefined),
      dataPretextAlertKind: alert.kind,
      dataPretextAlertTitle: alert.title,
    },
  };
}

function remarkMarkdownCodeMetadata() {
  return function transform(tree: unknown) {
    visitMarkdownMdastNodes(tree as MarkdownMdastRoot, (node) => {
      if (node.type !== "code" || !node.meta) return;
      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data?.hProperties as Record<string, unknown> | undefined),
          dataPretextCodeMeta: node.meta,
        },
      };
    });
  };
}

function remarkMarkdownTrustedImages() {
  return function transform(tree: unknown) {
    visitMarkdownMdastNodes(tree as MarkdownMdastRoot, (node) => {
      if (node.type !== "image" && node.type !== "imageReference") return;
      node.data = {
        ...node.data,
        hProperties: {
          ...(node.data?.hProperties as Record<string, unknown> | undefined),
          dataPretextMarkdownImage: "",
        },
      };
    });
  };
}

function visitMarkdownMdastNodes(
  node: MarkdownMdastNode,
  visitor: (node: MarkdownMdastNode) => void,
) {
  visitor(node);
  for (const child of node.children ?? []) {
    visitMarkdownMdastNodes(child, visitor);
  }
}

function rehypeMarkdownCachedKatex(options: typeof MARKDOWN_KATEX_OPTIONS) {
  const renderKatex = rehypeKatex(options);

  return function transform(tree: MarkdownHastRoot, file: VFile) {
    const state: MarkdownKatexRenderState = {
      cachedMessages: [],
      firstMissByKey: new Map(),
      firstMisses: [],
      nextMarkerId: 1,
      placeholders: [],
      renderedByKey: new Map(),
    };
    prepareMarkdownKatexRenderCache(tree, state);
    const firstKatexMessageIndex = file.messages.length;
    renderKatex(tree as never, file);
    finishMarkdownKatexRenderCache(tree, file, state, firstKatexMessageIndex);
  };
}

function prepareMarkdownKatexRenderCache(
  parent: MarkdownHastParent,
  state: MarkdownKatexRenderState,
) {
  let index = 0;
  while (index < parent.children.length) {
    const child = parent.children[index]!;
    const element = readHastElement(child);
    if (!element) {
      index += 1;
      continue;
    }

    const match = readMarkdownKatexMatch(element);
    if (!match) {
      prepareMarkdownKatexRenderCache(element, state);
      index += 1;
      continue;
    }

    const key = markdownKatexRenderCacheKey(match);
    const cached = readMarkdownKatexRenderCache(key);
    if (cached) {
      parent.children.splice(index, 1, ...cloneMarkdownHastNodes(cached.nodes));
      if (cached.message) {
        state.cachedMessages.push({
          message: cached.message,
          messagePosition: match.messagePosition,
        });
      }
      markdownKatexRenderCacheStats.hits += 1;
      index += cached.nodes.length;
      continue;
    }

    if (state.firstMissByKey.has(key)) {
      const placeholder = createMarkdownKatexPlaceholder(state);
      parent.children[index] = placeholder;
      state.placeholders.push({
        key,
        messagePosition: match.messagePosition,
        placeholderId: readStringProperty(
          placeholder.properties?.dataPretextKatexCachePlaceholder,
        ),
      });
      markdownKatexRenderCacheStats.sameDocumentHits += 1;
      index += 1;
      continue;
    }

    const startMarker = createMarkdownKatexMarker(state, "start");
    const endMarker = createMarkdownKatexMarker(state, "end");
    const miss: MarkdownKatexRenderMiss = {
      endMarkerId: readStringProperty(
        endMarker.properties?.dataPretextKatexCacheMarker,
      ),
      key,
      messagePosition: match.messagePosition,
      startMarkerId: readStringProperty(
        startMarker.properties?.dataPretextKatexCacheMarker,
      ),
    };
    state.firstMissByKey.set(key, miss);
    state.firstMisses.push(miss);
    markdownKatexRenderCacheStats.misses += 1;
    parent.children.splice(index, 1, startMarker, match.scope, endMarker);
    index += 3;
  }
}

function finishMarkdownKatexRenderCache(
  tree: MarkdownHastRoot,
  file: VFile,
  state: MarkdownKatexRenderState,
  firstKatexMessageIndex: number,
) {
  const katexMessages = file.messages
    .slice(firstKatexMessageIndex)
    .filter((message) => message.source === "rehype-katex");
  const usedMessageIndexes = new Set<number>();

  for (const miss of state.firstMisses) {
    const renderedNodes = readRenderedMarkdownKatexNodes(tree, miss);
    if (!renderedNodes) continue;
    const message = readMarkdownKatexMessageForMiss({
      messages: katexMessages,
      miss,
      usedMessageIndexes,
    });
    const entry = {
      message,
      nodes: cloneMarkdownHastNodes(renderedNodes),
    };
    state.renderedByKey.set(miss.key, entry);
    writeMarkdownKatexRenderCache(miss.key, entry);
  }

  for (const placeholder of state.placeholders) {
    const cached =
      state.renderedByKey.get(placeholder.key) ??
      readMarkdownKatexRenderCache(placeholder.key);
    if (!cached) continue;
    replaceMarkdownKatexPlaceholder(
      tree,
      placeholder.placeholderId,
      cloneMarkdownHastNodes(cached.nodes),
    );
    replayMarkdownKatexCacheMessage(file, placeholder, cached.message);
  }

  for (const cachedMessage of state.cachedMessages) {
    replayMarkdownKatexCacheMessage(file, cachedMessage, cachedMessage.message);
  }
}

function readMarkdownKatexMatch(
  element: MarkdownHastElement,
): MarkdownKatexMatch | null {
  if (element.tagName === "pre") {
    const code = element.children.map(readHastElement).find((child) => {
      return (
        child?.tagName === "code" && hasArrayClassName(child, "language-math")
      );
    });
    if (code) {
      return {
        displayMode: true,
        messagePosition: code.position,
        mode: "display",
        scope: element,
        source: extractMarkdownKatexText(element),
      };
    }
  }

  const languageMath = hasArrayClassName(element, "language-math");
  const mathDisplay = hasArrayClassName(element, "math-display");
  const mathInline = hasArrayClassName(element, "math-inline");
  if (!languageMath && !mathDisplay && !mathInline) return null;

  return {
    displayMode: mathDisplay,
    messagePosition: element.position,
    mode: mathDisplay ? "display" : "inline",
    scope: element,
    source: extractMarkdownKatexText(element),
  };
}

function createMarkdownKatexMarker(
  state: MarkdownKatexRenderState,
  side: "end" | "start",
): MarkdownHastElement {
  const id = `${side}-${state.nextMarkerId}`;
  state.nextMarkerId += 1;
  return {
    type: "element",
    tagName: "span",
    properties: {
      dataPretextKatexCacheMarker: id,
      hidden: true,
    },
    children: [],
  };
}

function createMarkdownKatexPlaceholder(
  state: MarkdownKatexRenderState,
): MarkdownHastElement {
  const id = `placeholder-${state.nextMarkerId}`;
  state.nextMarkerId += 1;
  return {
    type: "element",
    tagName: "span",
    properties: {
      dataPretextKatexCachePlaceholder: id,
      hidden: true,
    },
    children: [],
  };
}

function readRenderedMarkdownKatexNodes(
  parent: MarkdownHastParent,
  miss: MarkdownKatexRenderMiss,
): MarkdownHastNode[] | null {
  const startIndex = parent.children.findIndex((child) =>
    isMarkdownKatexMarker(child, miss.startMarkerId),
  );
  if (startIndex >= 0) {
    const endIndex = parent.children.findIndex((child, index) => {
      return (
        index > startIndex && isMarkdownKatexMarker(child, miss.endMarkerId)
      );
    });
    if (endIndex < 0) return null;
    const renderedNodes = parent.children.slice(startIndex + 1, endIndex);
    parent.children.splice(
      startIndex,
      endIndex - startIndex + 1,
      ...renderedNodes,
    );
    return renderedNodes;
  }

  for (const child of parent.children) {
    const element = readHastElement(child);
    if (!element) continue;
    const renderedNodes = readRenderedMarkdownKatexNodes(element, miss);
    if (renderedNodes) return renderedNodes;
  }
  return null;
}

function replaceMarkdownKatexPlaceholder(
  parent: MarkdownHastParent,
  placeholderId: string,
  nodes: MarkdownHastNode[],
): boolean {
  const index = parent.children.findIndex((child) =>
    isMarkdownKatexPlaceholder(child, placeholderId),
  );
  if (index >= 0) {
    parent.children.splice(index, 1, ...nodes);
    return true;
  }

  for (const child of parent.children) {
    const element = readHastElement(child);
    if (
      element &&
      replaceMarkdownKatexPlaceholder(element, placeholderId, nodes)
    ) {
      return true;
    }
  }
  return false;
}

function readMarkdownKatexMessageForMiss({
  messages,
  miss,
  usedMessageIndexes,
}: {
  messages: readonly VFile["messages"][number][];
  miss: MarkdownKatexRenderMiss;
  usedMessageIndexes: Set<number>;
}): MarkdownKatexCacheMessage | undefined {
  const start = miss.messagePosition?.start;
  const exactIndex = messages.findIndex((message, index) => {
    return (
      !usedMessageIndexes.has(index) &&
      message.line === start?.line &&
      (start?.column == null || message.column === start.column)
    );
  });
  const hasPosition = start?.line != null || start?.column != null;
  if (exactIndex < 0 && hasPosition) return undefined;
  const fallbackIndex =
    exactIndex >= 0
      ? exactIndex
      : messages.findIndex((_, index) => !usedMessageIndexes.has(index));
  if (fallbackIndex < 0) return undefined;

  usedMessageIndexes.add(fallbackIndex);
  const message = messages[fallbackIndex]!;
  return {
    reason: message.reason,
    ruleId: message.ruleId,
    source: message.source,
  };
}

function replayMarkdownKatexCacheMessage(
  file: VFile,
  target: { messagePosition?: MarkdownHastElement["position"] },
  message: MarkdownKatexCacheMessage | undefined,
) {
  if (!message) return;
  file.message(message.reason, {
    place: target.messagePosition as never,
    ruleId: message.ruleId ?? undefined,
    source: message.source ?? undefined,
  });
}

function isMarkdownKatexMarker(node: MarkdownHastNode, id: string) {
  return (
    readStringProperty(
      readHastElement(node)?.properties?.dataPretextKatexCacheMarker,
    ) === id
  );
}

function isMarkdownKatexPlaceholder(node: MarkdownHastNode, id: string) {
  return (
    readStringProperty(
      readHastElement(node)?.properties?.dataPretextKatexCachePlaceholder,
    ) === id
  );
}

function readMarkdownKatexRenderCache(key: string) {
  const entry = markdownKatexRenderCache.get(key);
  if (!entry) return null;
  markdownKatexRenderCache.delete(key);
  markdownKatexRenderCache.set(key, entry);
  return entry;
}

function writeMarkdownKatexRenderCache(
  key: string,
  entry: MarkdownKatexCacheEntry,
) {
  markdownKatexRenderCache.set(key, entry);
  markdownKatexRenderCacheStats.writes += 1;
  while (markdownKatexRenderCache.size > MARKDOWN_KATEX_RENDER_CACHE_LIMIT) {
    const oldestKey = markdownKatexRenderCache.keys().next().value;
    if (!oldestKey) break;
    markdownKatexRenderCache.delete(oldestKey);
  }
}

function markdownKatexRenderCacheKey(match: MarkdownKatexMatch) {
  return JSON.stringify([
    MARKDOWN_KATEX_RENDER_CACHE_RENDERER,
    MARKDOWN_KATEX_RENDER_CACHE_CONFIG,
    match.mode,
    match.displayMode,
    match.source,
  ]);
}

function markdownKatexConfigKey(options: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(options).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function extractMarkdownKatexText(node: MarkdownHastNode): string {
  if (node.type === "text" && typeof node.value === "string") return node.value;
  const element = readHastElement(node);
  if (!element) return "";
  return element.children.map(extractMarkdownKatexText).join("");
}

function cloneMarkdownHastNodes(nodes: readonly MarkdownHastNode[]) {
  return nodes.map(cloneMarkdownHastNode);
}

function cloneMarkdownHastNode(node: MarkdownHastNode): MarkdownHastNode {
  if (node.type === "text") {
    return {
      ...node,
      position: node.position
        ? cloneMarkdownPosition(node.position)
        : undefined,
    };
  }
  const element = readHastElement(node);
  if (element) {
    return {
      ...element,
      children: cloneMarkdownHastNodes(element.children),
      position: element.position
        ? cloneMarkdownPosition(element.position)
        : undefined,
      properties: element.properties
        ? cloneMarkdownProperties(element.properties)
        : undefined,
    };
  }
  const children = "children" in node ? node.children : undefined;
  return {
    ...node,
    children: children ? cloneMarkdownHastNodes(children) : undefined,
    position: node.position ? cloneMarkdownPosition(node.position) : undefined,
  };
}

function cloneMarkdownPosition(
  position: NonNullable<MarkdownHastNode["position"]>,
) {
  return {
    end: position.end ? { ...position.end } : undefined,
    start: position.start ? { ...position.start } : undefined,
  };
}

function cloneMarkdownProperties(properties: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    next[key] = Array.isArray(value) ? [...value] : value;
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

function hasArrayClassName(element: MarkdownHastElement, className: string) {
  const value = element.properties?.className;
  return Array.isArray(value) && value.includes(className);
}

function readStringProperty(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return "";
}

export function resetMarkdownMathRenderCacheForTests() {
  markdownKatexRenderCache.clear();
  markdownKatexRenderCacheStats.hits = 0;
  markdownKatexRenderCacheStats.misses = 0;
  markdownKatexRenderCacheStats.sameDocumentHits = 0;
  markdownKatexRenderCacheStats.writes = 0;
}

export function getMarkdownMathRenderCacheStatsForTests() {
  return {
    ...markdownKatexRenderCacheStats,
    size: markdownKatexRenderCache.size,
  };
}

function readGithubAlertMarker(paragraph: MarkdownMdastParagraph) {
  const first = paragraph.children[0];
  if (!first || first.type !== "text") return null;

  const match =
    /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*(?:\r?\n)?/i.exec(
      first.value ?? "",
    );
  if (!match) return null;

  const kind = match[1]!.toLowerCase() as keyof typeof GITHUB_ALERT_LABELS;
  first.value = (first.value ?? "").slice(match[0].length);
  if (!first.value) {
    paragraph.children.shift();
  }

  return {
    kind,
    title: GITHUB_ALERT_LABELS[kind],
  };
}

function remarkMarkdownComponents() {
  return function transform(tree: unknown, file: VFile) {
    transformMarkdownComponentChildren(tree as MarkdownMdastRoot, file);
  };
}

function remarkMarkdownDefinitionLists() {
  return function transform(tree: unknown) {
    const root = tree as MarkdownMdastRoot;
    const nextChildren: MarkdownMdastNode[] = [];
    for (const child of root.children) {
      const definitionList = markdownDefinitionListFromParagraph(child);
      nextChildren.push(definitionList ?? child);
    }
    root.children = nextChildren;
  };
}

function markdownDefinitionListFromParagraph(
  node: MarkdownMdastNode,
): MarkdownMdastNode | null {
  if (node.type !== "paragraph" || !node.children?.length) return null;

  const lines = splitMdastParagraphLines(node.children);
  if (lines.length < 2) return null;
  const term = trimMdastLine(lines[0] ?? []);
  const definitions = lines
    .slice(1)
    .map(trimDefinitionLine)
    .filter(
      (definition): definition is MarkdownMdastNode[] => definition != null,
    );
  if (!term.length || !definitions.length) return null;

  return {
    type: "list",
    data: {
      hName: "dl",
      hProperties: {
        dataPretextDefinitionList: "",
      },
    },
    children: [
      {
        type: "listItem",
        data: {
          hName: "dt",
          hProperties: {
            dataPretextDefinitionTerm: "",
          },
        },
        children: term,
      },
      ...definitions.map((definition) => ({
        type: "listItem",
        data: {
          hName: "dd",
          hProperties: {
            dataPretextDefinitionDescription: "",
          },
        },
        children: definition,
      })),
    ],
  };
}

function splitMdastParagraphLines(children: MarkdownMdastNode[]) {
  const lines: MarkdownMdastNode[][] = [[]];
  for (const child of children) {
    if (child.type === "break") {
      lines.push([]);
      continue;
    }
    if (child.type === "text" && typeof child.value === "string") {
      const parts = child.value.split(/\r?\n/);
      parts.forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part) lines[lines.length - 1]!.push({ ...child, value: part });
      });
      continue;
    }
    lines[lines.length - 1]!.push(child);
  }
  return lines;
}

function trimMdastLine(line: MarkdownMdastNode[]) {
  return trimMdastLineEnd(trimMdastLineStart(line));
}

function trimDefinitionLine(line: MarkdownMdastNode[]) {
  const trimmed = trimMdastLine(line);
  const first = trimmed[0];
  if (
    !first ||
    first.type !== "text" ||
    typeof first.value !== "string" ||
    !first.value.startsWith(":")
  ) {
    return null;
  }
  first.value = first.value.replace(/^:\s*/, "");
  return trimMdastLine(trimmed);
}

function trimMdastLineStart(line: MarkdownMdastNode[]) {
  const next = line.map((node) => ({ ...node }));
  while (
    next[0]?.type === "text" &&
    typeof next[0].value === "string" &&
    !next[0].value.trim()
  ) {
    next.shift();
  }
  if (next[0]?.type === "text" && typeof next[0].value === "string") {
    next[0].value = next[0].value.replace(/^\s+/, "");
    if (!next[0].value) next.shift();
  }
  return next;
}

function trimMdastLineEnd(line: MarkdownMdastNode[]) {
  const next = line.map((node) => ({ ...node }));
  while (
    next.at(-1)?.type === "text" &&
    typeof next.at(-1)?.value === "string" &&
    !String(next.at(-1)?.value).trim()
  ) {
    next.pop();
  }
  const last = next.at(-1);
  if (last?.type === "text" && typeof last.value === "string") {
    last.value = last.value.replace(/\s+$/, "");
    if (!last.value) next.pop();
  }
  return next;
}

function rehypeMarkdownSafeInputs() {
  return function transform(tree: MarkdownHastRoot) {
    removeUnsafeInputChildren(tree);
  };
}

function rehypeMarkdownTrustedMetadata() {
  return function transform(tree: MarkdownHastRoot) {
    trustGeneratedMarkdownMetadata(tree);
  };
}

function trustGeneratedMarkdownMetadata(
  node: MarkdownHastElement | MarkdownHastRoot,
) {
  for (const child of node.children) {
    const element = child as MarkdownHastElement;
    if (!element || element.type !== "element") continue;

    if (hasMarkdownInternalMetadata(element)) {
      if (element.position) {
        stripMarkdownInternalMetadata(element);
      } else if (hasMarkdownTrustedComponentMetadata(element)) {
        element.properties ??= {};
        element.properties.pretextComponentTrusted = true;
      }
    }

    trustGeneratedMarkdownMetadata(element);
  }
}

function hasMarkdownInternalMetadata(element: MarkdownHastElement) {
  return Object.keys(element.properties ?? {}).some((key) =>
    /^(?:dataPretextComponent|dataPretextCallout|dataFootnotes|dataFootnoteBackref|pretextComponentTrusted)/.test(
      key,
    ),
  );
}

function hasMarkdownTrustedComponentMetadata(element: MarkdownHastElement) {
  return Object.keys(element.properties ?? {}).some((key) =>
    /^(?:dataPretextComponent|dataPretextCallout|pretextComponentTrusted)/.test(
      key,
    ),
  );
}

function stripMarkdownInternalMetadata(element: MarkdownHastElement) {
  for (const key of Object.keys(element.properties ?? {})) {
    if (
      /^(?:dataPretextComponent|data-pretext-component|dataPretextCallout|data-pretext-callout|dataFootnotes|data-footnotes|dataFootnoteBackref|data-footnote-backref|pretextComponentTrusted)/.test(
        key,
      )
    ) {
      delete element.properties?.[key];
    }
  }
}

function removeUnsafeInputChildren(
  parent: MarkdownHastElement | MarkdownHastRoot,
) {
  if (!Array.isArray(parent.children)) return;
  parent.children = parent.children.filter((child) => {
    const element = child as MarkdownHastElement;
    if (!element || element.type !== "element") return true;
    if (element.tagName !== "input") return true;
    return (
      isHastElement(parent) &&
      parent.tagName === "li" &&
      hasClassName(parent, "task-list-item") &&
      element.properties?.type === "checkbox"
    );
  });
  for (const child of parent.children) {
    const element = child as MarkdownHastElement;
    if (element?.type === "element") removeUnsafeInputChildren(element);
  }
}

function isHastElement(
  node: MarkdownHastElement | MarkdownHastRoot,
): node is MarkdownHastElement {
  return node.type === "element";
}

function hasClassName(element: MarkdownHastElement, className: string) {
  const value = element.properties?.className;
  return Array.isArray(value) && value.includes(className);
}

function transformMarkdownComponentChildren(
  parent: MarkdownMdastNode,
  file: VFile,
) {
  const children = parent.children;
  if (!children) return;
  transformMarkdownHtmlContainers(parent, file);

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;

    if (child.type === "html" && typeof child.value === "string") {
      const component = parseMarkdownComponentHtml(child.value);
      if (component) {
        children[index] = createMarkdownComponentNode(component);
        continue;
      }
      // CommonMark merges consecutive component tags (no blank line between)
      // into one HTML block; split it so each tag renders as its own component
      // (or its own fallback) instead of the whole run falling through to text.
      const multiple = splitMarkdownComponentHtml(child.value, file);
      if (multiple) {
        children.splice(index, 1, ...multiple);
        index += multiple.length - 1;
        continue;
      }
      if (isMarkdownComponentHtml(child.value)) {
        const reason = fallbackReasonForHtml(child.value);
        emitMarkdownComponentFallbackMessage({
          file,
          node: child,
          reason,
        });
        children[index] = createMarkdownComponentFallbackNode({
          name: componentNameFromHtml(child.value) ?? "Component",
          reason,
          source: child.value.trim(),
        });
        continue;
      }
    }

    const paragraphComponentSource = componentSourceFromParagraph(child, file);
    if (paragraphComponentSource) {
      const reason = fallbackReasonForHtml(paragraphComponentSource);
      emitMarkdownComponentFallbackMessage({
        file,
        node: child,
        reason,
      });
      children[index] = createMarkdownComponentFallbackNode({
        name: componentNameFromHtml(paragraphComponentSource) ?? "Component",
        reason,
        source: paragraphComponentSource,
      });
      continue;
    }

    if (
      child.type === "containerDirective" &&
      isMarkdownContainerComponentName(readDirectiveName(child))
    ) {
      transformMarkdownComponentChildren(child, file);
      const component = parseMarkdownDirectiveComponent(child);
      if (component) {
        children[index] = createMarkdownComponentNode(component);
        continue;
      }
      if (isMarkdownContainerComponentName(readDirectiveName(child))) {
        const reason = "Unsupported component directive props";
        emitMarkdownComponentFallbackMessage({
          file,
          node: child,
          reason,
        });
        children[index] = createMarkdownComponentFallbackNode({
          name:
            componentNameForDirective(readDirectiveName(child)) ?? "Component",
          reason,
          source: directiveSourceForUnsafeComponent(child),
          children: child.children ?? [],
        });
        continue;
      }
    }

    if (
      child.type === "containerDirective" &&
      isCalloutKind(readDirectiveName(child))
    ) {
      children[index] = createMarkdownCalloutNode(child);
      continue;
    }

    if (child.type === "leafDirective" || child.type === "textDirective") {
      const component = parseMarkdownDirectiveComponent(child);
      if (component) {
        children[index] = createMarkdownComponentNode(component);
        continue;
      }
      if (componentNameForDirective(readDirectiveName(child))) {
        const reason = "Unsupported component directive props";
        emitMarkdownComponentFallbackMessage({
          file,
          node: child,
          reason,
        });
        children[index] = createMarkdownComponentFallbackNode({
          name:
            componentNameForDirective(readDirectiveName(child)) ?? "Component",
          reason,
          source: directiveSourceForUnsafeComponent(child),
          children:
            child.type === "textDirective" ? (child.children ?? []) : [],
        });
        continue;
      }
    }

    transformMarkdownComponentChildren(child, file);
  }
}

function componentSourceFromParagraph(node: MarkdownMdastNode, file: VFile) {
  if (node.type !== "paragraph") return null;
  const nonWhitespaceChildren = (node.children ?? []).filter(
    (child) => !(child.type === "text" && !String(child.value ?? "").trim()),
  );
  if (nonWhitespaceChildren.length !== 1) return null;
  const onlyChild = nonWhitespaceChildren[0]!;
  if (onlyChild.type !== "text" || typeof onlyChild.value !== "string") {
    return null;
  }

  const source = sourceTextForMdastNode(node, file).trim() || onlyChild.value;
  return isMarkdownComponentHtml(source) ? source : null;
}

function transformMarkdownHtmlContainers(
  parent: MarkdownMdastNode,
  file: VFile,
) {
  const children = parent.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.type !== "html" || typeof child.value !== "string") continue;
    const start = /^<([A-Z][A-Za-z0-9]*)\b([^>]*)>$/.exec(child.value.trim());
    if (!start || !["Accordion", "Callout"].includes(start[1]!)) continue;
    const name = start[1]!;
    const closeIndex = children.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.type === "html" &&
        typeof candidate.value === "string" &&
        candidate.value.trim() === `</${name}>`,
    );
    if (closeIndex < 0) continue;
    const propsText = start[2]!;
    const source = child.value.trim();
    const inner = children.slice(index + 1, closeIndex);
    const component = hasEventHandlerAttribute(propsText)
      ? null
      : parseMarkdownComponentProps(
          name,
          parseComponentAttributes(propsText),
          inner,
        );
    if (!component) {
      emitMarkdownComponentFallbackMessage({
        file,
        node: child,
        reason: fallbackReasonForHtml(source),
      });
    }
    children.splice(
      index,
      closeIndex - index + 1,
      component
        ? createMarkdownComponentNode(component)
        : createMarkdownComponentFallbackNode({
            name,
            reason: fallbackReasonForHtml(source),
            source,
            children: inner,
          }),
    );
  }
}

function emitMarkdownComponentFallbackMessage({
  file,
  node,
  reason,
}: {
  file: VFile;
  node: MarkdownMdastNode;
  reason: string;
}) {
  file.message(
    new Error(reason),
    markdownMessagePoint(node),
    "markdown:component-fallback",
  );
}

function markdownMessagePoint(node: MarkdownMdastNode) {
  const point = node.position?.start;
  return typeof point?.line === "number" && typeof point.column === "number"
    ? { column: point.column, line: point.line }
    : null;
}

function createMarkdownComponentNode(
  component: MarkdownComponent,
): MarkdownMdastNode {
  return {
    type: "pretextComponent",
    data: {
      hName: "div",
      hProperties: {
        dataPretextComponentName: component.name,
        dataPretextComponentProps: JSON.stringify(component.props),
      },
    },
    children: component.children ?? [],
  };
}

function createMarkdownComponentFallbackNode({
  children = [],
  name,
  reason,
  source,
}: {
  children?: MarkdownMdastNode[];
  name: string;
  reason: string;
  source: string;
}): MarkdownMdastNode {
  return {
    type: "pretextComponentFallback",
    data: {
      hName: "div",
      hProperties: {
        dataPretextComponentFallback: "",
        dataPretextComponentFallbackName: name,
        dataPretextComponentFallbackReason: reason,
        dataPretextComponentFallbackSource: source,
      },
    },
    children: [{ type: "text", value: source }, ...children],
  };
}

function createMarkdownCalloutNode(node: MarkdownMdastNode): MarkdownMdastNode {
  const kind = calloutKind(readDirectiveName(node));
  const attrs = readDirectiveAttributes(node) ?? {};
  const title =
    typeof attrs.title === "string" && attrs.title
      ? attrs.title
      : calloutTitle(kind);
  return {
    type: "pretextCallout",
    data: {
      hName: "div",
      hProperties: {
        dataPretextCalloutKind: kind,
        dataPretextCalloutTitle: title,
      },
    },
    children: node.children ?? [],
  };
}

// Splits an HTML block holding several self-closing component tags (only
// whitespace between them) into one node per tag: a component node when the tag
// parses, otherwise a fallback node — so one invalid tag never blanks the whole
// run. Returns null only when the block isn't entirely component tags (then
// normal HTML handling applies).
function splitMarkdownComponentHtml(value: string, file: VFile) {
  const trimmed = value.trim();
  // Quote-aware so `>` inside an attribute value doesn't end a tag early.
  const tagPattern = /<[A-Z][A-Za-z0-9]*\b(?:[^>"']|"[^"]*"|'[^']*')*\/>/g;
  const matches = [...trimmed.matchAll(tagPattern)];
  if (matches.length < 2) return null;

  let cursor = 0;
  for (const match of matches) {
    if (trimmed.slice(cursor, match.index).trim() !== "") return null;
    cursor = match.index + match[0].length;
  }
  if (trimmed.slice(cursor).trim() !== "") return null;

  // Only treat the block as components when every tag names a known component.
  if (
    !matches.every((match) => {
      const name = componentNameFromHtml(match[0]);
      return name !== null && isMarkdownLeafComponentName(name);
    })
  ) {
    return null;
  }

  return matches.map((match) => {
    const tag = match[0];
    const component = parseMarkdownComponentHtml(tag);
    if (component) return createMarkdownComponentNode(component);
    const reason = fallbackReasonForHtml(tag);
    emitMarkdownComponentFallbackMessage({
      file,
      node: { type: "html", value: tag } as MarkdownMdastNode,
      reason,
    });
    return createMarkdownComponentFallbackNode({
      name: componentNameFromHtml(tag) ?? "Component",
      reason,
      source: tag,
    });
  });
}

function parseMarkdownComponentHtml(value: string) {
  // Match exactly one self-closing tag: attribute chars are either non-quote/
  // non-`>` or fully-quoted strings, so `>` inside an attribute (e.g. a mermaid
  // `source="graph TD; A-->B"`) is allowed, while a multi-tag HTML block fails
  // here and is handled by splitMarkdownComponentHtml.
  const match = /^<([A-Z][A-Za-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)\/>$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const name = match[1]!;
  const propsText = match[2]!;
  if (!isMarkdownLeafComponentName(name)) {
    return null;
  }
  return parseMarkdownComponentProps(
    name,
    parseComponentAttributes(propsText),
    [],
  );
}

function parseMarkdownDirectiveComponent(node: MarkdownMdastNode) {
  const name = componentNameForDirective(readDirectiveName(node));
  if (!name) return null;
  return parseMarkdownComponentProps(
    name,
    readDirectiveAttributes(node),
    node.children ?? [],
  );
}

function parseMarkdownComponentProps(
  name: string,
  props: Record<string, unknown> | null,
  children: MarkdownMdastNode[],
): MarkdownComponent | null {
  if (!props) return null;
  if (Object.keys(props).some((key) => /^on/i.test(key))) return null;

  if (name === "Diagram") {
    if (props.type !== "mermaid" || typeof props.source !== "string")
      return null;
    return {
      name,
      props: {
        caption: readPropString(props.caption),
        source: normalizeMarkdownDiagramSource(props.source),
        title: readPropString(props.title),
        type: "mermaid",
      },
    };
  }
  if (name === "Metric") {
    if (!props.label || !props.value || props.tone) return null;
    return {
      name,
      props: {
        label: readPropString(props.label),
        value: readPropString(props.value),
      },
    };
  }
  if (name === "Badge") {
    const label = readPropString(props.label) || mdastText(children);
    const tone = readPropString(props.tone);
    if (!label || (tone && !["default", "success", "warning"].includes(tone))) {
      return null;
    }
    return { name, props: { label, tone } };
  }
  if (name === "Image") {
    if (!props.src || !props.alt) return null;
    return {
      name,
      props: {
        alt: readPropString(props.alt),
        height: readPropString(props.height),
        src: readPropString(props.src),
        title: readPropString(props.title),
        width: readPropString(props.width),
      },
    };
  }
  if (name === "Video") {
    if (!props.src || !props.label) return null;
    return {
      name,
      props: {
        controls: readPropString(props.controls),
        label: readPropString(props.label),
        loop: readPropString(props.loop),
        muted: readPropString(props.muted),
        src: readPropString(props.src),
        title: readPropString(props.title),
      },
    };
  }
  if (name === "Accordion") {
    if (!props.title) return null;
    return { name, props: { title: readPropString(props.title) }, children };
  }
  if (name === "Callout") {
    const kind = calloutKind(readPropString(props.kind) || "note");
    return {
      name,
      props: {
        kind,
        title: readPropString(props.title) || calloutTitle(kind),
      },
      children,
    };
  }
  if (name === "Tabs" || name === "Tab") {
    return {
      name,
      props: {
        label: readPropString(props.label),
        title: readPropString(props.title),
      },
      children,
    };
  }
  return null;
}

function normalizeMarkdownDiagramSource(source: string) {
  return source
    .split(/;\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function readDirectiveName(node: MarkdownMdastNode) {
  const directive = node as unknown as { name?: unknown };
  return typeof directive.name === "string" ? directive.name : "";
}

function readDirectiveAttributes(node: MarkdownMdastNode) {
  const attributes = (node as { attributes?: unknown }).attributes;
  return attributes && typeof attributes === "object"
    ? (attributes as Record<string, unknown>)
    : null;
}

function parseQuotedAttributes(value: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(value.matchAll(/\s*([A-Za-z][A-Za-z0-9_]*)="([^"]*)"/g)).map(
      (item) => [item[1]!, item[2]!],
    ),
  );
}

function parseComponentAttributes(value: string) {
  if (/\{\s*\.\.\./.test(value)) return null;
  const attributes: Record<string, string> = {};
  const consumed: Array<[number, number]> = [];
  for (const match of value.matchAll(
    /\s+([A-Za-z][A-Za-z0-9_]*)=(?:"([^"]*)"|\{(\d+(?:\.\d+)?|true|false)\})/g,
  )) {
    attributes[match[1]!] = match[2] ?? match[3] ?? "";
    consumed.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  for (const match of value.matchAll(/\s+([A-Za-z][A-Za-z0-9_]*)(?=\s|$)/g)) {
    const index = match.index ?? 0;
    if (consumed.some(([start, end]) => index >= start && index < end)) {
      continue;
    }
    attributes[match[1]!] = "true";
    consumed.push([index, index + match[0].length]);
  }
  if (removeRanges(value, consumed).trim()) return null;
  return attributes;
}

function removeRanges(value: string, ranges: Array<[number, number]>) {
  let result = "";
  let offset = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    result += value.slice(offset, start);
    offset = end;
  }
  return result + value.slice(offset);
}

function readPropString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function mdastText(nodes: readonly MarkdownMdastNode[]): string {
  return nodes
    .map((node) =>
      typeof node.value === "string"
        ? node.value
        : mdastText(node.children ?? []),
    )
    .join("");
}

function componentNameForDirective(name: string) {
  const normalized = name.toLowerCase();
  const names: Record<string, string> = {
    accordion: "Accordion",
    badge: "Badge",
    callout: "Callout",
    diagram: "Diagram",
    image: "Image",
    metric: "Metric",
    tab: "Tab",
    tabs: "Tabs",
    video: "Video",
  };
  return names[normalized] ?? null;
}

function isMarkdownLeafComponentName(name: string) {
  return ["Badge", "Diagram", "Image", "Metric", "Video"].includes(name);
}

function isMarkdownContainerComponentName(name: string) {
  return Boolean(componentNameForDirective(name));
}

function isMarkdownComponentHtml(value: string) {
  return /^<\/?[A-Z][A-Za-z0-9.]*(?:\b|\.)/.test(value.trim());
}

function componentNameFromHtml(value: string) {
  return /^<\/?([A-Z][A-Za-z0-9.]*)/.exec(value.trim())?.[1] ?? null;
}

function hasEventHandlerAttribute(value: string) {
  return /\son[A-Za-z]+\s*=/.test(value);
}

function fallbackReasonForHtml(value: string) {
  const name = componentNameFromHtml(value);
  if (name?.includes(".")) {
    return "Remote or namespaced components are not supported";
  }
  if (!name || !componentNameForDirective(name)) return "Unsupported component";
  if (hasEventHandlerAttribute(value))
    return "Event handler props are not supported";
  if (value.includes("{")) return "Component props must be literal values";
  return "Unsupported component";
}

function sourceTextForMdastNode(node: MarkdownMdastNode, file: VFile) {
  const value = String(file.value ?? "");
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end < start
  ) {
    return "";
  }
  return value.slice(start, end);
}

function isCalloutKind(name: string) {
  return ["caution", "important", "note", "success", "tip", "warning"].includes(
    name.toLowerCase(),
  );
}

function calloutKind(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "success") return "tip";
  if (isCalloutKind(normalized)) return normalized;
  return "note";
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

function directiveSourceForUnsafeComponent(node: MarkdownMdastNode) {
  const name = readDirectiveName(node);
  const attrs = readDirectiveAttributes(node) ?? {};
  const attrSource = Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(" ");
  const marker = node.type === "textDirective" ? ":" : "::";
  return `${marker}${name}${attrSource ? `{${attrSource}}` : ""}`;
}

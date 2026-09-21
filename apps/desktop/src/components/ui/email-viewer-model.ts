import {
  detectCategory,
  type FileCategory,
  type ViewerSource,
} from "@/lib/viewer-source";

import type {
  EmailAddress,
  EmailBodySelectionPolicy,
  EmailContentEmptyReason,
  EmailContentModel,
  EmailHeaderModel,
  EmailInlineResource,
  EmailInlineResourceKey,
  EmailInlineResourceScope,
  EmailSidebarItem,
  EmailSidebarModel,
  EmailSidebarThumbnailModel,
  EmailViewerMessage,
  EmailViewerModel,
  MimeMessage,
  MimeMessageScope,
  MimePart,
  MimePartFacts,
  MimePartKind,
  MimePartNode,
  MimePartPath,
  MimePreviewPolicy,
} from "./email-viewer-types";
import { formatFileSize } from "./file-size-format";

const DEFAULT_EMPTY_CONTENT_MESSAGE =
  "This MIME part does not have a previewable body.";
const DEFAULT_MAX_NESTED_MESSAGE_DEPTH = 8;
const EMPTY_INLINE_RESOURCE_URLS = new Map<string, string>();
export const MISSING_EMAIL_INLINE_RESOURCE_URL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export const DEFAULT_EMAIL_BODY_SELECTION_POLICY = {
  preferredMimeTypes: ["text/html", "text/plain", "text/markdown"],
  includeInlineBodyParts: true,
  includeAttachments: false,
} satisfies EmailBodySelectionPolicy;

export function buildMimeTree(root: MimePart): MimePartNode {
  return buildMimeNode({
    part: root,
    parentPath: null,
    depth: 0,
    pathPart: normalizePathPart(root.id, 0),
  });
}

export function findMimeNodeByPath(
  root: MimePartNode,
  path: MimePartPath,
): MimePartNode | null {
  if (pathsEqual(root.path, path)) return root;
  for (const child of root.children) {
    const match = findMimeNodeByPath(child, path);
    if (match) return match;
  }
  return null;
}

export function getDefaultMimeSelectionPath(root: MimePartNode): MimePartPath {
  return (selectMimeScopeBodyNode(root) ?? root).path;
}

export function deriveEmailViewerModel({
  inlineResourceUrls,
  maxNestedMessageDepth = DEFAULT_MAX_NESTED_MESSAGE_DEPTH,
  message,
  nestedMessageDepth = 0,
  rootNode,
  selectedNode,
}: {
  inlineResourceUrls: ReadonlyMap<string, string>;
  maxNestedMessageDepth?: number;
  message: EmailViewerMessage;
  nestedMessageDepth?: number;
  rootNode: MimePartNode;
  selectedNode: MimePartNode;
}): EmailViewerModel {
  const scope = createMimeMessageScope(message, rootNode);
  const selectedPath = selectedNode.path;

  return {
    message,
    rootNode,
    scope,
    selectedPath,
    selectedNode,
    header: deriveEmailHeaderModel(message),
    sidebar: deriveEmailSidebarModel({
      inlineResourceUrls,
      scope,
      selectedPath,
    }),
    content: deriveEmailContentModel({
      inlineResourceUrls,
      maxNestedMessageDepth,
      message,
      nestedMessageDepth,
      selectedNode,
    }),
  };
}

export function createMimeMessageScope(
  message: EmailViewerMessage,
  root: MimePartNode,
): MimeMessageScope {
  return {
    message,
    root,
    path: root.path,
    descendants: collectCurrentMessageNodes(root),
  };
}

export function deriveEmailHeaderModel(
  message: EmailViewerMessage,
): EmailHeaderModel {
  return {
    subject: message.subject?.trim() || "(no subject)",
    from: normalizeAddressList(message.from),
    to: normalizeAddressList(message.to),
    cc: normalizeAddressList(message.cc),
    bcc: normalizeAddressList(message.bcc),
    sentAt: formatSentAt(message.sentAt),
  };
}

export function deriveEmailSidebarModel({
  inlineResourceUrls = EMPTY_INLINE_RESOURCE_URLS,
  scope,
  selectedPath,
}: {
  inlineResourceUrls?: ReadonlyMap<string, string>;
  scope: MimeMessageScope;
  selectedPath: MimePartPath;
}): EmailSidebarModel {
  const bodyNode = selectMimeScopeBodyNode(scope.root);
  const bodyItems: readonly EmailSidebarItem[] = [
    createSidebarItem({
      inlineResourceUrls,
      kind: "body",
      node: bodyNode ?? scope.root,
      selectedPath,
    }),
  ];
  const attachmentItems = scope.descendants
    .filter((node) => isEmailAttachmentSidebarNode(node, bodyNode))
    .map((node) =>
      createSidebarItem({
        inlineResourceUrls,
        kind: "attachment",
        node,
        selectedPath,
      }),
    );
  const sections = [
    {
      id: "body" as const,
      title: "Body",
      items: bodyItems,
    },
    {
      id: "attachments" as const,
      title: "Attachments",
      items: attachmentItems,
      emptyLabel: "No attachments.",
    },
  ];

  return {
    bodyCount: bodyItems.length,
    attachmentCount: attachmentItems.length,
    sections,
  };
}

export function deriveEmailContentModel({
  inlineResourceUrls,
  maxNestedMessageDepth = DEFAULT_MAX_NESTED_MESSAGE_DEPTH,
  message,
  nestedMessageDepth = 0,
  selectedNode,
}: {
  inlineResourceUrls: ReadonlyMap<string, string>;
  maxNestedMessageDepth?: number;
  message: EmailViewerMessage;
  nestedMessageDepth?: number;
  selectedNode: MimePartNode;
}): EmailContentModel {
  if (isMessageNode(selectedNode) && selectedNode.children.length > 0) {
    if (nestedMessageDepth >= maxNestedMessageDepth) {
      return createEmptyContent({
        message: "This nested message is too deeply nested to preview.",
        node: selectedNode,
        reason: "nested-depth-exceeded",
      });
    }

    return {
      kind: "nested-message",
      maxNestedMessageDepth,
      node: selectedNode,
      message: deriveNestedEmailMessage(message, selectedNode),
      nestedMessageDepth: nestedMessageDepth + 1,
    };
  }

  if (selectedNode.facts.preview.kind === "security-envelope") {
    return createEmptyContent({
      message: `${selectedNode.facts.preview.label} cannot be previewed in this viewer.`,
      node: selectedNode,
      reason: "security-envelope",
    });
  }

  const fileNode = selectDefaultPreviewNode(selectedNode, {
    stopAtNestedMessages: false,
  });

  if (!fileNode) {
    return createEmptyContent({
      message: DEFAULT_EMPTY_CONTENT_MESSAGE,
      node: selectedNode,
      reason:
        selectedNode.facts.preview.kind === "unsupported"
          ? selectedNode.facts.preview.reason
          : "no-previewable-body",
    });
  }

  if (fileNode.facts.preview.kind === "security-envelope") {
    return createEmptyContent({
      message: `${fileNode.facts.preview.label} cannot be previewed in this viewer.`,
      node: fileNode,
      reason: "security-envelope",
    });
  }

  if (!fileNode.part.source) {
    return createEmptyContent({
      message: "This MIME part is missing a preview source.",
      node: fileNode,
      reason: "missing-source",
    });
  }

  return {
    kind: "file",
    node: fileNode,
    file: {
      category: categoryForMimeNode(fileNode),
      source: resolveEmailPreviewSource(fileNode, inlineResourceUrls),
    },
  };
}

export function deriveEmailInlineResourceScope(
  rootNode: MimePartNode,
  selectedNode: MimePartNode,
): EmailInlineResourceScope {
  if (isMessageNode(selectedNode)) {
    return {
      root: selectedNode,
      resources: [],
    };
  }

  const displayNode = selectDefaultPreviewNode(selectedNode, {
    stopAtNestedMessages: true,
  });
  const root = displayNode
    ? getInlineResourceScope(rootNode, displayNode)
    : selectedNode;

  return {
    root,
    resources: collectInlineResourceParts(root),
  };
}

export function collectInlineResourceParts(
  node: MimePartNode,
): readonly EmailInlineResource[] {
  const resources: EmailInlineResource[] = [];

  walkMimeTree(node, (current) => {
    if (!isInlineResourceNode(current) || !current.part.source) return;

    const keys = inlineResourceKeysForNode(current);
    if (keys.length > 0) resources.push({ node: current, keys });
  });

  return resources;
}

export function getInlineResourceScope(
  rootNode: MimePartNode,
  node: MimePartNode,
): MimePartNode {
  let current: MimePartNode | null = node;
  while (current) {
    if (isRelatedMultipart(current.facts.mimeType)) return current;
    current = getParentMimeNode(rootNode, current);
  }
  return node;
}

export function normalizeContentId(contentId: string | null | undefined) {
  const trimmed = contentId?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, "").toLowerCase();
}

export function normalizeContentLocation(
  contentLocation: string | null | undefined,
) {
  const trimmed = contentLocation?.trim();
  if (!trimmed) return null;
  return normalizeRelativeReference(trimmed);
}

export function inlineResourceKeyToString(key: EmailInlineResourceKey) {
  return `${key.kind}:${key.value}`;
}

export function replaceInlineResourceUrls(
  html: string,
  inlineUrls: ReadonlyMap<string, string>,
) {
  return replaceContentLocationUrls(
    replaceCidUrls(html, inlineUrls),
    inlineUrls,
  );
}

export function replaceCidUrls(
  html: string,
  inlineUrls: ReadonlyMap<string, string>,
) {
  return html.replace(
    /\bcid:(?:<([^>"'\s)]+)>|([^"'\s>)]+))/gi,
    (match, bracketedContentId, plainContentId) => {
      const rawContentId = bracketedContentId ?? plainContentId;
      const cid = normalizeContentId(decodeCid(rawContentId));
      if (!cid) return match;
      return (
        inlineUrls.get(
          inlineResourceKeyToString({ kind: "content-id", value: cid }),
        ) ?? MISSING_EMAIL_INLINE_RESOURCE_URL
      );
    },
  );
}

export function mimePartLabel(part: MimePart): string {
  const fileName = part.fileName?.trim();
  if (fileName) return fileName;
  if (isMultipartMime(part.mimeType)) return multipartLabel(part.mimeType);
  if (isMessageMime(part.mimeType)) return "Message";
  if (normalizedMimeType(part.mimeType) === "text/html") return "HTML body";
  if (normalizedMimeType(part.mimeType) === "text/plain") return "Text body";
  if (isSecurityEnvelopeMime(part.mimeType))
    return securityEnvelopeLabel(part.mimeType);
  return part.mimeType || "MIME part";
}

export function mimePartDescription(part: MimePart): string {
  const pieces = [
    part.mimeType || null,
    part.disposition?.trim() || null,
    part.contentId ? `cid:${normalizeContentId(part.contentId)}` : null,
    contentLocationForPart(part)
      ? `location:${contentLocationForPart(part)}`
      : null,
  ].filter(Boolean);
  return pieces.join(" · ");
}

export function categoryForMimePart(part: MimePart): FileCategory | undefined {
  const mime = normalizedMimeType(part.mimeType);
  if (mime === "text/calendar" || mime === "application/ics") return "text";
  if (mime === "message/delivery-status") return "text";
  if (mime === "message/disposition-notification") return "text";

  const fileName = part.fileName?.trim() || part.source?.fileName || mime;
  const sourceMimeType = part.source?.mimeType || part.mimeType || undefined;
  const category = detectCategory(fileName, sourceMimeType);

  return category === "unsupported" ? undefined : category;
}

export function categoryForMimeNode(
  node: MimePartNode,
): FileCategory | undefined {
  const policy = node.facts.preview;
  if (policy.kind === "preview" || policy.kind === "attachment") {
    return policy.category;
  }
  return categoryForMimePart(node.part);
}

export function messageIdentity(message: MimeMessage): string {
  return message.id ?? message.root.id;
}

export function pathsEqual(left: MimePartPath, right: MimePartPath) {
  if (left.length !== right.length) return false;
  return left.every((part, index) => part === right[index]);
}

export function isMultipartNode(node: MimePartNode) {
  return node.facts.kind === "multipart";
}

export function isMessageNode(node: MimePartNode) {
  return node.facts.kind === "message";
}

export function isRenderableNode(node: MimePartNode) {
  return node.facts.isRenderable;
}

export function isAttachmentNode(node: MimePartNode) {
  return node.facts.kind === "attachment";
}

export function isInlineResourceNode(node: MimePartNode) {
  return node.facts.kind === "inline-resource";
}

function buildMimeNode({
  part,
  parentPath,
  depth,
  pathPart,
}: {
  part: MimePart;
  parentPath: MimePartPath | null;
  depth: number;
  pathPart: string;
}): MimePartNode {
  const path = [...(parentPath ?? []), pathPart];
  const facts = deriveMimePartFacts(part);
  const childIds = new Map<string, number>();

  return {
    depth,
    facts,
    parentPath,
    part,
    path,
    children: (part.children ?? []).map((child) => {
      const childPathPart = uniqueChildPathPart(child.id, childIds);
      return buildMimeNode({
        part: child,
        parentPath: path,
        depth: depth + 1,
        pathPart: childPathPart,
      });
    }),
  };
}

function deriveMimePartFacts(part: MimePart): MimePartFacts {
  const mimeType = normalizedMimeType(part.mimeType);
  const disposition = part.disposition?.toLowerCase().trim() ?? null;
  const contentId = normalizeContentId(part.contentId);
  const contentLocation = contentLocationForPart(part);
  const isRenderable = Boolean(part.source);
  const kind = deriveMimePartKind({
    contentId,
    contentLocation,
    disposition,
    isRenderable,
    mimeType,
    part,
  });

  return {
    contentId,
    contentLocation,
    disposition,
    isRenderable,
    kind,
    mimeType,
    preview: deriveMimePreviewPolicy({ isRenderable, kind, mimeType, part }),
  };
}

function deriveMimePartKind({
  contentId,
  contentLocation,
  disposition,
  isRenderable,
  mimeType,
  part,
}: {
  contentId: string | null;
  contentLocation: string | null;
  disposition: string | null;
  isRenderable: boolean;
  mimeType: string;
  part: MimePart;
}): MimePartKind {
  if (isMultipartMime(mimeType)) return "multipart";
  if (isMessageMime(mimeType)) return "message";
  if (
    isRenderable &&
    disposition !== "attachment" &&
    !isBodyMime(mimeType) &&
    Boolean(contentId || contentLocation)
  ) {
    return "inline-resource";
  }
  if (disposition === "attachment") return "attachment";
  if (isRenderable && isBodyMime(mimeType)) return "body";
  if (isRenderable && part.fileName && disposition === "inline") {
    return "attachment";
  }
  if (isRenderable && !isSecurityEnvelopeMime(mimeType)) return "attachment";
  return "unsupported";
}

function deriveMimePreviewPolicy({
  isRenderable,
  kind,
  mimeType,
  part,
}: {
  isRenderable: boolean;
  kind: MimePartKind;
  mimeType: string;
  part: MimePart;
}): MimePreviewPolicy {
  if (isSecurityEnvelopeMime(mimeType)) {
    return {
      kind: "security-envelope",
      label: securityEnvelopeLabel(mimeType),
    };
  }
  if (kind === "message") return { kind: "nested-message" };
  if (kind === "attachment") {
    return { kind: "attachment", category: categoryForMimePart(part) };
  }
  if (isRenderable && kind === "body") {
    return { kind: "preview", category: categoryForMimePart(part) };
  }
  if (isDeliveryStatusMime(mimeType)) {
    return { kind: "unsupported", reason: "unsupported-part" };
  }
  return {
    kind: "unsupported",
    reason: isRenderable ? "unsupported-part" : "missing-source",
  };
}

function uniqueChildPathPart(id: string, siblingCounts: Map<string, number>) {
  const base = normalizePathPart(id, siblingCounts.size);
  const count = siblingCounts.get(base) ?? 0;
  siblingCounts.set(base, count + 1);
  return count === 0 ? base : `${base}~${count + 1}`;
}

function normalizePathPart(id: string, fallbackIndex: number) {
  const trimmed = id.trim();
  return trimmed || `part-${fallbackIndex + 1}`;
}

function selectMimeScopeBodyNode(
  root: MimePartNode,
  policy: EmailBodySelectionPolicy = DEFAULT_EMAIL_BODY_SELECTION_POLICY,
): MimePartNode | null {
  const candidates: MimePartNode[] = [];

  walkCurrentMessageNodes(root, (node) => {
    if (!isRenderableNode(node)) return;
    if (!policy.includeInlineBodyParts && isInlineResourceNode(node)) return;
    if (!policy.includeAttachments && isAttachmentNode(node)) return;
    if (isInlineResourceNode(node) || isMessageNode(node)) return;
    candidates.push(node);
  });

  for (const mimeType of policy.preferredMimeTypes) {
    const match = candidates.find((node) => node.facts.mimeType === mimeType);
    if (match) return match;
  }

  return (
    candidates[0] ??
    selectDefaultPreviewNode(root, { stopAtNestedMessages: true })
  );
}

function selectDefaultPreviewNode(
  node: MimePartNode,
  {
    stopAtNestedMessages,
  }: {
    stopAtNestedMessages: boolean;
  },
): MimePartNode | null {
  if (isMessageNode(node) && stopAtNestedMessages) return null;
  if (isPreviewLeafNode(node)) return node;
  if (!node.children.length) return null;

  if (
    node.facts.mimeType === "multipart/alternative" ||
    node.facts.mimeType === "multipart/related"
  ) {
    return (
      findFirstRenderableOfMime(node, "text/html", { stopAtNestedMessages }) ??
      findFirstRenderableOfMime(node, "text/plain", {
        stopAtNestedMessages,
      }) ??
      findFirstRenderableChild(node, { stopAtNestedMessages })
    );
  }

  return findFirstRenderableChild(node, { stopAtNestedMessages });
}

function findFirstRenderableOfMime(
  node: MimePartNode,
  mimeType: string,
  options: { stopAtNestedMessages: boolean },
): MimePartNode | null {
  for (const child of node.children) {
    if (isMessageNode(child) && options.stopAtNestedMessages) continue;
    if (
      child.facts.mimeType === mimeType &&
      isRenderableNode(child) &&
      !isInlineResourceNode(child)
    ) {
      return child;
    }
    const match = findFirstRenderableOfMime(child, mimeType, options);
    if (match) return match;
  }
  return null;
}

function findFirstRenderableChild(
  node: MimePartNode,
  options: { stopAtNestedMessages: boolean },
): MimePartNode | null {
  for (const child of node.children) {
    const match = selectDefaultPreviewNode(child, options);
    if (match) return match;
  }
  return null;
}

function isPreviewLeafNode(node: MimePartNode) {
  if (!isRenderableNode(node) || isInlineResourceNode(node)) return false;
  return (
    node.facts.preview.kind === "preview" ||
    node.facts.preview.kind === "attachment"
  );
}

function collectCurrentMessageNodes(root: MimePartNode) {
  const nodes: MimePartNode[] = [];
  walkCurrentMessageNodes(root, (node) => nodes.push(node));
  return nodes;
}

function walkCurrentMessageNodes(
  root: MimePartNode,
  visit: (node: MimePartNode) => void,
) {
  function walk(node: MimePartNode) {
    visit(node);
    if (!pathsEqual(node.path, root.path) && isMessageNode(node)) return;
    for (const child of node.children) walk(child);
  }

  walk(root);
}

function walkMimeTree(node: MimePartNode, visit: (node: MimePartNode) => void) {
  visit(node);
  for (const child of node.children) walkMimeTree(child, visit);
}

function isEmailAttachmentSidebarNode(
  node: MimePartNode,
  bodyNode: MimePartNode | null,
) {
  if (node === bodyNode) return false;
  if (isMultipartNode(node) || isInlineResourceNode(node)) return false;
  if (isMessageNode(node) || isAttachmentNode(node)) return true;
  return isRenderableNode(node) && !isBodyMime(node.facts.mimeType);
}

function createSidebarItem({
  inlineResourceUrls,
  kind,
  node,
  selectedPath,
}: {
  inlineResourceUrls: ReadonlyMap<string, string>;
  kind: "body" | "attachment";
  node: MimePartNode;
  selectedPath: MimePartPath;
}): EmailSidebarItem {
  const common = {
    id: node.path.join("/"),
    node,
    path: node.path,
    description: describeEmailSidebarNode(node),
    thumbnail: deriveEmailSidebarThumbnail(node, inlineResourceUrls),
    isSelected: pathsEqual(node.path, selectedPath),
  };

  if (kind === "body") {
    return {
      ...common,
      kind,
      title: "Body",
    };
  }

  return {
    ...common,
    kind,
    title: mimePartLabel(node.part),
  };
}

function deriveEmailSidebarThumbnail(
  node: MimePartNode,
  inlineResourceUrls: ReadonlyMap<string, string>,
): EmailSidebarThumbnailModel {
  const thumbnailNode = isMessageNode(node)
    ? selectMimeScopeBodyNode(node)
    : node;

  if (thumbnailNode?.part.source && !isInlineResourceNode(thumbnailNode)) {
    return {
      kind: "file",
      source: resolveEmailPreviewSource(thumbnailNode, inlineResourceUrls),
      aspectRatio: 1,
    };
  }

  if (isMessageNode(node)) return { kind: "icon", icon: "mail" };
  if (isMultipartNode(node)) return { kind: "icon", icon: "layers" };
  if (isAttachmentNode(node)) return { kind: "icon", icon: "paperclip" };
  return { kind: "icon", icon: "file" };
}

function describeEmailSidebarNode(node: MimePartNode) {
  if (node.part.size != null) {
    return `${node.part.mimeType} · ${formatFileSize(node.part.size)}`;
  }
  if (isInlineResourceNode(node)) return `${node.part.mimeType} · inline`;
  if (isAttachmentNode(node)) return `${node.part.mimeType} · attachment`;
  return node.part.mimeType;
}

function deriveNestedEmailMessage(
  message: EmailViewerMessage,
  node: MimePartNode,
): EmailViewerMessage {
  return {
    id: `${messageIdentity(message)}:${node.path.join("/")}`,
    headers: node.part.headers,
    subject: headerValue(node.part.headers, "subject"),
    from: headerValue(node.part.headers, "from"),
    to: headerValue(node.part.headers, "to"),
    cc: headerValue(node.part.headers, "cc"),
    bcc: headerValue(node.part.headers, "bcc"),
    sentAt: headerValue(node.part.headers, "date"),
    root: node.part,
  };
}

function resolveEmailPreviewSource(
  node: MimePartNode,
  inlineResourceUrls: ReadonlyMap<string, string>,
): ViewerSource {
  const source = node.part.source;
  if (source?.kind === "text" && isHtmlMime(node.part)) {
    const text = replaceInlineResourceUrls(source.text, inlineResourceUrls);
    if (text === source.text) return source;

    return {
      ...source,
      identityKey: [
        source.identityKey ?? node.path.join("/"),
        "email-inline",
        inlineResourceIdentity(inlineResourceUrls),
      ].join(":"),
      text,
    };
  }

  return source!;
}

function createEmptyContent({
  message,
  node,
  reason,
}: {
  message: string;
  node: MimePartNode;
  reason: EmailContentEmptyReason;
}): EmailContentModel {
  return {
    kind: "empty",
    message,
    node,
    reason,
  };
}

function normalizeAddressList(
  value: string | readonly string[] | null | undefined,
): readonly EmailAddress[] {
  if (typeof value === "string") return parseAddressList(value);
  if (!value) return [];
  return value.flatMap((address) => parseAddressList(address));
}

function parseAddressList(value: string): readonly EmailAddress[] {
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((address) => parseEmailAddress(address))
    .filter((address) => address.display.length > 0);
}

function parseEmailAddress(value: string): EmailAddress {
  const display = value.trim();
  const match = display.match(/^(.*?)<([^>]+)>$/);
  if (!match) {
    return {
      name: null,
      address: display.includes("@") ? display : null,
      display,
    };
  }

  const name = cleanAddressName(match[1]);
  const address = match[2]?.trim() || null;
  return {
    name,
    address,
    display,
  };
}

function cleanAddressName(value: string | undefined) {
  const trimmed = value?.trim().replace(/^"|"$/g, "") ?? "";
  return trimmed || null;
}

function formatSentAt(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function headerValue(
  headers: readonly { name: string; value: string }[] | undefined,
  name: string,
) {
  return (
    headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function contentLocationForPart(part: MimePart) {
  return normalizeContentLocation(
    part.contentLocation ?? headerValue(part.headers, "content-location"),
  );
}

function inlineResourceKeysForNode(
  node: MimePartNode,
): readonly EmailInlineResourceKey[] {
  const keys: EmailInlineResourceKey[] = [];
  if (node.facts.contentId) {
    keys.push({ kind: "content-id", value: node.facts.contentId });
  }
  if (node.facts.contentLocation) {
    keys.push({ kind: "content-location", value: node.facts.contentLocation });
  }
  return keys;
}

function replaceContentLocationUrls(
  html: string,
  inlineUrls: ReadonlyMap<string, string>,
) {
  return html.replace(
    /\b(src|href)=(["'])([^"']+)\2/gi,
    (match, attribute, quote, rawUrl) => {
      if (!isRelativeInlineReference(rawUrl)) return match;

      const normalized = normalizeRelativeReference(rawUrl);
      const url = inlineUrls.get(
        inlineResourceKeyToString({
          kind: "content-location",
          value: normalized,
        }),
      );
      return url ? `${attribute}=${quote}${url}${quote}` : match;
    },
  );
}

function isRelativeInlineReference(value: string) {
  const lower = value.trim().toLowerCase();
  if (!lower) return false;
  if (lower.startsWith("#")) return false;
  if (lower.startsWith("/")) return false;
  if (lower.startsWith("cid:")) return false;
  if (lower.startsWith("data:")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(lower);
}

function normalizeRelativeReference(value: string) {
  return value
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function getParentMimeNode(rootNode: MimePartNode, node: MimePartNode) {
  return node.parentPath ? findMimeNodeByPath(rootNode, node.parentPath) : null;
}

function inlineResourceIdentity(
  inlineResourceUrls: ReadonlyMap<string, string>,
) {
  return Array.from(inlineResourceUrls.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, url]) => `${key}=${url}`)
    .join("|");
}

function decodeCid(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHtmlMime(part: MimePart) {
  return normalizedMimeType(part.mimeType) === "text/html";
}

function isBodyMime(mimeType: string) {
  return (
    mimeType === "text/html" ||
    mimeType === "text/plain" ||
    mimeType === "text/markdown"
  );
}

function isMultipartMime(mimeType: string) {
  return normalizedMimeType(mimeType).startsWith("multipart/");
}

function isRelatedMultipart(mimeType: string) {
  return normalizedMimeType(mimeType) === "multipart/related";
}

function isMessageMime(mimeType: string) {
  const mime = normalizedMimeType(mimeType);
  return mime === "message/rfc822" || mime === "message/global";
}

function isDeliveryStatusMime(mimeType: string) {
  const mime = normalizedMimeType(mimeType);
  return (
    mime === "message/delivery-status" ||
    mime === "message/disposition-notification"
  );
}

function isSecurityEnvelopeMime(mimeType: string) {
  const mime = normalizedMimeType(mimeType);
  return (
    mime === "application/pkcs7-mime" ||
    mime === "application/pgp-encrypted" ||
    mime === "multipart/encrypted"
  );
}

function securityEnvelopeLabel(mimeType: string) {
  const mime = normalizedMimeType(mimeType);
  if (mime.includes("encrypted")) return "Encrypted message";
  if (mime.includes("pkcs7")) return "Signed or encrypted message";
  return "Security envelope";
}

function normalizedMimeType(mimeType: string) {
  return mimeType.toLowerCase().split(";")[0].trim();
}

function multipartLabel(mimeType: string) {
  const subtype = normalizedMimeType(mimeType).split("/")[1];
  if (!subtype) return "Multipart";
  return `Multipart ${subtype}`;
}

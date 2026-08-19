import type { ReactNode } from "react";

import type { FileCategory, ViewerSource } from "@/lib/viewer-source";

export type MimePartDisposition = "inline" | "attachment" | string;

export type MimeHeader = {
  name: string;
  value: string;
};

export type MimePart = {
  id: string;
  mimeType: string;
  headers?: readonly MimeHeader[];
  fileName?: string | null;
  disposition?: MimePartDisposition | null;
  contentId?: string | null;
  contentLocation?: string | null;
  size?: number | null;
  source?: ViewerSource;
  children?: readonly MimePart[];
};

export type MimeMessage = {
  id?: string;
  headers?: readonly MimeHeader[];
  subject?: string | null;
  from?: string | readonly string[] | null;
  to?: string | readonly string[] | null;
  cc?: string | readonly string[] | null;
  bcc?: string | readonly string[] | null;
  sentAt?: string | Date | null;
  root: MimePart;
};

export type MimePartPath = readonly string[];

export type MimePartKind =
  | "multipart"
  | "message"
  | "body"
  | "attachment"
  | "inline-resource"
  | "unsupported";

export type MimePreviewPolicy =
  | { kind: "preview"; category?: FileCategory }
  | { kind: "nested-message" }
  | { kind: "attachment"; category?: FileCategory }
  | { kind: "security-envelope"; label: string }
  | { kind: "unsupported"; reason: EmailContentEmptyReason };

export type MimePartFacts = {
  kind: MimePartKind;
  mimeType: string;
  disposition: string | null;
  contentId: string | null;
  contentLocation: string | null;
  isRenderable: boolean;
  preview: MimePreviewPolicy;
};

export type MimePartNode = {
  part: MimePart;
  path: MimePartPath;
  parentPath: MimePartPath | null;
  depth: number;
  children: readonly MimePartNode[];
  facts: MimePartFacts;
};

export type EmailViewerMessage = MimeMessage;

export type MimeMessageScope = {
  message: EmailViewerMessage;
  root: MimePartNode;
  path: MimePartPath;
  descendants: readonly MimePartNode[];
};

export type EmailAddress = {
  name: string | null;
  address: string | null;
  display: string;
};

export type EmailHeaderModel = {
  subject: string;
  from: readonly EmailAddress[];
  to: readonly EmailAddress[];
  cc: readonly EmailAddress[];
  bcc: readonly EmailAddress[];
  sentAt: string | null;
};

export type EmailSidebarThumbnailModel =
  | { kind: "file"; source: ViewerSource; aspectRatio: number }
  | { kind: "icon"; icon: "file" | "layers" | "mail" | "paperclip" };

export type EmailSidebarItemBase = {
  id: string;
  node: MimePartNode;
  path: MimePartPath;
  description: string;
  thumbnail: EmailSidebarThumbnailModel;
  isSelected: boolean;
};

export type EmailBodySidebarItem = EmailSidebarItemBase & {
  kind: "body";
  title: "Body";
};

export type EmailAttachmentSidebarItem = EmailSidebarItemBase & {
  kind: "attachment";
  title: string;
};

export type EmailSidebarItem =
  | EmailBodySidebarItem
  | EmailAttachmentSidebarItem;

export type EmailSidebarSection = {
  id: "body" | "attachments";
  title: string;
  items: readonly EmailSidebarItem[];
  emptyLabel?: string;
};

export type EmailSidebarModel = {
  bodyCount: number;
  attachmentCount: number;
  sections: readonly EmailSidebarSection[];
};

export type EmailFilePayload = {
  source: ViewerSource;
  category?: FileCategory;
};

export type EmailContentFile = {
  kind: "file";
  node: MimePartNode;
  file: EmailFilePayload;
};

export type EmailContentNestedMessage = {
  kind: "nested-message";
  node: MimePartNode;
  message: EmailViewerMessage;
  maxNestedMessageDepth: number;
  nestedMessageDepth: number;
};

export type EmailContentEmptyReason =
  | "no-previewable-body"
  | "unsupported-part"
  | "missing-source"
  | "nested-depth-exceeded"
  | "security-envelope";

export type EmailContentEmpty = {
  kind: "empty";
  reason: EmailContentEmptyReason;
  node: MimePartNode;
  message: string;
};

export type EmailContentModel =
  | EmailContentFile
  | EmailContentNestedMessage
  | EmailContentEmpty;

export type EmailInlineResourceKey =
  | { kind: "content-id"; value: string }
  | { kind: "content-location"; value: string };

export type EmailInlineResource = {
  node: MimePartNode;
  keys: readonly EmailInlineResourceKey[];
};

export type EmailInlineResourceScope = {
  root: MimePartNode;
  resources: readonly EmailInlineResource[];
};

export type EmailBodySelectionPolicy = {
  preferredMimeTypes: readonly string[];
  includeInlineBodyParts: boolean;
  includeAttachments: boolean;
};

export type EmailViewerModel = {
  message: EmailViewerMessage;
  rootNode: MimePartNode;
  scope: MimeMessageScope;
  selectedPath: MimePartPath;
  selectedNode: MimePartNode;
  header: EmailHeaderModel;
  sidebar: EmailSidebarModel;
  content: EmailContentModel;
};

export type EmailViewerProps = {
  message: EmailViewerMessage;
  selectedPath?: MimePartPath | null;
  defaultSelectedPath?: MimePartPath;
  onSelectedPathChange?: (path: MimePartPath, node: MimePartNode) => void;
  maxNestedMessageDepth?: number;
  mode?: "auto" | "inline" | "overlay";
  className?: string;
};

export type EmailViewerProviderProps = Omit<
  EmailViewerProps,
  "className" | "mode"
> & {
  children: ReactNode;
};

"use client";

import * as React from "react";
import { FileText, Layers3, Mail, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";

import { useEmailInlineResourceUrls } from "./email-viewer-inline-resources";
import {
  buildMimeTree,
  deriveEmailInlineResourceScope,
  deriveEmailViewerModel,
  findMimeNodeByPath,
  getDefaultMimeSelectionPath,
} from "./email-viewer-model";
import type {
  EmailAddress,
  EmailContentModel,
  EmailHeaderModel,
  EmailSidebarItem,
  EmailSidebarModel,
  EmailViewerMessage,
  EmailViewerModel,
  EmailViewerProps,
  EmailViewerProviderProps,
  MimePartNode,
  MimePartPath,
} from "./email-viewer-types";
import { FileThumbnail } from "./file-thumbnail";
import { FileViewerPreview } from "./file-viewer";
import {
  ViewerBody,
  ViewerHeader,
  ViewerRoot,
  ViewerSidebar,
  ViewerSidebarTrigger,
  ViewerSurface,
} from "./viewer";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export type {
  EmailAddress,
  EmailAttachmentSidebarItem,
  EmailBodySelectionPolicy,
  EmailBodySidebarItem,
  EmailContentEmpty,
  EmailContentEmptyReason,
  EmailContentFile,
  EmailContentModel,
  EmailContentNestedMessage,
  EmailFilePayload,
  EmailHeaderModel,
  EmailInlineResource,
  EmailInlineResourceKey,
  EmailInlineResourceScope,
  EmailSidebarItemBase,
  EmailSidebarItem,
  EmailSidebarModel,
  EmailSidebarSection,
  EmailSidebarThumbnailModel,
  EmailViewerMessage,
  EmailViewerModel,
  EmailViewerProviderProps,
  EmailViewerProps,
  MimeHeader,
  MimeMessage,
  MimeMessageScope,
  MimePart,
  MimePartDisposition,
  MimePartFacts,
  MimePartKind,
  MimePartNode,
  MimePartPath,
  MimePreviewPolicy,
} from "./email-viewer-types";

export {
  EmailResourceContent,
  type EmailResourceContentProps,
} from "./email-viewer-content";

export { parseEmlMessage, type ParseEmlOptions } from "./email-viewer-eml";

export {
  buildMimeTree,
  categoryForMimeNode,
  createMimeMessageScope,
  DEFAULT_EMAIL_BODY_SELECTION_POLICY,
  deriveEmailContentModel,
  deriveEmailHeaderModel,
  deriveEmailInlineResourceScope,
  deriveEmailSidebarModel,
  deriveEmailViewerModel,
  findMimeNodeByPath,
  getDefaultMimeSelectionPath,
  getInlineResourceScope,
  inlineResourceKeyToString,
  isAttachmentNode,
  isInlineResourceNode,
  isMessageNode,
  isMultipartNode,
  isRenderableNode,
  normalizeContentId,
  normalizeContentLocation,
  pathsEqual,
  replaceCidUrls,
  replaceInlineResourceUrls,
} from "./email-viewer-model";

const DEFAULT_MAX_NESTED_MESSAGE_DEPTH = 8;

type EmailViewerContextValue = {
  model: EmailViewerModel;
  selectPart: (node: MimePartNode) => void;
};

type EmailViewerProviderInternalProps = EmailViewerProviderProps & {
  nestedMessageDepth?: number;
};

type EmailViewerInternalProps = EmailViewerProps & {
  nestedMessageDepth?: number;
};

type EmailViewerLayoutProps = Pick<
  EmailViewerInternalProps,
  "className" | "mode"
>;

const EmailViewerContext = React.createContext<EmailViewerContextValue | null>(
  null,
);

function useEmailViewerContext() {
  const context = React.useContext(EmailViewerContext);
  if (!context) {
    throw new Error("EmailViewerProvider context is missing.");
  }
  return context;
}

function useEmailViewerHeaderState(): EmailHeaderModel {
  return useEmailViewerContext().model.header;
}

function useEmailViewerPartsSidebarState(): {
  sidebar: EmailSidebarModel;
  selectPart: (node: MimePartNode) => void;
} {
  const { model, selectPart } = useEmailViewerContext();

  return {
    sidebar: model.sidebar,
    selectPart,
  };
}

function useEmailViewerContentState(): EmailContentModel {
  return useEmailViewerContext().model.content;
}

export function EmailViewerProvider(props: EmailViewerProviderProps) {
  return <EmailViewerProviderInternal {...props} nestedMessageDepth={0} />;
}

function EmailViewerProviderInternal({
  message,
  selectedPath,
  defaultSelectedPath,
  onSelectedPathChange,
  maxNestedMessageDepth = DEFAULT_MAX_NESTED_MESSAGE_DEPTH,
  nestedMessageDepth = 0,
  children,
}: EmailViewerProviderInternalProps) {
  const rootNode = React.useMemo(
    () => buildMimeTree(message.root),
    [message.root],
  );
  const defaultPath = React.useMemo(
    () =>
      defaultSelectedPath && findMimeNodeByPath(rootNode, defaultSelectedPath)
        ? defaultSelectedPath
        : getDefaultMimeSelectionPath(rootNode),
    [defaultSelectedPath, rootNode],
  );
  const [internalSelectedPath, setInternalSelectedPath] =
    React.useState<MimePartPath>(defaultPath);
  const controlled = selectedPath !== undefined;
  const activePath = controlled
    ? (selectedPath ?? defaultPath)
    : internalSelectedPath;
  const selectedNode =
    findMimeNodeByPath(rootNode, activePath) ??
    findMimeNodeByPath(rootNode, defaultPath) ??
    rootNode;
  const inlineResourceScope = React.useMemo(
    () => deriveEmailInlineResourceScope(rootNode, selectedNode),
    [rootNode, selectedNode],
  );
  const inlineResourceUrls = useEmailInlineResourceUrls(inlineResourceScope);

  useKeyedMountEffect(
    joinEffectKey([controlled, defaultPath, internalSelectedPath, rootNode]),
    () => {
      if (controlled) return;
      if (findMimeNodeByPath(rootNode, internalSelectedPath)) return;
      setInternalSelectedPath(defaultPath);
    },
  );

  const selectPart = React.useCallback(
    (node: MimePartNode) => {
      if (!controlled) setInternalSelectedPath(node.path);
      onSelectedPathChange?.(node.path, node);
    },
    [controlled, onSelectedPathChange],
  );
  const model = React.useMemo(
    () =>
      deriveEmailViewerModel({
        inlineResourceUrls,
        maxNestedMessageDepth,
        message,
        nestedMessageDepth,
        rootNode,
        selectedNode,
      }),
    [
      inlineResourceUrls,
      maxNestedMessageDepth,
      message,
      nestedMessageDepth,
      rootNode,
      selectedNode,
    ],
  );
  const value = React.useMemo<EmailViewerContextValue>(
    () => ({ model, selectPart }),
    [model, selectPart],
  );

  return (
    <EmailViewerContext.Provider value={value}>
      {children}
    </EmailViewerContext.Provider>
  );
}

export function EmailViewer(props: EmailViewerProps) {
  return <EmailViewerInternal {...props} nestedMessageDepth={0} />;
}

function EmailViewerInternal({
  message,
  selectedPath,
  defaultSelectedPath,
  onSelectedPathChange,
  maxNestedMessageDepth,
  mode,
  nestedMessageDepth = 0,
  className,
}: EmailViewerInternalProps) {
  if (nestedMessageDepth === 0) {
    return (
      <EmailViewerProvider
        message={message}
        selectedPath={selectedPath}
        defaultSelectedPath={defaultSelectedPath}
        onSelectedPathChange={onSelectedPathChange}
        maxNestedMessageDepth={maxNestedMessageDepth}
      >
        <EmailViewerLayout className={className} mode={mode} />
      </EmailViewerProvider>
    );
  }

  return (
    <EmailViewerProviderInternal
      message={message}
      selectedPath={selectedPath}
      defaultSelectedPath={defaultSelectedPath}
      onSelectedPathChange={onSelectedPathChange}
      maxNestedMessageDepth={maxNestedMessageDepth}
      nestedMessageDepth={nestedMessageDepth}
    >
      <EmailViewerLayout className={className} mode={mode} />
    </EmailViewerProviderInternal>
  );
}

function EmailViewerLayout({ className, mode }: EmailViewerLayoutProps) {
  return (
    <div data-slot="email-viewer" className={cn("min-h-0", className)}>
      <ViewerRoot
        defaultOpen
        mode={mode}
        sidebarSide="right"
        className="h-full"
      >
        <EmailViewerHeader />
        <ViewerBody className="flex-col md:flex-row">
          <ViewerSurface className="min-h-[26rem] md:min-h-0">
            <EmailViewerContent />
          </ViewerSurface>
          <ViewerSidebar
            aria-label="Email parts"
            width="19rem"
            className="border-t md:border-t-0 md:border-l"
          >
            <EmailViewerPartsSidebar />
          </ViewerSidebar>
        </ViewerBody>
      </ViewerRoot>
    </div>
  );
}

export function EmailViewerHeader({
  trailing = <ViewerSidebarTrigger className="-mr-1" />,
}: {
  trailing?: React.ReactNode;
}) {
  return (
    <MimeMessageHeader
      header={useEmailViewerHeaderState()}
      trailing={trailing}
    />
  );
}

export function EmailViewerPartsSidebar() {
  const { sidebar, selectPart } = useEmailViewerPartsSidebarState();

  return <MimePartSidebar sidebar={sidebar} onSelectPart={selectPart} />;
}

export function EmailViewerContent() {
  const content = useEmailViewerContentState();

  if (content.kind === "nested-message") {
    return (
      <EmailViewerInternal
        className="h-full"
        message={content.message}
        maxNestedMessageDepth={content.maxNestedMessageDepth}
        nestedMessageDepth={content.nestedMessageDepth}
      />
    );
  }

  if (content.kind === "empty") {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center px-6 text-center text-sm">
        {content.message}
      </div>
    );
  }

  return (
    <FileViewerPreview
      key={content.node.path.join("/")}
      source={content.file.source}
      category={content.file.category}
      className="size-full min-h-0"
    />
  );
}

function MimeMessageHeader({
  header,
  trailing,
}: {
  header: EmailHeaderModel;
  trailing?: React.ReactNode;
}) {
  const from = formatEmailAddresses(header.from);
  const to = formatEmailAddresses(header.to);

  return (
    <ViewerHeader className="px-3 py-2">
      <div
        data-slot="email-message-header"
        className="flex min-h-0 flex-col gap-1"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Mail className="text-muted-foreground size-4 flex-shrink-0" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {header.subject}
          </h2>
          {trailing}
        </div>
        <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-3 gap-y-1 pl-6 text-xs">
          {from ? <span className="min-w-0 truncate">From {from}</span> : null}
          {to ? <span className="min-w-0 truncate">To {to}</span> : null}
          {header.sentAt ? (
            <span className="tabular-nums">{header.sentAt}</span>
          ) : null}
        </div>
      </div>
    </ViewerHeader>
  );
}

function MimePartSidebar({
  sidebar,
  onSelectPart,
  className,
}: {
  sidebar: EmailSidebarModel;
  onSelectPart: (node: MimePartNode) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="mime-part-sidebar"
      className={cn(
        "bg-background text-foreground flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <div className="flex-shrink-0 border-b px-3 py-2">
        <div className="flex h-6 items-center gap-2 text-xs font-medium">
          <Paperclip className="text-muted-foreground size-3.5" />
          <span>
            {sidebar.attachmentCount} attachment
            {sidebar.attachmentCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {sidebar.sections.map((section) => (
          <MimePartSidebarSection key={section.id} title={section.title}>
            {section.items.length === 0 ? (
              section.emptyLabel ? (
                <p className="text-muted-foreground px-2 py-3 text-xs">
                  {section.emptyLabel}
                </p>
              ) : null
            ) : (
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <MimePartSidebarItem
                    key={item.id}
                    item={item}
                    onSelectPart={onSelectPart}
                  />
                ))}
              </ul>
            )}
          </MimePartSidebarSection>
        ))}
      </div>
    </div>
  );
}

function formatEmailAddresses(addresses: readonly EmailAddress[]) {
  return addresses.map((address) => address.display).join(", ") || null;
}

function MimePartSidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();

  return (
    <section
      aria-labelledby={titleId}
      data-slot="mime-part-sidebar-section"
      className="min-w-0"
    >
      <h3
        id={titleId}
        className="text-muted-foreground flex h-8 shrink-0 items-center px-2 text-xs font-medium"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function MimePartSidebarItem({
  item,
  onSelectPart,
}: {
  item: EmailSidebarItem;
  onSelectPart: (node: MimePartNode) => void;
}) {
  return (
    <li data-slot="mime-part-sidebar-item">
      <button
        type="button"
        aria-current={item.isSelected ? "page" : undefined}
        aria-label={`${item.title} ${item.description}`}
        data-selected={item.isSelected ? "true" : "false"}
        className={cn(
          "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring active:bg-accent flex h-auto w-full items-center gap-3 overflow-hidden rounded-lg border p-2 text-left text-sm outline-hidden transition-colors focus-visible:ring-2",
          item.isSelected
            ? "border-border bg-accent text-accent-foreground"
            : "border-transparent",
        )}
        onClick={() => onSelectPart(item.node)}
      >
        <SidebarItemThumbnail item={item} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span
            className={cn(
              "truncate text-xs",
              item.isSelected
                ? "text-accent-foreground/80"
                : "text-muted-foreground",
            )}
          >
            {item.description}
          </span>
        </span>
      </button>
    </li>
  );
}

function SidebarItemThumbnail({ item }: { item: EmailSidebarItem }) {
  if (item.thumbnail.kind === "file") {
    return (
      <FileThumbnail
        source={item.thumbnail.source}
        presentation="decorative"
        thumbnailShape="square"
        thumbnailSize="md"
        className="flex-shrink-0"
      />
    );
  }

  return (
    <span
      className={cn(
        "bg-muted/60 flex size-12 flex-shrink-0 items-center justify-center rounded-md",
        item.isSelected ? "text-accent-foreground" : "text-muted-foreground",
      )}
    >
      <PartIcon icon={item.thumbnail.icon} className="size-4" />
    </span>
  );
}

function PartIcon({
  icon,
  className,
}: {
  icon: "file" | "layers" | "mail" | "paperclip";
  className?: string;
}) {
  if (icon === "layers") return <Layers3 className={className} aria-hidden />;
  if (icon === "mail") return <Mail className={className} aria-hidden />;
  if (icon === "paperclip") {
    return <Paperclip className={className} aria-hidden />;
  }
  return <FileText className={className} aria-hidden />;
}

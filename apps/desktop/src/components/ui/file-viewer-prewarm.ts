import {
  isProseTextDescriptor,
  type FileDescriptor,
  type FileCategory,
} from "./file-viewer-core";

export type FileViewerPrewarmTarget =
  | "pdf"
  | "docx"
  | "image"
  | "pptx"
  | "xlsx"
  | "markdown"
  | "email"
  | "text"
  | "code";

type FileViewerPrewarmStatus = "scheduled" | "running" | "complete";

type FileViewerIdleWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: Window["cancelIdleCallback"];
    requestIdleCallback?: Window["requestIdleCallback"];
  };

type FileViewerIdleTask =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

type FileViewerPrewarmRecord = {
  browserWindow: FileViewerIdleWindow;
  isCancelled: boolean;
  status: FileViewerPrewarmStatus;
  subscribers: number;
  task: FileViewerIdleTask | null;
};

const CATEGORY_PREWARM_TARGETS: Partial<
  Record<FileCategory, FileViewerPrewarmTarget>
> = {
  pdf: "pdf",
  docx: "docx",
  image: "image",
  pptx: "pptx",
  xlsx: "xlsx",
  markdown: "markdown",
  email: "email",
};

const PREWARM_LOADERS: Record<FileViewerPrewarmTarget, () => Promise<void>> = {
  pdf: () => import("@/components/ui/pdf-viewer").then(() => undefined),
  docx: () => import("@/components/ui/docx-viewer").then(() => undefined),
  image: () => import("@/components/ui/image-viewer").then(() => undefined),
  pptx: () =>
    import("@/components/ui/pptx-viewer").then((module) => {
      const preloadViewer = (module as { preloadPptxViewer?: () => void })
        .preloadPptxViewer;
      preloadViewer?.();
    }),
  xlsx: () => import("@/components/ui/xlsx-viewer").then(() => undefined),
  markdown: () =>
    import("@/components/ui/markdown-viewer").then(() => undefined),
  email: () => import("@/components/ui/email-viewer").then(() => undefined),
  text: () =>
    import("@/components/ui/text-viewer-chenglou").then(() => undefined),
  code: () => import("@/components/ui/code-viewer").then(() => undefined),
};

const prewarmRecords = new Map<
  FileViewerPrewarmTarget,
  FileViewerPrewarmRecord
>();

export function getFileViewerPrewarmTarget({
  descriptor,
  isRouteRenderable,
}: {
  descriptor: FileDescriptor;
  isRouteRenderable: boolean;
}): FileViewerPrewarmTarget | null {
  if (!isRouteRenderable) return null;
  if (descriptor.category === "text") {
    return isProseTextDescriptor(descriptor) ? "text" : "code";
  }
  return CATEGORY_PREWARM_TARGETS[descriptor.category] ?? null;
}

export function scheduleFileViewerRendererPrewarm(
  target: FileViewerPrewarmTarget,
): () => void {
  if (typeof window === "undefined") return noop;

  const existingRecord = prewarmRecords.get(target);
  if (existingRecord) {
    if (existingRecord.status !== "scheduled") return noop;
    existingRecord.subscribers += 1;
    return () => releaseScheduledPrewarm(target, existingRecord);
  }

  const browserWindow = window as FileViewerIdleWindow;
  const record: FileViewerPrewarmRecord = {
    browserWindow,
    isCancelled: false,
    status: "scheduled",
    subscribers: 1,
    task: null,
  };
  record.task = scheduleIdleTask(browserWindow, () => {
    if (record.isCancelled) return;
    record.status = "running";
    record.task = null;
    void PREWARM_LOADERS[target]()
      .then(() => {
        if (prewarmRecords.get(target) === record) {
          record.status = "complete";
        }
      })
      .catch(() => {
        if (prewarmRecords.get(target) === record) {
          prewarmRecords.delete(target);
        }
      });
  });
  prewarmRecords.set(target, record);

  return () => releaseScheduledPrewarm(target, record);
}

export function resetFileViewerRendererPrewarmForTests() {
  prewarmRecords.clear();
}

function releaseScheduledPrewarm(
  target: FileViewerPrewarmTarget,
  record: FileViewerPrewarmRecord,
) {
  if (prewarmRecords.get(target) !== record || record.status !== "scheduled") {
    return;
  }
  record.subscribers -= 1;
  if (record.subscribers > 0) return;

  record.isCancelled = true;
  if (record.task) cancelIdleTask(record.browserWindow, record.task);
  prewarmRecords.delete(target);
}

function scheduleIdleTask(
  browserWindow: FileViewerIdleWindow,
  callback: () => void,
): FileViewerIdleTask {
  if (browserWindow.requestIdleCallback) {
    return {
      kind: "idle",
      id: browserWindow.requestIdleCallback(callback, { timeout: 600 }),
    };
  }
  return { kind: "timeout", id: setTimeout(callback, 120) };
}

function cancelIdleTask(
  browserWindow: FileViewerIdleWindow,
  task: FileViewerIdleTask,
) {
  if (task.kind === "idle") {
    browserWindow.cancelIdleCallback?.(task.id);
    return;
  }
  clearTimeout(task.id);
}

function noop() {}

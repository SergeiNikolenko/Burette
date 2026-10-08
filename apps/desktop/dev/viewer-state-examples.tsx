import { useState } from "react";
import { FileViewerErrorState, FileViewerLoadingState, FileViewerEmptyState, FileViewerUnsupportedState } from "@/components/ui/file-viewer-state";
import { ViewerErrorState } from "@/components/ui/viewer-error";
import { ViewerControls } from "@/components/ui/viewer-controls";
import { PdfViewerFallback } from "@/components/ui/pdf-viewer-states";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ResourceError } from "@/lib/viewer-errors";

const error = new ResourceError({ kind: "fetch_failed", message: "Preview request failed" });
export function ViewerStateExamples() {
  const [state, setState] = useState("error");
  return <section aria-label="Document preview" className="flex w-full max-w-[600px] shrink-0 flex-col gap-3">
    <NativeSelect aria-label="Preview state" value={state} onChange={event => setState(event.target.value)}>
      <NativeSelectOption value="error">Unavailable document</NativeSelectOption>
      <NativeSelectOption value="source-error">File read failure</NativeSelectOption>
      <NativeSelectOption value="loading">Loading</NativeSelectOption>
      <NativeSelectOption value="skeleton">Loading document</NativeSelectOption>
      <NativeSelectOption value="empty">No selection</NativeSelectOption>
      <NativeSelectOption value="unsupported">Unsupported file</NativeSelectOption>
    </NativeSelect>
    <div className="document-stage flex h-80 flex-col" style={{ position: "relative", inset: "auto" }}>
      {state === "source-error" ? <FileViewerErrorState className="h-full" error={error} title="Could not open file" retry="always" onRetry={() => setState("loading")} />
        : state === "skeleton" ? <PdfViewerFallback bare /> : <>
        <ViewerControls title="Report.pdf" />
        {state === "error" ? <ViewerErrorState error={error} sourceKind="url" format="pdf" bare onRetry={() => setState("loading")} />
          : state === "loading" ? <FileViewerLoadingState />
          : state === "empty" ? <FileViewerEmptyState />
          : <FileViewerUnsupportedState fileName="Report.bin" />}
      </>}
    </div>
  </section>;
}

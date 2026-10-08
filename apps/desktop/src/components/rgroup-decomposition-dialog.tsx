import { Input } from "./ui/input";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { prepareRGroupPreview, type RGroupPreview } from "../hooks/rgroup-preview";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { RGroupPreviewResults } from "./rgroup-preview";
import "./rgroup-analysis.css";

export type RGroupDecompositionRequest = { documentId: string; documentTitle: string };

export function RGroupDecompositionDialog({ request, onDismiss, onRun }: {
  request: RGroupDecompositionRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, core: string, preview: RGroupPreview) => Promise<void>;
}) {
  const [mode, setMode] = useState("all");
  const [core, setCore] = useState("");
  const [preview, setPreview] = useState<RGroupPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setMode("all"); setCore(""); setPreview(null); setBusy(null); setError("");
    return () => { generation.current += 1; };
  }, [request]);
  const invalidate = () => { generation.current += 1; setPreview(null); setError(""); };
  const runPreview = async () => {
    if (!request || busy || (mode === "custom" && !core.trim())) return;
    const token = ++generation.current;
    setBusy("preview"); setError(""); setPreview(null);
    try {
      const result = await prepareRGroupPreview(request.documentId, mode === "all" ? "" : core.trim());
      if (generation.current === token) setPreview(result);
    } catch (cause) {
      if (generation.current === token) {
        console.error("[R-group preview]", cause);
        const message = cause instanceof Error ? cause.message : "";
        setError([
          "R-group analysis supports up to 5,000 molecules. Open a smaller collection.",
          "The collection has no molecules.",
          "The core could not be read as SMILES or SMARTS",
          "R-group alignment could not be completed. Try a more specific core.",
          "More than 61 R positions. Choose a more specific core.",
        ].includes(message) ? message : "Could not preview these molecules. Check the core and try again.");
      }
    } finally { if (generation.current === token) setBusy(null); }
  };
  const apply = async () => {
    if (!request || !preview || busy) return;
    const token = ++generation.current;
    setBusy("apply"); setError("");
    try { await onRun(request.documentId, preview.core, preview); if (generation.current === token) onDismiss(); }
    catch (cause) {
      if (generation.current === token) {
        console.error("[R-group columns]", cause);
        setError("Could not apply the columns. Preview the collection again to retry."); setPreview(null);
      }
    }
    finally { if (generation.current === token) setBusy(null); }
  };
  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open && busy !== "apply") onDismiss(); }}>
      <DialogContent variant="form" size={preview ? "xwide" : "compact"} showCloseButton={busy !== "apply"} className="min-w-0 overscroll-contain"
        onEscapeKeyDown={event => { if (busy === "apply") event.preventDefault(); }}
        onInteractOutside={event => { if (busy === "apply") event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Decompose R-groups</DialogTitle>
          <DialogDescription className="sr-only">Preview the scaffolds and substituents in {request?.documentTitle} before applying columns.</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-2 text-xs">Core
            <NativeSelect name="mode" value={mode} disabled={busy !== null} onChange={(event) => { setMode(event.target.value); invalidate(); }}>
              <NativeSelectOption value="all">All scaffolds</NativeSelectOption>
              <NativeSelectOption value="custom">Custom core</NativeSelectOption>
            </NativeSelect>
          </label>
          {mode === "custom" && <label className="flex flex-col gap-2 text-xs">Core SMILES or SMARTS
            <Input variant="field" name="core" autoComplete="off" value={core} maxLength={4000} spellCheck={false} disabled={busy !== null} placeholder="c1ccccc1" onChange={(event) => { setCore(event.target.value); invalidate(); }} />
          </label>}
          {busy && <p className="flex items-center gap-2 text-sm text-(--color-text-secondary)" role="status"><Spinner className="size-4" aria-hidden />{busy === "apply" ? "Applying…" : "Analysing…"}</p>}
          {error && <p className="break-words text-sm text-(--color-text-danger)" role="alert">{error}</p>}
          {preview && <RGroupPreviewResults result={preview.result} total={preview.sourceRows.length} />}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" disabled={busy !== null || (mode === "custom" && !core.trim())} onClick={() => { void runPreview(); }}>Preview</Button>
          <Button type="button" disabled={busy !== null || !preview} onClick={() => { void apply(); }}>Apply columns</Button>
        </DialogFooter>
      </DialogContent>
  </Dialog>;
}

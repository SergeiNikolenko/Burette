import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { prepareRGroupPreview, type RGroupPreview } from "../hooks/rgroup-preview";
import { useAppShellPortalContainer } from "./ui/portal-container";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { CloseIcon } from "./close-icon";
import { RGroupPreviewResults } from "./rgroup-preview";
import "./rgroup-analysis.css";

export type RGroupDecompositionRequest = { documentId: string; documentTitle: string };

export function RGroupDecompositionDialog({ request, onDismiss, onRun }: {
  request: RGroupDecompositionRequest | null;
  onDismiss: () => void;
  onRun: (documentId: string, core: string, preview: RGroupPreview) => Promise<void>;
}) {
  const portalContainer = useAppShellPortalContainer();
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
    if (!request) return;
    const token = ++generation.current;
    setBusy("preview"); setError(""); setPreview(null);
    try {
      const result = await prepareRGroupPreview(request.documentId, mode === "all" ? "" : core.trim());
      if (generation.current === token) setPreview(result);
    } catch (cause) {
      if (generation.current === token) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (generation.current === token) setBusy(null); }
  };
  const apply = async () => {
    if (!request || !preview) return;
    setBusy("apply"); setError("");
    try { await onRun(request.documentId, preview.core, preview); onDismiss(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPreview(null); }
    finally { setBusy(null); }
  };
  return <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open && busy !== "apply") onDismiss(); }}>
    <Dialog.Portal container={portalContainer}>
      <Dialog.Overlay className="radix-dialog-overlay" />
      <Dialog.Content className={`radix-dialog calculated-column-dialog rgroup-dialog${preview ? " rgroup-dialog-preview" : ""}`} aria-describedby={undefined}>
        <div className="radix-dialog-header">
          <Dialog.Title>Decompose R-Groups</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="radix-dialog-close" disabled={busy === "apply"} aria-label="Close R-group decomposition"><CloseIcon size={14} /></button></Dialog.Close>
        </div>
        <div className="radix-dialog-body">
          <label className="calculated-column-field">Core
            <NativeSelect value={mode} disabled={busy !== null} onChange={(event) => { setMode(event.target.value); invalidate(); }}>
              <NativeSelectOption value="all">All scaffolds</NativeSelectOption>
              <NativeSelectOption value="custom">Custom core</NativeSelectOption>
            </NativeSelect>
          </label>
          {mode === "custom" && <label className="calculated-column-field">Core SMILES or SMARTS
            <input value={core} maxLength={4000} spellCheck={false} disabled={busy !== null} placeholder="e.g. c1ccccc1" onChange={(event) => { setCore(event.target.value); invalidate(); }} />
          </label>}
          {busy === "preview" && <p role="status">Analysing…</p>}
          {error && <p className="calculated-column-problem" role="alert">{error}</p>}
          {preview && <RGroupPreviewResults result={preview.result} total={preview.sourceRows.length} />}
        </div>
        <div className="radix-dialog-footer rgroup-footer">
          <button type="button" className="dock-action" disabled={busy !== null || (mode === "custom" && !core.trim())} onClick={() => { void runPreview(); }}>Preview</button>
          <button type="button" className="dock-action calculate-properties-run" disabled={busy !== null || !preview} onClick={() => { void apply(); }}>{busy === "apply" ? "Applying…" : "Apply columns"}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

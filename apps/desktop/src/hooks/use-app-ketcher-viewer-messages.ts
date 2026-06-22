import { useCallback } from "react";
import type { KetcherImportRequest } from "../components/types";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { pathExtension } from "../lib/file-routing";
import { ketcherSource3DFromText } from "../lib/ketcher-workflow";
import type { ViewerDocument } from "../types";

type KetcherViewerMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type OpenKetcherWithFragment = (
  title: string,
  text: string,
  source?: NonNullable<NonNullable<KetcherImportRequest["fragments"]>[number]["source"]>,
  extension?: string,
) => void;

type UseAppKetcherViewerMessagesOptions = {
  activeDocument: ViewerDocument | null;
  documents: ViewerDocument[];
  openKetcherWithFragment: OpenKetcherWithFragment;
  openKetcherWithStructures: (paths: string[], fragments?: KetcherImportRequest["fragments"]) => void;
  pushStatus: PushStatus;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function decodeBase64Text(textBase64: string) {
  const bytes = Uint8Array.from(atob(textBase64), (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function useAppKetcherViewerMessages({
  activeDocument,
  documents,
  openKetcherWithFragment,
  openKetcherWithStructures,
  pushStatus,
}: UseAppKetcherViewerMessagesOptions) {
  const handleKetcherViewerMessage = useCallback((body: KetcherViewerMessageBody) => {
    if (body?.type === "openInKetcher") {
      const title = bodyString(body.title).trim() || "structure";
      const textBase64 = bodyString(body.textBase64).trim();
      const documentId = bodyString(body.documentId);
      if (textBase64) {
        try {
          const text = decodeBase64Text(textBase64);
          const rowIndex = Number(body.rowIndex);
          const extension = bodyString(body.extension).trim()
            ? bodyString(body.extension).trim().replace(/^\./u, "")
            : "sdf";
          openKetcherWithFragment(title, text, body.gridEdit === true && documentId && Number.isFinite(rowIndex)
            ? {
                kind: "grid-row",
                documentId,
                rowIndex,
                title,
                extension,
              }
            : undefined, extension);
        } catch (error) {
          pushStatus(`Open in Ketcher failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return true;
      }
      const targetDocument = (documentId
        ? documents.find((document) => document.id === documentId)
        : null) ?? activeDocument;
      const targetPath = bodyString(body.path).trim() || targetDocument?.path;
      if (targetPath) {
        const virtualText = readBrowserDevVirtualTextDocument(targetPath);
        if (virtualText !== null) {
          openKetcherWithFragment(title, virtualText);
          return true;
        }
        openKetcherWithStructures([targetPath]);
      }
      return true;
    }

    if (body?.type === "openSdfKetcherDocument") {
      const rawFragments = Array.isArray(body.fragments) ? body.fragments : [];
      const fragments = rawFragments.flatMap((fragment) => {
        if (!fragment || typeof fragment !== "object") return [];
        const textBase64 = bodyString((fragment as Record<string, unknown>).textBase64).trim();
        if (!textBase64) return [];
        try {
          const text = decodeBase64Text(textBase64);
          if (!text.trim()) return [];
          const title = bodyString((fragment as Record<string, unknown>).title).trim() || "ketcher-sketch.sdf";
          return [{
            title,
            text,
            source3d: ketcherSource3DFromText(title, text, pathExtension(title)),
          }];
        } catch {
          return [];
        }
      });
      if (fragments.length > 0) {
        openKetcherWithStructures([], fragments);
      } else {
        pushStatus("Open in Ketcher failed: selected molecules do not have structure data.", "error");
      }
      return true;
    }

    return false;
  }, [activeDocument, documents, openKetcherWithFragment, openKetcherWithStructures, pushStatus]);

  return { handleKetcherViewerMessage };
}

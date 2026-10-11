import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { openBrowserDevMolstarContextDocument, openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { normalizeMolstarStylePreference } from "../lib/conformer-generation";
import { molstarContextEntryExtension } from "../lib/molstar-context";
import type { StructureDragPayload } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";
import { requestViewerAction } from "../lib/viewer-bridge";
import { focusSceneDocument } from "./workspace-scene-import";
import type { ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type MolstarContextEntry = NonNullable<MolstarContextDocument["entries"]>[number];
type MolstarContextMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppMolstarContextMessagesOptions = {
  activeDocument: ViewerDocument | null;
  addDocuments: (documents: ViewerDocument[]) => void;
  appendGridRecords: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  documents: ViewerDocument[];
  openDockingDocument: (receptorPath: string, ligandPaths: string[]) => Promise<unknown> | void;
  openDocuments: (
    paths: string[],
    reloadOptions?: ViewerReloadOptions,
    preferences?: Partial<ViewerPreferences>,
    options?: { inActiveTab?: boolean },
  ) => Promise<unknown> | void;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
};

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useAppMolstarContextMessages({
  activeDocument,
  addDocuments,
  appendGridRecords,
  documents,
  openDockingDocument,
  openDocuments,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
}: UseAppMolstarContextMessagesOptions) {
  const handleMolstarContextMessage = useCallback((body: MolstarContextMessageBody) => {
    if (body?.type !== "openMolstarContextDocument") return false;

    if (body.contextDocument && typeof body.contextDocument === "object") {
      pushStatus("Opening selected Molstar context...");
      const contextDocument = body.contextDocument as MolstarContextDocument;
      const requestedMolstarStyle = normalizeMolstarStylePreference(body.molstarStyle);
      const molstarPreferences = {
        ...preferences,
        rendererMode: "molstar" as const,
        molstarStyle: requestedMolstarStyle ?? preferences.molstarStyle,
      };
      const entries = (contextDocument.entries ?? []).filter((entry): entry is MolstarContextEntry & { data: string } => (
        typeof entry?.data === "string" && entry.data.length > 0
      ));
      const toGrid = body.destination === "grid";
      // Several molecules, or any molecule bound for a grid, travel as SDF records.
      if (toGrid || entries.length > 1) {
        if (!entries.length || entries.length > 200 || !entries.every(entry => molstarContextEntryExtension(entry.format) === "sdf")) {
          pushStatus("These molecules cannot be opened together.", "error");
          return true;
        }
        const records = entries.map(entry => ({
          path: `${entry.label?.trim() || "Molecule"}.sdf`,
          inputExtension: "sdf",
          text: `${entry.data.replace(/\n?\$\$\$\$\s*$/u, "").trimEnd()}\n$$$$\n`,
        }));
        const gridDocumentId = bodyString(body.gridDocumentId);
        if (toGrid && gridDocumentId) {
          if (!appendGridRecords(gridDocumentId, { paths: [], records })) pushStatus("That grid is no longer open.", "error");
          return true;
        }
        const title = toGrid ? "Ligands.sdf" : `Selected ${entries.length} molecules.sdf`;
        const text = records.map(record => record.text).join("");
        const openPreferences = toGrid ? { ...preferences, rendererMode: "grid2d" as const } : molstarPreferences;
        const reloadOptions = toGrid ? undefined : { sdfPoseControlLabel: "Molecule" };
        void (isTauriRuntime()
          ? invoke<ViewerDocument>("open_text_structure", { request: { title, extension: "sdf", text }, preferences: openPreferences, reloadOptions })
          : openBrowserDevTextDocument(title, "sdf", text, openPreferences, reloadOptions))
          .then(async (document) => {
            addDocuments([document]);
            pushStatus(toGrid ? "Opened selected molecules in a grid" : "Opened selected molecules");
            if (toGrid) return;
            // Show every molecule at once, the same scene "Together" builds from grid rows.
            await focusSceneDocument(document, () => {});
            await requestViewerAction(document.id, { type: "set_sdf_pose_mode", mode: "all" });
          })
          .catch((error) => pushErrorStatus(error, "Opening selected molecules failed"));
        return true;
      }
      const openContextDocument = async () => {
        if (!isTauriRuntime()) return openBrowserDevMolstarContextDocument(contextDocument, molstarPreferences);
        if (entries.length !== 1) {
          throw new Error("Native Molstar context view supports one inline structure at a time.");
        }
        const entry = entries[0];
        const extension = molstarContextEntryExtension(entry.format);
        const label = contextDocument.label?.trim() || entry.label?.trim() || "Molstar context";
        return invoke<ViewerDocument>("open_text_structure", {
          request: {
            title: `${label}.${extension}`,
            extension,
            text: entry.data,
          },
          preferences: molstarPreferences,
          reloadOptions: {},
        });
      };
      void openContextDocument()
        .then((document) => {
          addDocuments([document]);
          rememberRecentStructures([document]);
          pushStatus("Opened selected Molstar context");
        })
        .catch((error) => pushErrorStatus(error, "Molstar context view failed"));
      return true;
    }

    const documentId = bodyString(body.documentId);
    const targetDocument = (documentId
      ? documents.find((document) => document.id === documentId)
      : null) ?? activeDocument;
    if (targetDocument?.dockingRequest) {
      pushStatus("Opening separate Molstar docking view...");
      void openDockingDocument(targetDocument.dockingRequest.receptorPath, targetDocument.dockingRequest.ligandPaths);
    } else if (targetDocument?.path && !targetDocument.virtual) {
      pushStatus("Opening separate Molstar view...");
      void openDocuments([targetDocument.path], undefined, { rendererMode: "molstar" }, { inActiveTab: true });
    } else {
      pushStatus("This virtual structure cannot be opened separately.", "error");
    }
    return true;
  }, [activeDocument, addDocuments, appendGridRecords, documents, openDockingDocument, openDocuments, preferences, pushErrorStatus, pushStatus, rememberRecentStructures]);

  return { handleMolstarContextMessage };
}

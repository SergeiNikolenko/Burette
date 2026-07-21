import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { KetcherSketchRequest } from "../components/types";
import { openBrowserDevMolstarContextDocument, openBrowserDevTextDocument, readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { runXtbRequest, requestXtbStatus } from "../lib/chemistry-job-requests";
import { xtbOperationLabel } from "../lib/chemistry-settings";
import { directChemistryJobGuardMessage } from "../lib/direct-chemistry-guard";
import type { DockArea, DockTabKind } from "../lib/dock";
import { structureExtensionFromPath } from "../lib/file-routing";
import { molstarContextEntryExtension } from "../lib/molstar-context";
import { basename } from "../lib/sidebar-projects";
import type { StructureDragPayload } from "../lib/structure-drag";
import { readStructureText } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import type {
  ViewerDocument,
  ViewerPreferences,
  XtbJob,
  XtbOperation,
  XtbRunRequest,
  XtbRunResult,
  XtbSettings,
  XtbStatus,
} from "../types";

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type MolstarContextEntry = NonNullable<MolstarContextDocument["entries"]>[number];

type XtbRunJobOptions = {
  title?: string;
  inputLabel?: string;
  openPrimary?: boolean;
  openOptimizedPoseInCurrentView?: boolean;
  poseSourceDocument?: ViewerDocument | null;
};

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type DockDropInput = {
  area: DockArea;
  tabKind: DockTabKind;
  payload: StructureDragPayload;
};

type UseAppXtbWorkflowsOptions = {
  activeDocument: ViewerDocument | null;
  addDockDrop: (input: DockDropInput) => void;
  cancelledXtbJobIdsRef: MutableRefObject<Set<string>>;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  openDocumentsInActiveTab: (documents: ViewerDocument[]) => void;
  openPaths: (paths: string[]) => void | Promise<unknown>;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  requestMolstarXtbContextDocument: (document: ViewerDocument) => Promise<MolstarContextDocument | null>;
  setDockActiveTab: (area: DockArea, kind: DockTabKind) => void;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setXtbJobs: Dispatch<SetStateAction<XtbJob[]>>;
  setXtbStatus: Dispatch<SetStateAction<XtbStatus | null>>;
  xtbSettings: XtbSettings;
};

function countXyzFrames(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let index = 0;
  let frames = 0;
  while (index < lines.length && frames < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const atomLines = lines.slice(index + 2, index + 2 + atomCount);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames += 1;
    index += atomCount + 2;
  }
  return frames;
}

function xtbInputRequestForDocument(document: ViewerDocument): Pick<XtbRunRequest, "inputPath" | "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  if (document.virtual && !isTauriRuntime()) {
    const text = readBrowserDevVirtualTextDocument(document.path);
    if (text === null) return null;
    return {
      inputText: text,
      inputExtension: document.extension || structureExtensionFromPath(document.path),
      sourcePath: document.sourcePath ?? null,
      label: document.title,
    };
  }
  return {
    inputPath: document.path,
    sourcePath: document.sourcePath ?? null,
    label: document.title,
  };
}

function xtbInputRequestForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
  sourcePath: string | null | undefined,
): Pick<XtbRunRequest, "inputText" | "inputExtension" | "sourcePath" | "label"> | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    inputText: entry.data,
    inputExtension: molstarContextEntryExtension(entry.format),
    sourcePath: sourcePath ?? null,
    label: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
  };
}

export function useAppXtbWorkflows({
  activeDocument,
  addDockDrop,
  cancelledXtbJobIdsRef,
  openDockTab,
  openDocumentsInActiveTab,
  openPaths,
  openTextDocuments,
  preferences,
  pushErrorStatus,
  pushStatus,
  rememberRecentStructures,
  requestMolstarXtbContextDocument,
  setDockActiveTab,
  setDockOpen,
  setXtbJobs,
  setXtbStatus,
  xtbSettings,
}: UseAppXtbWorkflowsOptions) {
  const openXtbOptimizedPoseInCurrentView = useCallback(async (
    sourceDocument: ViewerDocument | null | undefined,
    sourcePath: string | null | undefined,
    result: XtbRunResult,
  ) => {
    const sourceTitle = sourceDocument?.title ?? (sourcePath ? basename(sourcePath) : "structure");
    const trajectoryArtifact = result.artifacts.find((artifact) => artifact.title === "xtbopt.log");
    if (trajectoryArtifact) {
      const trajectoryText = await readStructureText(trajectoryArtifact.path);
      const trajectoryFrames = countXyzFrames(trajectoryText);
      if (trajectoryFrames > 1) {
        const title = `${sourceTitle} xTB optimization.xyz`;
        const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
        const reloadOptions = { trajectoryAutoPlayOnce: true, molstarStyle: preferences.molstarStyle };
        const document = isTauriRuntime()
          ? await invoke<ViewerDocument>("open_text_structure", {
              request: {
                title,
                extension: "xyz",
                text: trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              },
              preferences: molstarPreferences,
              reloadOptions,
            })
          : await openBrowserDevTextDocument(
              title,
              "xyz",
              trajectoryText.endsWith("\n") ? trajectoryText : `${trajectoryText}\n`,
              molstarPreferences,
              reloadOptions,
            );
        const documentWithSource = sourcePath ? { ...document, sourcePath } : document;
        openDocumentsInActiveTab([documentWithSource]);
        rememberRecentStructures([documentWithSource]);
        pushStatus("Opened xTB optimization trajectory in the current Mol* view", "success");
        return;
      }
    }
    if (!sourcePath || !result.primaryOpenPath) return;
    const [sourceText, optimizedText] = await Promise.all([
      readStructureText(sourcePath),
      readStructureText(result.primaryOpenPath),
    ]);
    const molstarPreferences = { ...preferences, rendererMode: "molstar" as const };
    const document = await openBrowserDevMolstarContextDocument({
      label: `${sourceTitle} xTB optimized`,
      entries: [
        {
          role: "receptor",
          label: `${sourceTitle} input`,
          format: structureExtensionFromPath(sourcePath),
          data: sourceText,
        },
        {
          role: "ligand",
          label: "xTB optimized pose",
          format: structureExtensionFromPath(result.primaryOpenPath),
          data: optimizedText,
        },
      ],
      context: { scope: "xtb-optimization" },
    }, molstarPreferences);
    openDocumentsInActiveTab([document]);
    rememberRecentStructures([document]);
    pushStatus("Opened xTB optimized pose in the current Mol* view", "success");
  }, [openDocumentsInActiveTab, preferences, pushStatus, rememberRecentStructures]);

  const runXtbJob = useCallback(async (
    request: XtbRunRequest,
    options: XtbRunJobOptions = {},
  ) => {
    const title = options.title ?? xtbOperationLabel(request.operation);
    const inputLabel = options.inputLabel ?? request.label ?? request.inputPath ?? "Ketcher sketch";
    const guardMessage = await directChemistryJobGuardMessage("xTB", request.inputText ?? null, request.inputExtension ?? structureExtensionFromPath(request.inputPath ?? request.sourcePath), request.inputPath ?? request.sourcePath ?? null);
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    const jobId = `xtb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const pendingJob: XtbJob = {
      id: jobId,
      title,
      operation: request.operation,
      status: "running",
      inputLabel,
      startedAt,
      completedAt: null,
      result: null,
      error: null,
    };
    setXtbJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const saveRunFiles = request.saveRunFiles ?? xtbSettings.saveRunFiles;
      const method = request.operation === "vipea"
        ? "gfn1"
        : request.method ?? xtbSettings.method;
      const result = await runXtbRequest({
        optLevel: xtbSettings.optLevel,
        charge: xtbSettings.charge,
        uhf: xtbSettings.uhf,
        threads: xtbSettings.threads,
        accuracy: xtbSettings.accuracy,
        electronicTemperature: xtbSettings.electronicTemperature,
        solvationModel: xtbSettings.solvationModel,
        solvent: xtbSettings.solvent === "none" ? null : xtbSettings.solvent,
        properties: xtbSettings.properties,
        mdTemperature: xtbSettings.mdTemperature,
        mdTimePs: xtbSettings.mdTimePs,
        mdStepFs: xtbSettings.mdStepFs,
        mdSnapshots: xtbSettings.mdSnapshots,
        timeoutSeconds: request.operation === "md" || request.operation === "metadyn"
          ? Math.max(xtbSettings.timeoutSeconds, 600)
          : xtbSettings.timeoutSeconds,
        saveRunFiles,
        ...request,
        method,
        jobId,
      });
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.error ?? "");
      const recovered = !result.ok && Boolean(result.primaryOpenPath);
      const jobStatus: XtbJob["status"] = cancelled ? "cancelled" : result.ok ? "success" : recovered ? "recovered" : "failed";
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: jobStatus,
        completedAt: Date.now(),
        result,
        error: result.error ?? null,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      void requestXtbStatus().then(setXtbStatus).catch(() => {});
      const textArtifacts = [result.reportPath, result.logPath].filter(Boolean);
      if (textArtifacts.length > 0) {
        void openTextDocuments(textArtifacts, { background: true });
      }
      const sourcePath = request.sourcePath ?? request.inputPath ?? null;
      if ((result.ok || recovered) && options.openOptimizedPoseInCurrentView && request.operation === "optimize") {
        await openXtbOptimizedPoseInCurrentView(options.poseSourceDocument, sourcePath, result);
      }
      if (options.openPrimary !== false && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      if (!options.openOptimizedPoseInCurrentView && result.ok && request.operation === "optimize" && sourcePath && result.primaryOpenPath) {
        openDockTab("bottom", "compare");
        setDockActiveTab("bottom", "compare");
        setDockOpen("bottom", true);
        addDockDrop({
          area: "bottom",
          tabKind: "compare",
          payload: { paths: [sourcePath, result.primaryOpenPath], records: [] },
        });
      }
      if (result.ok) {
        pushStatus(`xTB finished: ${title}`, "success");
      } else if (recovered) {
        pushStatus(`xTB produced partial results: ${title}`, "info", result.error ? [result.error] : []);
      } else {
        pushStatus(`xTB failed: ${result.error ?? title}`, "error", result.error ? [result.error] : []);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledXtbJobIdsRef.current.has(jobId);
      setXtbJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "xTB job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`xTB cancelled: ${title}`);
        return;
      }
      pushErrorStatus(error, `xTB ${request.operation} failed`);
    } finally {
      cancelledXtbJobIdsRef.current.delete(jobId);
    }
  }, [addDockDrop, cancelledXtbJobIdsRef, openDockTab, openPaths, openTextDocuments, openXtbOptimizedPoseInCurrentView, pushErrorStatus, pushStatus, setDockActiveTab, setDockOpen, setXtbJobs, setXtbStatus, xtbSettings]);

  const runXtbActiveOperation = useCallback(async (operation: XtbOperation) => {
    if (!activeDocument) {
      pushStatus("Open a structure before running xTB.", "error");
      return;
    }
    const contextDocument = await requestMolstarXtbContextDocument(activeDocument);
    const contextInputRequest = xtbInputRequestForMolstarContextDocument(contextDocument, activeDocument.sourcePath ?? activeDocument.path);
    const inputRequest = contextInputRequest ?? xtbInputRequestForDocument(activeDocument);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    const openOptimizedPoseInCurrentView = operation === "optimize";
    await runXtbJob({
      operation,
      ...inputRequest,
    }, {
      title: xtbOperationLabel(operation),
      inputLabel: inputRequest.label ?? activeDocument.title,
      openPrimary: operation !== "properties" && !openOptimizedPoseInCurrentView,
      openOptimizedPoseInCurrentView,
      poseSourceDocument: openOptimizedPoseInCurrentView ? activeDocument : null,
    });
  }, [activeDocument, pushStatus, requestMolstarXtbContextDocument, runXtbJob]);

  const runXtbKetcherSketch = useCallback(async (request: KetcherSketchRequest) => {
    await runXtbJob({
      operation: "optimize",
      inputText: request.text,
      inputExtension: request.extension,
      label: request.title,
    }, {
      title: "xTB Optimize Ketcher Sketch",
      inputLabel: request.title,
    });
  }, [runXtbJob]);

  const runXtbGridScoring = useCallback(async (document: ViewerDocument | null = activeDocument) => {
    if (!document) {
      pushStatus("Open a grid or structure before running xTB scoring.", "error");
      return;
    }
    if (document.renderer === "grid2d") {
      pushStatus("Open a specific molecule from the collection in Mol* before running xTB Properties.", "error");
      return;
    }
    const inputRequest = xtbInputRequestForDocument(document);
    if (!inputRequest) {
      pushStatus("This generated structure cannot be used for xTB because its source text is unavailable.", "error");
      return;
    }
    await runXtbJob({
      operation: "properties",
      ...inputRequest,
    }, {
      title: "xTB Properties",
      inputLabel: document.title,
      openPrimary: false,
    });
  }, [activeDocument, pushStatus, runXtbJob]);

  return {
    runXtbActiveOperation,
    runXtbGridScoring,
    runXtbJob,
    runXtbKetcherSketch,
  };
}

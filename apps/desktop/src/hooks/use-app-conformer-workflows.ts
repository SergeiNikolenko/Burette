import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";

import type { StructureViewerAction } from "../components/types";
import { readBrowserDevVirtualTextDocument, type openBrowserDevMolstarContextDocument } from "../lib/browser-dev-documents";
import { prepareConformerRequest, requestConformerStatus, runConformerRequest } from "../lib/chemistry-job-requests";
import { conformerOperationLabel } from "../lib/chemistry-settings";
import { canInspectConformerEnsemble, canUseConformerWorkflow } from "../lib/conformer-ensemble";
import { directChemistryJobGuardMessage } from "../lib/direct-chemistry-guard";
import { molstarContextEntryExtension } from "../lib/molstar-context";
import { parentDirectory } from "../lib/sidebar-projects";
import { readStructureText } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import { textToBase64 } from "../lib/conformer-generation";
import type {
  ConformerJob,
  ConformerOperation,
  ConformerPreparedRun,
  ConformerRunRequest,
  ConformerSettings,
  ConformerStatus,
  ViewerDocument,
} from "../types";

type MolstarContextDocument = Parameters<typeof openBrowserDevMolstarContextDocument>[0];
type MolstarContextEntry = NonNullable<MolstarContextDocument["entries"]>[number];

type SelectedConformerInput = {
  title: string;
  extension: string;
  text: string;
};

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppConformerWorkflowsOptions = {
  activeDocument: ViewerDocument | null;
  cancelledConformerJobIdsRef: MutableRefObject<Set<string>>;
  conformerSettings: ConformerSettings;
  openPaths: (paths: string[]) => void | Promise<unknown>;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  requestMolstarXtbContextDocument: (document: ViewerDocument) => Promise<MolstarContextDocument | null>;
  setConformerJobs: Dispatch<SetStateAction<ConformerJob[]>>;
  setConformerStatus: Dispatch<SetStateAction<ConformerStatus | null>>;
};

function conformerOutputDirectory(document: ViewerDocument) {
  const sourcePath = document.sourcePath?.trim() || (!document.virtual ? document.path : "");
  if (!sourcePath || /^[a-z][a-z0-9+.-]*:/iu.test(sourcePath)) return null;
  return parentDirectory(sourcePath);
}

async function selectedPdbLigandConformerInput(
  document: ViewerDocument,
  action: StructureViewerAction,
): Promise<SelectedConformerInput | null> {
  if (action.type !== "focus_ligand") return null;
  const extension = document.extension.toLowerCase();
  if (extension !== "pdb" && extension !== "pdbqt" && extension !== "ent") return null;
  const comp = selectorText(action.selector, "label_comp_id") ?? selectorText(action.selector, "auth_comp_id");
  const chain = selectorText(action.selector, "auth_asym_id") ?? selectorText(action.selector, "label_asym_id");
  const seq = selectorText(action.selector, "auth_seq_id") ?? selectorText(action.selector, "label_seq_id");
  const icode = selectorText(action.selector, "pdbx_PDB_ins_code");
  if (!comp || !chain || !seq) return null;
  const sourceText = await readStructureText(document.sourcePath ?? document.path);
  const records = sourceText.split(/\r?\n/u).filter((line) => pdbAtomLineMatchesLigand(line, comp, chain, seq, icode));
  if (records.length === 0) return null;
  const ligandCode = comp.toUpperCase();
  const title = [ligandCode, chain, seq].filter(Boolean).join(" ");
  const selectorSummary = [ligandCode, chain, seq + (icode ?? "")].filter(Boolean).join(" ");
  const text = [
    `${ligandCode} PDB ligand selection`,
    `REMARK PDB ligand selection from ${document.title}`,
    `REMARK Selected ${selectorSummary}`,
    ...records,
    "END",
    "",
  ].join("\n");
  return { title, extension: "pdb", text };
}

function conformerInputForMolstarContextDocument(
  contextDocument: MolstarContextDocument | null | undefined,
): SelectedConformerInput | null {
  const entry = (contextDocument?.entries ?? []).find((candidate): candidate is MolstarContextEntry & { data: string } => (
    typeof candidate?.data === "string" && candidate.data.trim().length > 0
  ));
  if (!entry) return null;
  return {
    title: contextDocument?.label?.trim() || entry.label?.trim() || "Molstar selection",
    extension: molstarContextEntryExtension(entry.format),
    text: entry.data,
  };
}

function pdbAtomLineMatchesLigand(line: string, comp: string, chain: string, seq: string, icode: string | null) {
  const record = line.slice(0, 6).trim();
  if (record !== "ATOM" && record !== "HETATM") return false;
  const lineComp = line.slice(17, 20).trim().toUpperCase();
  const lineChain = line.slice(21, 22).trim() || "-";
  const lineSeq = line.slice(22, 26).trim();
  const lineIcode = line.slice(26, 27).trim();
  return lineComp === comp.toUpperCase()
    && lineChain === chain
    && lineSeq === seq
    && (icode ? lineIcode === icode : true);
}

function selectorText(selector: unknown, key: string) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) return null;
  const value = (selector as Record<string, unknown>)[key];
  if (Array.isArray(value) || value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value);
}

export function useAppConformerWorkflows({
  activeDocument,
  cancelledConformerJobIdsRef,
  conformerSettings,
  openPaths,
  openTextDocuments,
  pushErrorStatus,
  pushStatus,
  requestMolstarXtbContextDocument,
  setConformerJobs,
  setConformerStatus,
}: UseAppConformerWorkflowsOptions) {
  const runConformerJob = useCallback(async (request: ConformerRunRequest) => {
    const title = conformerOperationLabel(request.operation);
    const jobId = `conformer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest: ConformerRunRequest = {
      ...request,
      jobId,
      method: conformerSettings.method,
      solvent: conformerSettings.solvent === "none" ? null : conformerSettings.solvent,
      charge: conformerSettings.charge,
      uhf: conformerSettings.uhf,
      threads: conformerSettings.threads,
      timeoutSeconds: request.operation === "prism-prune" ? conformerSettings.prismTimeoutSeconds : conformerSettings.timeoutSeconds,
      energyWindowKcalMol: conformerSettings.energyWindowKcalMol,
      rmsdThresholdAngstrom: conformerSettings.rmsdThresholdAngstrom,
      samplingMode: conformerSettings.samplingMode,
      prismEnergySort: conformerSettings.prismEnergySort,
    };
    let preparedRun: ConformerPreparedRun;
    try {
      preparedRun = await prepareConformerRequest(fullRequest);
    } catch (error) {
      pushErrorStatus(error, `${title} setup failed`);
      return;
    }
    const pendingJob: ConformerJob = {
      id: jobId,
      title,
      operation: request.operation,
      inputTitle: request.title,
      status: "running",
      startedAt: Date.now(),
      workDir: preparedRun.workDir,
      logPath: preparedRun.logPath,
      result: null,
      error: null,
    };
    setConformerJobs((previous) => [pendingJob, ...previous].slice(0, 20));
    try {
      const result = await runConformerRequest({ ...fullRequest, workDir: preparedRun.workDir });
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId) || /cancelled/iu.test(result.errorSummary ?? "");
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : result.ok ? (result.exitCode === 0 ? "success" : "recovered") : "failed",
        completedAt: Date.now(),
        workDir: result.workDir,
        logPath: result.logPath,
        result,
        error: result.errorSummary ?? (result.ok ? null : `Exited with code ${result.exitCode}`),
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      if (result.reportPath) {
        void openTextDocuments([result.reportPath], { background: true });
      }
      if (result.ok && result.primaryOpenPath) {
        void openPaths([result.primaryOpenPath]);
      }
      void requestConformerStatus().then(setConformerStatus).catch(() => {});
      pushStatus(`${title} ${result.ok ? "finished" : "failed"}: ${request.title}`, result.ok ? "success" : "error", [
        ...(result.errorSummary ? [result.errorSummary] : []),
        `Exit code: ${result.exitCode}`,
        `Run folder: ${result.workDir}`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = cancelledConformerJobIdsRef.current.has(jobId);
      setConformerJobs((previous) => previous.map((job) => job.id === jobId ? {
        ...job,
        status: cancelled ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: cancelled ? "Conformer job cancelled." : message,
      } : job));
      if (cancelled) {
        pushStatus(`${title} cancelled: ${request.title}`);
        return;
      }
      pushErrorStatus(error, `${title} failed`);
    } finally {
      cancelledConformerJobIdsRef.current.delete(jobId);
    }
  }, [cancelledConformerJobIdsRef, conformerSettings, openPaths, openTextDocuments, pushErrorStatus, pushStatus, setConformerJobs, setConformerStatus]);

  const runConformerOperation = useCallback(async (
    operation: ConformerOperation,
    document: ViewerDocument | null | undefined = activeDocument,
    selection: StructureViewerAction | null = null,
  ) => {
    if (!document) {
      pushStatus("Open a small molecule or conformer ensemble before running CREST/PRISM.", "error");
      return;
    }
    if (operation === "crest-generate" && document.renderer === "grid2d" && !selection) {
      pushStatus("Open a specific molecule from the collection in Mol* before running CREST.", "error");
      return;
    }
    let selectedInput: SelectedConformerInput | null = null;
    if (selection && operation === "crest-generate") {
      try {
        selectedInput = await selectedPdbLigandConformerInput(document, selection);
      } catch (error) {
        pushErrorStatus(error, "Selected object extraction failed");
        return;
      }
    }
    if (!selectedInput && operation === "crest-generate") {
      const contextDocument = await requestMolstarXtbContextDocument(document);
      selectedInput = conformerInputForMolstarContextDocument(contextDocument);
    }
    if (selection && operation === "crest-generate" && !selectedInput) {
      pushStatus("Selected object could not be extracted for CREST.", "error");
      return;
    }
    if (!selectedInput && !canUseConformerWorkflow(document.extension)) {
      pushStatus("CREST/PRISM needs a small-molecule file or a selected object.", "error");
      return;
    }
    if (operation === "prism-prune" && !canInspectConformerEnsemble(document.extension)) {
      pushStatus("PRISM pruning expects an ensemble file such as XYZ or SDF.", "error");
      return;
    }
    const virtualText = !isTauriRuntime() ? readBrowserDevVirtualTextDocument(document.path) : null;
    const inputText = selectedInput?.text ?? virtualText;
    const guardMessage = await directChemistryJobGuardMessage(
      operation === "crest-generate" ? "CREST" : "PRISM",
      inputText,
      selectedInput?.extension ?? document.extension,
      inputText ? null : document.sourcePath ?? document.path,
    );
    if (guardMessage) {
      pushStatus(guardMessage, "error");
      return;
    }
    await runConformerJob({
      operation,
      path: document.sourcePath ?? document.path,
      title: selectedInput?.title ?? document.title,
      extension: selectedInput?.extension ?? document.extension,
      inputDataBase64: inputText === null ? null : textToBase64(inputText),
      outputDirectory: conformerOutputDirectory(document),
    });
  }, [activeDocument, pushErrorStatus, pushStatus, requestMolstarXtbContextDocument, runConformerJob]);

  return { runConformerJob, runConformerOperation };
}

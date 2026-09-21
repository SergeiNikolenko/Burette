import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { StatusKind } from "../components/types";
import {
  CHEMSPACE_KEY_ACCOUNT,
  databaseBrowserUrl,
  databaseProviderDescriptor,
  databaseResultSummary,
  runDatabaseSearch,
  sqlSecretAccount,
  storeDatabaseSecret,
  type DatabaseProvider,
  type DatabaseQueryRequest,
  type DatabaseSqlEngine,
  type DatabaseStructureSearchMode,
} from "../lib/database";
import type { StructureDragPayload } from "../lib/structure-drag";
import { isTauriRuntime } from "../lib/tauri";
import type { DatabaseJob, ViewerDocument, ViewerPreferences } from "../types";

/** Job history is capped like the conformer and xTB lists in the Jobs panel. */
const MAX_DATABASE_JOBS = 20;

export type DatabaseQueryDraft = {
  provider: DatabaseProvider;
  structure: string;
  searchMode: DatabaseStructureSearchMode;
  similarityThreshold: number;
  text: string;
  field: string;
  maxRecords: number;
  url: string;
  sqlEngine: DatabaseSqlEngine;
  sqlConnection: string;
  sqlStatement: string;
  /** Typed once, handed to the keychain, and never kept in the draft afterwards. */
  sqlPassword: string;
  catalogueProviders: string;
  maxPrice: string;
  minAmount: string;
  /** Same as the SQL password: typed once, then it lives in the keychain. */
  apiKey: string;
};

type UseAppDatabaseOptions = {
  activeDocument: ViewerDocument | null;
  addDocuments: (documents: ViewerDocument[]) => void;
  appendGridRecords: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  preferences: ViewerPreferences;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: StatusKind, details?: string[]) => void;
};

export function databaseQueryDraft(
  provider: DatabaseProvider,
  seed: Partial<DatabaseQueryDraft> = {},
): DatabaseQueryDraft {
  const descriptor = databaseProviderDescriptor(provider);
  return {
    provider,
    structure: "",
    searchMode: "substructure",
    similarityThreshold: 80,
    text: "",
    field: descriptor.fields[0]?.id ?? "text",
    maxRecords: descriptor.defaultRecords,
    url: "",
    sqlEngine: "postgres",
    sqlConnection: "",
    sqlStatement: "",
    sqlPassword: "",
    catalogueProviders: "",
    maxPrice: "",
    minAmount: "",
    apiKey: "",
    ...seed,
  };
}

export function databaseQuerySummary(draft: DatabaseQueryDraft) {
  return draft.structure.trim()
    || draft.text.trim()
    || draft.url.trim()
    || draft.sqlStatement.trim()
    || databaseProviderDescriptor(draft.provider).title;
}

export function useAppDatabase({
  activeDocument,
  addDocuments,
  appendGridRecords,
  preferences,
  pushErrorStatus,
  pushStatus,
}: UseAppDatabaseOptions) {
  const [databaseJobs, setDatabaseJobs] = useState<DatabaseJob[]>([]);
  const [databaseQuery, setDatabaseQuery] = useState<DatabaseQueryDraft | null>(null);

  const openDatabaseQuery = useCallback((
    provider: DatabaseProvider,
    seed: Partial<DatabaseQueryDraft> = {},
  ) => {
    setDatabaseQuery(databaseQueryDraft(provider, seed));
  }, []);

  const closeDatabaseQuery = useCallback(() => {
    setDatabaseQuery(null);
  }, []);

  const clearDatabaseJobs = useCallback(() => {
    setDatabaseJobs([]);
    pushStatus("Database job history cleared");
  }, [pushStatus]);

  const finishJob = useCallback((id: string, patch: Partial<DatabaseJob>) => {
    setDatabaseJobs((previous) => previous.map((job) => job.id === id
      ? { ...job, completedAt: Date.now(), ...patch }
      : job));
  }, []);

  const openInBrowser = useCallback(async (request: DatabaseQueryRequest) => {
    try {
      const url = await databaseBrowserUrl(request);
      if (!url) return false;
      await invoke("open_external_url", { url });
      return true;
    } catch {
      return false;
    }
  }, []);

  const runDatabaseQuery = useCallback(async (draft: DatabaseQueryDraft) => {
    const descriptor = databaseProviderDescriptor(draft.provider);
    // Every provider is reached over the network from the Rust backend, which the
    // browser development shell does not have; saying so beats a failed request.
    if (!isTauriRuntime()) {
      pushStatus(`${descriptor.title} is available in the desktop app only.`, "error");
      return;
    }
    // Actives are folded into the collection on screen, so there has to be one.
    const appendTarget = descriptor.delivery === "records" ? activeDocument : null;
    if (descriptor.delivery === "records" && (!appendTarget || appendTarget.renderer !== "grid2d")) {
      pushStatus("Open a molecule collection first: matches are added to it.", "error");
      return;
    }
    const request: DatabaseQueryRequest = {
      provider: draft.provider,
      delivery: descriptor.delivery,
      maxRecords: draft.maxRecords,
    };
    if (descriptor.needsStructure) {
      const structure = draft.structure.trim();
      if (!structure) {
        pushStatus("Draw or paste a query structure first.", "error");
        return;
      }
      request.structure = structure;
      request.searchMode = descriptor.supportsSearchMode ? draft.searchMode : "similarity";
      request.similarityThreshold = draft.similarityThreshold;
    }
    if (descriptor.textLabel !== null) request.text = draft.text.trim();
    if (descriptor.fields.length > 0) request.field = draft.field;
    if (descriptor.needsUrl) {
      const url = draft.url.trim();
      if (!url) {
        pushStatus("Paste the address of a CSV, TSV, SMILES or SDF document.", "error");
        return;
      }
      request.url = url;
    }
    if (descriptor.needsSql) {
      const connection = draft.sqlConnection.trim();
      const statement = draft.sqlStatement.trim();
      if (!connection || !statement) {
        pushStatus("A SQL query needs a connection and a statement.", "error");
        return;
      }
      // PostgreSQL is the only engine that authenticates with a password, and the
      // password goes to the keychain rather than into the request or the draft.
      const account = draft.sqlEngine === "postgres" ? sqlSecretAccount(connection) : "";
      if (account && draft.sqlPassword) {
        try {
          await storeDatabaseSecret(account, draft.sqlPassword);
        } catch (error) {
          pushErrorStatus(error, "Saving the database password failed");
          return;
        }
      }
      request.sql = {
        engine: draft.sqlEngine,
        connection,
        statement,
        ...(account ? { account } : {}),
      };
    }
    if (descriptor.needsCatalogueFilters) {
      if (draft.catalogueProviders.trim()) request.providers = draft.catalogueProviders.trim();
      const maxPrice = Number.parseFloat(draft.maxPrice);
      const minAmount = Number.parseFloat(draft.minAmount);
      if (Number.isFinite(maxPrice) && maxPrice > 0) request.maxPrice = maxPrice;
      if (Number.isFinite(minAmount) && minAmount > 0) request.minAmount = minAmount;
    }
    if (descriptor.needsApiKey) {
      // The key never travels in the request: it is stored once and read back in
      // the backend from the keychain entry this account names.
      if (draft.apiKey.trim()) {
        try {
          await storeDatabaseSecret(CHEMSPACE_KEY_ACCOUNT, draft.apiKey.trim());
        } catch (error) {
          pushErrorStatus(error, "Saving the ChemSpace key failed");
          return;
        }
      }
      request.account = CHEMSPACE_KEY_ACCOUNT;
    }

    const id = `database-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const query = databaseQuerySummary(draft);
    const startedJob: DatabaseJob = {
      id,
      title: descriptor.title,
      provider: descriptor.title,
      query,
      status: "running",
      startedAt: Date.now(),
    };
    setDatabaseJobs((previous) => [startedJob, ...previous].slice(0, MAX_DATABASE_JOBS));
    setDatabaseQuery(null);
    pushStatus(`${descriptor.title}: searching…`);
    try {
      const result = await runDatabaseSearch(request, preferences);
      if (result.recordCount === 0) {
        finishJob(id, { status: "success", recordCount: 0, warnings: result.warnings });
        pushStatus(databaseResultSummary(result), "info", result.warnings);
        return;
      }
      if (result.document) {
        addDocuments([result.document]);
      } else if (result.records && appendTarget) {
        const appended = appendGridRecords(appendTarget.id, {
          paths: [],
          records: [{
            path: `${result.title}.${result.records.inputExtension}`,
            inputExtension: result.records.inputExtension,
            text: result.records.text,
          }],
        });
        if (!appended) {
          finishJob(id, { status: "failed", error: "The open collection did not accept the matches." });
          pushStatus("The open collection did not accept the matches.", "error");
          return;
        }
      }
      finishJob(id, {
        status: "success",
        recordCount: result.recordCount,
        documentId: result.document?.id ?? appendTarget?.id ?? null,
        warnings: result.warnings,
      });
      pushStatus(
        databaseResultSummary(result),
        result.warnings.length > 0 ? "info" : "success",
        result.warnings.length > 0 ? result.warnings : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Google Patents talks to an endpoint Google has never documented and rate
      // limits without warning, and ChemSpace needs a key the user may not have.
      // Neither failure should leave the search unreachable, so the same query is
      // handed to a browser rather than reported and dropped.
      if (descriptor.hasBrowserFallback) {
        const opened = await openInBrowser(request);
        finishJob(id, {
          status: "failed",
          error: opened ? `${message} Opened the same search in your browser.` : message,
        });
        pushStatus(
          opened
            ? `${descriptor.title} is unavailable, so the search opened in your browser.`
            : message,
          "error",
          [message],
        );
        return;
      }
      finishJob(id, { status: "failed", error: message });
      pushErrorStatus(error, `${descriptor.title} failed`);
    }
  }, [activeDocument, addDocuments, appendGridRecords, finishJob, openInBrowser, preferences, pushErrorStatus, pushStatus]);

  return {
    clearDatabaseJobs,
    closeDatabaseQuery,
    databaseJobs,
    databaseQuery,
    openDatabaseQuery,
    runDatabaseQuery,
  };
}

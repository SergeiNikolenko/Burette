import { invoke } from "@tauri-apps/api/core";

import type { ViewerDocument, ViewerPreferences } from "../types";

export type DatabaseProvider =
  | "chembl"
  | "chembl-actives"
  | "cod"
  | "wikipedia"
  | "url"
  | "sql"
  | "building-blocks"
  | "patents"
  | "chemspace";

export type DatabaseStructureSearchMode = "substructure" | "similarity" | "exact";

export type DatabaseSqlEngine = "postgres" | "sqlite";

export type DatabaseSqlRequest = {
  engine: DatabaseSqlEngine;
  connection: string;
  statement: string;
  account?: string;
};

export type DatabaseQueryRequest = {
  provider: DatabaseProvider;
  delivery?: "collection" | "records";
  structure?: string;
  searchMode?: DatabaseStructureSearchMode;
  similarityThreshold?: number;
  text?: string;
  field?: string;
  maxRecords?: number;
  url?: string;
  sql?: DatabaseSqlRequest;
  providers?: string;
  maxPrice?: number;
  minAmount?: number;
  account?: string;
};

export type DatabaseSearchResult = {
  provider: string;
  title: string;
  recordCount: number;
  extension: string;
  document: ViewerDocument | null;
  records: { inputExtension: string; text: string } | null;
  warnings: string[];
};

/** How each Database menu entry presents itself, and what its dialog asks for. */
export type DatabaseProviderDescriptor = {
  provider: DatabaseProvider;
  title: string;
  description: string;
  /** A structure query needs a SMILES or a fragment handed over from Ketcher. */
  needsStructure: boolean;
  /** Structure searches that can run as substructure, similarity or exact. */
  supportsSearchMode: boolean;
  /** A free-text field, and what it means for this provider. */
  textLabel: string | null;
  textPlaceholder: string;
  /** Which field of the provider the text is matched against. */
  fields: { id: string; label: string }[];
  /** Actives fold into the collection on screen instead of opening a new one. */
  delivery: "collection" | "records";
  defaultRecords: number;
  /** A document address the user supplies. */
  needsUrl?: boolean;
  /** A database connection, a statement, and a password kept in the keychain. */
  needsSql?: boolean;
  /** Catalogue filters: provider list, price ceiling, minimum amount. */
  needsCatalogueFilters?: boolean;
  /** An API key the user supplies, kept in the keychain and never in the code. */
  needsApiKey?: boolean;
  /** The search can be handed to a browser when the interface is unavailable. */
  hasBrowserFallback?: boolean;
};

/**
 * The keychain account the ChemSpace key is filed under. Burette ships no key:
 * the user's own key is entered once and kept in the login keychain.
 */
export const CHEMSPACE_KEY_ACCOUNT = "ChemSpace API key";

export const DATABASE_PROVIDERS: Record<DatabaseProvider, DatabaseProviderDescriptor> = {
  chembl: {
    provider: "chembl",
    title: "Search ChEMBL",
    description: "Structure search against the ChEMBL bioactivity database at EMBL-EBI.",
    needsStructure: true,
    supportsSearchMode: true,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "collection",
    defaultRecords: 500,
  },
  "chembl-actives": {
    provider: "chembl-actives",
    title: "Similar From ChEMBL Actives",
    description: "Adds ChEMBL compounds similar to the query that carry measured activity to the open collection.",
    needsStructure: true,
    supportsSearchMode: false,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "records",
    defaultRecords: 200,
  },
  cod: {
    provider: "cod",
    title: "Search Crystallography DB",
    description: "Crystal depositions from the Crystallography Open Database, with their CIF addresses.",
    needsStructure: false,
    supportsSearchMode: false,
    textLabel: "Query",
    textPlaceholder: "aspirin",
    fields: [
      { id: "text", label: "Free text" },
      { id: "formula", label: "Formula" },
      { id: "element", label: "Elements" },
    ],
    delivery: "collection",
    defaultRecords: 500,
  },
  url: {
    provider: "url",
    title: "Retrieve From URL",
    description: "Open a CSV, TSV, SMILES or SDF collection published on the web. Gzipped documents are unpacked.",
    needsStructure: false,
    supportsSearchMode: false,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "collection",
    defaultRecords: 5000,
    needsUrl: true,
  },
  sql: {
    provider: "sql",
    title: "Retrieve From SQL",
    description: "Run a read-only query against PostgreSQL or SQLite. The column holding structures is detected by name, then by its values.",
    needsStructure: false,
    supportsSearchMode: false,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "collection",
    defaultRecords: 5000,
    needsSql: true,
  },
  "building-blocks": {
    provider: "building-blocks",
    title: "Search Building Blocks",
    description: "Commercially available building blocks from the datawarrior.org catalogue service.",
    needsStructure: true,
    supportsSearchMode: true,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "collection",
    defaultRecords: 500,
    needsCatalogueFilters: true,
  },
  chemspace: {
    provider: "chemspace",
    title: "Search ChemSpace",
    description: "The ChemSpace catalogue. Needs an API key from ChemSpace, which is kept in your login keychain.",
    needsStructure: true,
    supportsSearchMode: true,
    textLabel: null,
    textPlaceholder: "",
    fields: [],
    delivery: "collection",
    defaultRecords: 200,
    needsApiKey: true,
    hasBrowserFallback: true,
  },
  patents: {
    provider: "patents",
    title: "Search Google Patents",
    description: "Patent documents matching a query. Google's search interface is undocumented, so this search can always be handed to a browser instead.",
    needsStructure: false,
    supportsSearchMode: false,
    textLabel: "Query",
    textPlaceholder: "aspirin derivatives",
    fields: [],
    delivery: "collection",
    defaultRecords: 100,
    hasBrowserFallback: true,
  },
  wikipedia: {
    provider: "wikipedia",
    title: "Retrieve Wikipedia Molecules",
    description: "Molecules extracted from Wikipedia chemistry pages. Leave the filter empty to retrieve them all.",
    needsStructure: false,
    supportsSearchMode: false,
    textLabel: "Name contains",
    textPlaceholder: "all molecules",
    fields: [],
    delivery: "collection",
    defaultRecords: 2000,
  },
};

export function databaseProviderDescriptor(provider: DatabaseProvider) {
  return DATABASE_PROVIDERS[provider];
}

/**
 * The keychain account a connection's password is filed under. Derived from the
 * connection rather than asked for separately, so the same server keeps the same
 * entry, and short enough for the keychain account limit.
 */
export function sqlSecretAccount(connection: string) {
  const trimmed = connection.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const user = decodeURIComponent(url.username);
    const database = url.pathname.replace(/^\//u, "");
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    // The password is never part of the account name, even when the user pasted a
    // URL that carried one.
    return `${user ? `${user}@` : ""}${host}${database ? `/${database}` : ""}`.slice(0, 128);
  } catch {
    return trimmed.slice(0, 128);
  }
}

/** The address that answers the same query in a browser, or null when there is none. */
export async function databaseBrowserUrl(request: DatabaseQueryRequest) {
  return invoke<string | null>("database_browser_url", { request });
}

export async function storeDatabaseSecret(account: string, secret: string) {
  await invoke("database_store_secret", { account, secret });
}

export async function databaseSecretStatus(account: string) {
  return invoke<boolean>("database_secret_status", { account });
}

export async function forgetDatabaseSecret(account: string) {
  return invoke<boolean>("database_forget_secret", { account });
}

export async function runDatabaseSearch(
  request: DatabaseQueryRequest,
  preferences: ViewerPreferences,
): Promise<DatabaseSearchResult> {
  return invoke<DatabaseSearchResult>("database_search", { request, preferences });
}

export function databaseResultSummary(result: DatabaseSearchResult) {
  if (result.recordCount === 0) return `${result.provider} returned no matches`;
  const rows = `${result.recordCount.toLocaleString()} record${result.recordCount === 1 ? "" : "s"}`;
  return `${result.provider}: ${rows}`;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BURETTE_DEV_INSTANCE?: string;
  readonly VITE_BURETTE_BUILD_CHANNEL?: string;
  readonly VITE_BURETTE_BUILD_FLAVOR?: string;
  readonly VITE_BURETTE_BUILD_IDENTIFIER?: string;
  readonly VITE_BURETTE_AGENT_SHELL?: string;
  readonly VITE_BURETTE_WEB_ASSETS_BASE?: string;
  readonly BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT?: string;
  readonly BURETTE_GRID_PERF_REPORT_PATH?: string;
  readonly BURETTE_REPO_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BURETTE_HOSTED_MCP_BRIDGE_READY__?: boolean;
  __BURETTE_HOSTED_MCP_RESULTS__?: unknown[];
  __BURETTE_HOSTED_MCP_WIDGET__?: boolean;
  __BURETTE_HOSTED_KETCHER_WIDGET__?: boolean;
  __BURETTE_HOSTED_KETCHER_SEED__?: {
    surfaceId?: string;
    format: "ket" | "mol" | "rxn" | "smiles";
    content: string;
  } | null;
  BuretteHostedAppBridge?: {
    ready: Promise<boolean>;
    setSource: (source: unknown) => void;
    updateSelection: (selection: unknown, documentId: string) => Promise<boolean>;
    updateScene: (report: unknown) => Promise<boolean>;
    callServerTool: (
      name: string,
      arguments_?: Record<string, unknown>,
    ) => Promise<unknown>;
    sanitizeViewerActions: (actions: unknown) => Record<string, unknown>[];
  };
  __BURETTE_HOSTED_APP_QUEUE__?: Array<{ method: string; args: unknown[] }>;
  __BURETTE_HOSTED_APP_READY__?: (ready: boolean) => void;
  __BURETTE_WEB_ASSETS_BASE__?: string;
  __BURETTE_BOOT_OVERLAY__?: {
    report: (message: string, details?: string) => void;
    markMounted: () => void;
  };
  openai?: {
    toolOutput?: unknown;
    toolResponseMetadata?: unknown;
  };
}

declare module "raphael" {
  const raphael: unknown;
  export default raphael;
}

declare module "eve-raphael" {
  const eve: unknown;
  export default eve;
}

declare module "ketcher-standalone/dist/binaryWasm" {
  export * from "ketcher-standalone";
}

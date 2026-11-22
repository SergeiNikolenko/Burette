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
  /** Set by the native shell on a fresh install's first window, held back for the opening. */
  __BURETTE_INTRO__?: boolean;
  __BURETTE_HOSTED_MCP_BRIDGE_READY__?: boolean;
  __BURETTE_HOSTED_MCP_RESULTS__?: unknown[];
  __BURETTE_HOSTED_OPENAI_GLOBALS__?: { toolOutput?: unknown; toolResponseMetadata?: unknown };
  __BURETTE_HOSTED_MCP_WIDGET__?: boolean;
  __BURETTE_HOSTED_KETCHER_WIDGET__?: boolean;
  /** Mounts Burette frames as same-origin srcdoc documents in hosted widgets. */
  BuretteHostedFrameTransport?: import("../public/molecular-frame/molecular-frame.js").MolecularFrameTransport;
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
    theme?: "light" | "dark";
    backgrounds?: { light: string; dark: string };
    entrypoint?: "global" | "thread" | "file";
    /** Present in a workspace the user opened beside the conversation. */
    home?: import("./lib/native-mcp-workspace").NativeWorkspaceHome;
  };
  __BURETTE_HOSTED_APP_QUEUE__?: Array<{ method: string; args: unknown[] }>;
  __BURETTE_HOSTED_APP_READY__?: (ready: boolean) => void;
  __BURETTE_WEB_ASSETS_BASE__?: string;
  __BURETTE_HOSTED_ANALYTICS_ORIGIN__?: string;
  __BURETTE_BOOT_OVERLAY__?: {
    report: (message: string, details?: string) => void;
    markMounted: () => void;
  };
  openai?: {
    toolOutput?: unknown;
    toolResponseMetadata?: unknown;
    theme?: "light" | "dark";
    surfaceBackgroundColor?: string;
    displayMode?: string;
    safeArea?: { insets?: { top?: number; right?: number; bottom?: number; left?: number } };
    userAgent?: { device?: { type?: string } };
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

declare module "*?url&no-inline" {
  const url: string;
  export default url;
}

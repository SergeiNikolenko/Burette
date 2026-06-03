/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BURETTE_DEV_INSTANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __BURRETE_BOOT_OVERLAY__?: {
    report: (message: string, details?: string) => void;
    markMounted: () => void;
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

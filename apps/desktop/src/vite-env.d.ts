/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BURETTE_DEV_INSTANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "raphael" {
  const raphael: unknown;
  export default raphael;
}

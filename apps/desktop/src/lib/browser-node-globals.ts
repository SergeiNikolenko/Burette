type BrowserProcess = {
  env?: Record<string, string | undefined>;
  noDeprecation?: boolean;
  throwDeprecation?: boolean;
  traceDeprecation?: boolean;
  pid?: number;
};

const browserGlobal = globalThis as unknown as Record<string, unknown>;

browserGlobal.global ??= globalThis;
browserGlobal.process ??= { env: {} };

const browserProcess = browserGlobal.process as BrowserProcess;
browserProcess.env ??= {};

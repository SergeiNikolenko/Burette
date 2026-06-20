import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

const DOCTOR_SCHEMA = "burrete.external-runtime-doctor.v1";

type RuntimeStatusPayload = Record<string, unknown>;

type BrowserDevRuntimeDoctorRoutes = {
  conformerStatus: () => Promise<RuntimeStatusPayload>;
  descriptorStatus: () => Promise<RuntimeStatusPayload>;
  schrodingerStatus: () => RuntimeStatusPayload;
  xtbStatus: () => Promise<RuntimeStatusPayload>;
  xyzrenderStatus: () => RuntimeStatusPayload;
};

export async function browserDevRuntimeDoctorReport(routes: BrowserDevRuntimeDoctorRoutes) {
  const [descriptorStatus, conformerStatus, xtbStatus] = await Promise.all([
    routes.descriptorStatus(),
    routes.conformerStatus(),
    routes.xtbStatus(),
  ]);
  const xyzrenderStatus = routes.xyzrenderStatus();
  const schrodingerStatus = routes.schrodingerStatus();

  return {
    schema: DOCTOR_SCHEMA,
    runtime: "browser-dev",
    checks: [
      checkFromPayload("xyzrender", "xyzrender", "external-renderer", xyzrenderStatus, "installed", "executablePath"),
      checkFromPayload("descriptors-python", "Descriptor Python", "python-runtime", descriptorStatus, "available", "pythonPath"),
      checkFromPayload("crest", "CREST", "conformer-tool", payloadObject(conformerStatus.crest), "installed", "executable"),
      checkFromPayload("prism", "PRISM Pruner", "conformer-tool", payloadObject(conformerStatus.prism), "installed", "executable"),
      checkFromPayload("xtb", "xTB", "semiempirical-tool", xtbStatus, "installed", "executablePath"),
      checkFromPayload("schrodinger", "Schrodinger", "external-suite", schrodingerStatus, "installed", "executablePath"),
    ],
  };
}

export function registerBrowserDevRuntimeDoctorRoute(server: ViteDevServer, routes: BrowserDevRuntimeDoctorRoutes) {
  server.middlewares.use("/__burette/external-runtime-doctor", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
      return;
    }
    try {
      sendJson(res, 200, await browserDevRuntimeDoctorReport(routes), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}

function checkFromPayload(
  id: string,
  label: string,
  kind: string,
  payload: RuntimeStatusPayload,
  availabilityField: string,
  pathField: string,
) {
  const executablePath = textField(payload[pathField]);
  const source = textField(payload.source) ?? (executablePath ? sourceForPath(executablePath) : null);
  const version = textField(payload.version) ?? textField(payload.rdkitVersion) ?? textField(payload.mordredVersion);
  const available = payload[availabilityField] === true;
  return {
    id,
    label,
    kind,
    available,
    source,
    executablePath,
    version,
    message: textField(payload.message) ?? `${label} is ${available ? "available" : "unavailable"}`,
    installHint: textField(payload.installHint),
    details: payload,
  };
}

function payloadObject(value: unknown): RuntimeStatusPayload {
  return value && typeof value === "object" ? value as RuntimeStatusPayload : {};
}

function textField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sourceForPath(path: string) {
  if (path.includes("xyzrender-runtime")) return "bundled";
  if (path.includes(".local/bin") || path.includes(".local/share")) return "user-local";
  if (path.includes("/opt/") || path.includes("/usr/local/") || path.includes("/opt/homebrew/")) return "system";
  return "resolved-path";
}

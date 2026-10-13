import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { ViteDevServer } from "vite";
import { validatePdbMolecule, validatePdbConversion } from "../../src/lib/pdb-chemistry";
import { readJsonBody, sendJson, sendJsonError } from "./http";

export async function prepareKetcherPdb(text: string) {
  validatePdbMolecule(text);
  const executable = ["/opt/homebrew/bin/obabel", "/usr/local/bin/obabel"].find(existsSync) ?? "obabel";
  const sdf = await new Promise<string>((resolve, reject) => {
    const child = execFile(executable, ["-ipdb", "-osdf"], { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error || /failed|error|cannot|could not/iu.test(stderr)) {
        reject(new Error(error && "code" in error && error.code === "ENOENT"
          ? "Install Open Babel to reconstruct bonds from PDB, or open the original SDF."
          : "Could not reconstruct molecule bonds. Open the original SDF."));
      } else resolve(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
  });
  return validatePdbConversion(text, sdf);
}

export function registerBrowserDevKetcherPdbRoute(server: ViteDevServer) {
  server.middlewares.use("/__burette/prepare-ketcher-pdb", async (req, res) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    try {
      const body = await readJsonBody(req, 1024 * 1024);
      if (typeof body.text !== "string") throw new Error("PDB text is required.");
      sendJson(res, 200, { text: await prepareKetcherPdb(body.text) });
    } catch (error) { sendJsonError(res, 400, error); }
  });
}

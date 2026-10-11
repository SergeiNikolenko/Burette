import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { ViteDevServer } from "vite";
import { readJsonBody, sendJson, sendJsonError } from "./http";

const exec = promisify(execFile);
type Request = { operation: string; path: string; name?: string };

export async function operateBrowserSidebarFile(request: Request, allowed: (path: string) => boolean | string) {
  const { operation, path, name } = request;
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Choose a local file or folder.");
  const source = await realpath(path);
  const info = await lstat(path);
  const destinationDirectory = operation === "createFolder" ? source : await realpath(dirname(source));
  if (info.isSymbolicLink() || !allowed(source) || !allowed(destinationDirectory)) throw new Error("This path cannot be changed here.");
  const folder = operation === "renameFolder" || operation === "trashFolder" || operation === "createFolder";
  if (folder ? !info.isDirectory() : !info.isFile()) throw new Error("The file type has changed. Refresh the folder.");
  if (operation === "trash" || operation === "trashFolder") {
    // Use the macOS recovery mechanism; never fall back to permanent deletion.
    if (process.platform !== "darwin") throw new Error("Move to Trash is available in the desktop app.");
    await exec("/usr/bin/trash", [source]);
    return null;
  }
  if (operation === "duplicate") {
    const extension = extname(source);
    const stem = basename(source, extension);
    for (let index = 1; index <= 100; index++) {
      const output = join(dirname(source), `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`);
      try { await copyFile(source, output, constants.COPYFILE_EXCL); return output; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    throw new Error("Choose another name for the copy.");
  }
  if (!["rename", "renameFolder", "createFolder"].includes(operation)) throw new Error("Unsupported file operation.");
  if (!name || name.trim() !== name || /[/\\\0:]/.test(name) || name === "." || name === "..") throw new Error("Enter a name without path separators.");
  const output = join(operation === "createFolder" ? source : dirname(source), name);
  if (output === source) return source;
  if (operation === "createFolder") await mkdir(output);
  else {
    try { await lstat(output); throw new Error("An item with this name already exists."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // -n also protects against a destination appearing after the check.
    await exec("/bin/mv", ["-n", source, output]);
    try { await lstat(source); throw new Error("The item was not moved. Refresh the folder."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return output;
}

export function registerBrowserSidebarFileOperations(server: ViteDevServer, allowed: (path: string) => boolean | string) {
  server.middlewares.use("/__burette/sidebar-file-operation", async (req, res) => {
    if (req.method !== "POST" || !req.headers["content-type"]?.startsWith("application/json")) {
      sendJson(res, 405, { error: "A JSON POST request is required." }); return;
    }
    try { sendJson(res, 200, { path: await operateBrowserSidebarFile(await readJsonBody(req, 8192), allowed) }); }
    catch (error) { sendJsonError(res, 400, error); }
  });
}

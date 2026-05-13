import * as tauri from "../../lib/tauri";

const COPY_SUFFIX = " copy";

function parentDir(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

function fileStem(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

function fileExtension(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

async function fileExists(path: string) {
  return tauri.fileExists(path);
}

async function resolveDuplicatePath(sourcePath: string) {
  const parent = parentDir(sourcePath);
  const stem = fileStem(sourcePath);
  const extension = fileExtension(sourcePath);

  const first = `${parent}/${stem}${COPY_SUFFIX}${extension}`;
  if (!(await fileExists(first))) return first;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${parent}/${stem}${COPY_SUFFIX} ${index}${extension}`;
    if (!(await fileExists(candidate))) return candidate;
  }

  throw new Error(`Could not find an available duplicate name for ${sourcePath}`);
}

export async function duplicateFile(sourcePath: string) {
  const targetPath = await resolveDuplicatePath(sourcePath);
  await tauri.duplicateEntry(sourcePath, targetPath);
  return targetPath;
}

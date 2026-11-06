import { normalizeElement, ScienceSessionError, SCIENCE_SESSION_LIMITS, type ScienceSessionErrorCode } from "./contracts";
import { readGraphSource } from "./graph-source";
import { periodicCrystalFormat, readCrystalView, writeExtendedXyz } from "../molecular-workbench/crystal-io";

/** CIF and POSCAR (`vasp`) are crystal sources: the scene shows their full cell as extended XYZ. */
export type CrystalSceneExtension = "cif" | "vasp";
export type SceneSourceExtension = "xyz" | "sdf" | "mol" | CrystalSceneExtension;
export const isCrystalSceneExtension = (extension: string): extension is CrystalSceneExtension => extension === "cif" || extension === "vasp";

function fail(code: ScienceSessionErrorCode, message: string): never {
  throw new ScienceSessionError(code, message);
}

export type XyzFrame = { elements: string[]; positions: Float64Array };

/** Frames of an XYZ (single or multi-frame) source; extended columns after x y z are ignored. */
export function readXyzFrames(text: string): XyzFrame[] {
  if (text.length > SCIENCE_SESSION_LIMITS.sourceBytes || new TextEncoder().encode(text).byteLength > SCIENCE_SESSION_LIMITS.sourceBytes) fail("source", "The scene source exceeds 16 MiB.");
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const frames: XyzFrame[] = [];
  let line = 0;
  while (line < lines.length) {
    if (!lines[line].trim()) { line++; continue; }
    const count = Number(lines[line].trim());
    if (!Number.isInteger(count) || count < 1 || count > SCIENCE_SESSION_LIMITS.atoms) fail("source", "The scene source is not an XYZ structure.");
    if (frames.length >= SCIENCE_SESSION_LIMITS.frames) fail("limit", "The scene source has more than 2,000 frames.");
    if (line + 2 + count > lines.length) fail("source", "The scene source ends inside an XYZ frame.");
    const elements: string[] = [];
    const positions = new Float64Array(count * 3);
    for (let atom = 0; atom < count; atom++) {
      const fields = lines[line + 2 + atom].trim().split(/\s+/u);
      const element = normalizeElement(fields[0] ?? "");
      const xyz = fields.slice(1, 4).map(Number);
      if (!element || xyz.length !== 3 || !xyz.every(Number.isFinite)) fail("source", `XYZ atom ${atom + 1} is invalid.`);
      elements.push(element as string);
      positions.set(xyz, atom * 3);
    }
    if (frames.length && (elements.length !== frames[0].elements.length || elements.some((element, index) => element !== frames[0].elements[index]))) {
      fail("source", "The scene source changes its atoms between frames.");
    }
    frames.push({ elements, positions });
    line += 2 + count;
  }
  if (!frames.length) fail("source", "The scene source has no atoms.");
  return frames;
}

/** Graph sources have one frame; XYZ retains its existing multi-frame contract. */
export function readSceneSourceFrames(text: string, extension: Exclude<SceneSourceExtension, CrystalSceneExtension> = "xyz"): XyzFrame[] {
  if (extension === "sdf" || extension === "mol") return [readGraphSource(text, extension)];
  if (extension === "xyz") return readXyzFrames(text);
  return fail("source", "The scene source format is unsupported.");
}

/**
 * The text and format the scene shows for a source. A crystal is shown as the extended XYZ
 * of its full cell, written exactly as the viewer receives it (see crystal-preview).
 */
export async function shownSceneSource(text: string, extension: SceneSourceExtension): Promise<{ text: string; extension: Exclude<SceneSourceExtension, CrystalSceneExtension> }> {
  if (!isCrystalSceneExtension(extension)) return { text, extension };
  const format = periodicCrystalFormat(extension, text);
  if (format !== extension) fail("source", "The scene source is not a crystal.");
  let view;
  try { view = await readCrystalView({ format, text }); }
  catch (error) { return fail("source", `The crystal source cannot be read: ${error instanceof Error ? error.message : String(error)}`); }
  return { text: writeExtendedXyz(view.atoms, view.cell, view.title), extension: "xyz" };
}

/** Frames of a source as the scene shows them. */
export async function sceneSourceFrames(text: string, extension: SceneSourceExtension) {
  const shown = await shownSceneSource(text, extension);
  return readSceneSourceFrames(shown.text, shown.extension);
}

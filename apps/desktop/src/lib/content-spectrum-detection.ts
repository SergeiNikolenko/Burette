import { pathExtension } from "./file-routing";
import { isSubformulaSpectrumJsonText, isTabularSpectrumExtension, isTabularSpectrumText } from "./spectrum";
import { readStructureText } from "./structure-text";

export async function detectContentSpectrumPaths(paths: string[]) {
  const matches = new Set<string>();
  await Promise.all(paths.map(async (path) => {
    const extension = pathExtension(path);
    const canDetectByContent = isTabularSpectrumExtension(extension) || extension === "json";
    if (!canDetectByContent) return;
    try {
      const text = await readStructureText(path, { maxBytes: 256 * 1024 });
      if (
        (isTabularSpectrumExtension(extension) && isTabularSpectrumText(text, extension))
        || (extension === "json" && isSubformulaSpectrumJsonText(text))
      ) {
        matches.add(path);
      }
    } catch {}
  }));
  return matches;
}

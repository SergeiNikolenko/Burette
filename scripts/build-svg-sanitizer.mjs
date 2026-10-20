import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("scripts/svg-sanitizer-entry.js", root))],
  target: "browser", format: "iife", minify: true,
});
if (!result.success) throw new Error(result.logs.join("\n"));
await Bun.write(fileURLToPath(new URL("PreviewExtension/Web/svg-sanitizer.js", root)), result.outputs[0]);
await copyFile(new URL("node_modules/dompurify/LICENSE", root), new URL("PreviewExtension/Web/svg-sanitizer.LICENSE", root));

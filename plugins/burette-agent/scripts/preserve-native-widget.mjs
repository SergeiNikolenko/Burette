import { existsSync } from "node:fs";
import path from "node:path";

// Capability checks deliberately do not compare semver: the recovered local
// build uses build metadata, which does not affect semver precedence.
export function preserveNativeWidget(sourceRoot, installedRoot) {
  if (!existsSync(path.join(installedRoot, "assets/native-workspace.html"))) return;

  const required = [
    "assets/native-workspace.html",
    "assets/native-workspace/manifest.json",
    "assets/local-viewer.html",
    "mcp/registrations/local-viewer/register.mjs",
    "scripts/mcp-app-session.mjs",
  ];
  const missing = required.filter(file => !existsSync(path.join(sourceRoot, file)));
  if (missing.length) {
    throw new Error(
      `Refusing to replace the installed native Burette widget with a bundle missing: ${missing.join(", ")}. ` +
      "Nothing has been changed. See docs/local-widget-recovery.md for the pinned native-widget source.",
    );
  }
}

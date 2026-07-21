#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [componentsJson, styles, portalContainer, alertDialog, desktopTsconfig, rootTsconfig] = await Promise.all([
  readFile("apps/desktop/components.json", "utf8"),
  readFile("apps/desktop/src/styles.css", "utf8"),
  readFile("apps/desktop/src/components/ui/portal-container.ts", "utf8"),
  readFile("apps/desktop/src/components/ui/alert-dialog.tsx", "utf8"),
  readFile("apps/desktop/tsconfig.json", "utf8"),
  readFile("tsconfig.json", "utf8"),
]);

const components = JSON.parse(componentsJson);
assert.equal(components.style, "radix-nova");
assert.equal(components.rsc, false);
assert.equal(components.iconLibrary, "hugeicons");
assert.equal(components.tailwind.css, "src/styles.css");
assert.equal(components.aliases.ui, "@/components/ui");
assert.equal(components.aliases.utils, "@/lib/utils");

const tsconfig = JSON.parse(desktopTsconfig);
assert.equal(tsconfig.extends, "../../tsconfig.json");
const sharedTsconfig = JSON.parse(rootTsconfig);
assert.deepEqual(sharedTsconfig.compilerOptions.paths["@/*"], ["./apps/desktop/src/*"]);

assert.match(styles, /@import "tailwindcss";/);
assert.match(styles, /@import "shadcn\/tailwind\.css";/);
assert.match(styles, /\.app-shell\[data-effective-theme="dark"\]/);
assert.match(styles, /--shadcn-background: var\(--surface-primary\);/);
assert.match(styles, /--shadcn-ring: var\(--focus-ring\);/);
assert.match(styles, /--shadcn-disabled-opacity: 0\.48;/);

assert.match(portalContainer, /document\.querySelector<HTMLElement>\("\.app-shell"\)/);
assert.match(alertDialog, /useAppShellPortalContainer/);
assert.match(alertDialog, /container=\{container \?\? appShellContainer\}/);

console.log("shadcn foundation contract tests passed");

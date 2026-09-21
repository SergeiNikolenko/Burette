#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  matrixSource,
  testingSurfaces,
  scriptsReadme,
  quickLookSmoke,
  sampleQuickLookSmoke,
  nightlySmokeWorkflow,
  agentCli,
  mobileScreen,
  mobileRuntime,
  mobileWebView,
  mobileReadme,
  mobileInfo,
  appMetadata,
  previewInfo,
] = await Promise.all([
  source("samples/preview-matrix.json"),
  source("docs/tools/testing-surfaces.md"),
  source("scripts/README.md"),
  source("scripts/quicklook-preview-smoke.sh"),
  source("scripts/smoke-samples-quicklook.sh"),
  source(".github/workflows/nightly-smoke.yml"),
  source("scripts/burette-agent.mjs"),
  source("ios/BuretteMobile/MobilePreviewScreen.swift"),
  source("ios/BuretteMobile/MobilePreviewRuntime.swift"),
  source("ios/BuretteMobile/MobilePreviewWebView.swift"),
  source("ios/BuretteMobile/README.md"),
  source("ios/BuretteMobile/Info.plist"),
  source("apps/desktop/src-tauri/AppMetadata.plist"),
  source("PreviewExtension/Info.plist"),
]);

const matrix = JSON.parse(matrixSource);
const surfaceDocs = `${testingSurfaces}\n${scriptsReadme}\n${mobileReadme}`;
const documentedSurfacePatterns = {
  "browser-dev-shell": /browser-dev-shell|Full Browser Shell/i,
  "browser-quicklook": /Browser Quick Look/i,
  "agent-preview": /agent-preview|Tokenized Browser Preview/i,
  "packaged-desktop": /packaged app|desktop app/i,
  "native-quicklook": /Native Finder Quick Look|Quick Look smoke/i,
  "ios-mobile": /iOS|iPhone|BuretteMobile/i,
};

for (const surface of matrix.surfaces) {
  assert.match(surfaceDocs, documentedSurfacePatterns[surface], `${surface} must be documented`);
}
assert.match(testingSurfaces, /quickLookFile=<absolute path>/);
assert.match(testingSurfaces, /BURETTE_DEV_FS_ALLOW/);
assert.match(testingSurfaces, /BURETTE_DEV_FLAVOR=<worktree-slug> \.\/scripts\/build\.sh/);
assert.match(testingSurfaces, /smoke-samples-quicklook\.sh samples/);
assert.match(scriptsReadme, /Packaged App And Quick Look/);
assert.match(scriptsReadme, /smoke-samples-quicklook\.sh` enumerates a samples directory/);

for (const smokePath of matrix.smokeSets.nativeQuickLookFocused) {
  assert.match(`${quickLookSmoke}\n${sampleQuickLookSmoke}\n${nightlySmokeWorkflow}`, new RegExp(smokePath.replaceAll("/", "\\/")));
}
assert.match(quickLookSmoke, /validate_stability_artifacts\(\)/);
assert.match(quickLookSmoke, /manifest\.json/);
assert.match(quickLookSmoke, /preview-trace\.jsonl/);
assert.match(sampleQuickLookSmoke, /preview-content-type\.mjs/);
assert.match(sampleQuickLookSmoke, /BURETTE_DEV_FLAVOR is required/);
assert.match(sampleQuickLookSmoke, /fd -t f \. "\$SAMPLES_DIR" \| sort/);
assert.match(sampleQuickLookSmoke, /while IFS= read -r sample_file/);
assert.match(sampleQuickLookSmoke, /quicklook-semantic-check\.mjs/);
assert.match(sampleQuickLookSmoke, /semantic_status/);
assert.match(sampleQuickLookSmoke, /SKIP\\t/);
assert.doesNotMatch(sampleQuickLookSmoke, /--reject-table/);

assert.match(agentCli, /browser-dev-shell/);
assert.match(agentCli, /browser-preview/);
assert.match(agentCli, /processId/);
assert.match(agentCli, /sessionDir/);
assert.match(agentCli, /spawn\('vp', \['dev', 'apps\/desktop'/);
assert.match(agentCli, /'--strictPort'/);
assert.match(agentCli, /'apps\/desktop\/vite\.config\.ts'/);

assert.match(mobileScreen, /\.onOpenURL \{ url in\s*openImportedDocument\(from: url\)/);
assert.match(mobileScreen, /\.fileImporter\(/);
assert.match(mobileScreen, /openImportedDocument\(from: url\)/);
assert.match(mobileScreen, /MobileRDKitMoleculeView/);
assert.match(mobileRuntime, /case "xyzr":/);
assert.match(mobileRuntime, /preview-data\.js/);
assert.match(mobileRuntime, /window\.BuretteDataBase64/);
assert.match(mobileWebView, /WKUserContentController/);
assert.match(mobileWebView, /WKScriptMessageHandler/);
assert.match(mobileWebView, /configuration\.websiteDataStore = \.nonPersistent\(\)/);
assert.match(mobileWebView, /webView\.isInspectable = true/);
assert.match(mobileReadme, /Build and install the signed app on a real iPhone/);
assert.match(mobileReadme, /Open an SDF document and confirm grid\/table thumbnails render through RDKit/);

for (const plist of [mobileInfo, appMetadata]) {
  assert.match(plist, /Molecular grid tables/);
  assert.match(plist, /com\.local\.burette10\.xyzrender-input/);
  assert.match(plist, /sdf/);
  assert.match(plist, /xyzr/);
}
assert.match(previewInfo, /com\.apple\.quicklook\.preview/);
assert.match(previewInfo, /QLSupportedContentTypes/);

console.log("cross-platform preview contract tests passed");

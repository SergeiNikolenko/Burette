#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, nativeMenuHook, sourceEditingHook, sourceEditingContext] = await Promise.all([
  readFile("apps/desktop/src/App.tsx", "utf8"),
  readFile("apps/desktop/src/hooks/use-app-native-menu.ts", "utf8"),
  readFile("apps/desktop/src/hooks/use-source-editing.ts", "utf8"),
  readFile("apps/desktop/src/lib/source-editing/context.tsx", "utf8"),
]);

const closeListenerCount = [nativeMenuHook, sourceEditingHook]
  .flatMap((source) => [...source.matchAll(/\.onCloseRequested\(/gu)])
  .length;
assert.equal(closeListenerCount, 1, "the window must have exactly one close coordinator");
assert.doesNotMatch(sourceEditingHook, /getCurrentWindow|\.onCloseRequested\(/u);
assert.match(sourceEditingHook, /const commitSessions = useCallback[\s\S]*sessionsRef\.current = next;[\s\S]*setSessions\(next\)/u);
assert.match(sourceEditingHook, /const getWindowDirtySnapshot = useCallback[\s\S]*revision: session\.revision[\s\S]*dirty: session\.dirty[\s\S]*saving: session\.saving \|\| savingPathsRef\.current\.has\(session\.path\)/u);
assert.match(sourceEditingHook, /closeTransitionActive: unsafeSessions\.some\(\(session\) => session\.saving\)/u);
assert.match(sourceEditingHook, /const confirmCloseWindow = useCallback[\s\S]*if \(savingCount > 0\)[\s\S]*return false;[\s\S]*if \(dirtyCount === 0\) return true;/u);
assert.match(sourceEditingHook, /if \(!hasUnsavedOrSavingSessions \|\| isTauriRuntime\(\)\) return undefined;/u);
assert.match(sourceEditingContext, /confirmCloseWindow: \(\) => Promise<boolean>/u);
assert.match(sourceEditingContext, /getWindowDirtySnapshot: \(\) => SourceEditingWindowDirtySnapshot/u);

// Unsaved-changes protection on quit now lives entirely in the Rust exit
// preflight, which reads this combined dirty snapshot; the window-close button
// no longer runs its own confirm.
assert.match(app, /dirty: gridSnapshot\.dirty \|\| sourceSnapshot\.dirty/u);
assert.match(app, /closeTransitionActive: sourceSnapshot\.closeTransitionActive/u);
assert.match(app, /windowDocumentDirty: hasDirtyGridDocuments \|\| sourceEditing\.hasUnsavedOrSavingSessions/u);

assert.match(nativeMenuHook, /canSave: sourceSaveEnabled\s*\|\| Boolean\(isGrid/u);
assert.match(nativeMenuHook, /case "file\.save":\s*if \(sourceSaveEnabled\) await saveActiveSource\(\);\s*else gridCommand\(\);/su);
assert.match(nativeMenuHook, /closeTransitionActive: snapshot\.closeTransitionActive\s*\|\| barrier\.closeTransitionActive/su);
// The close button quits the app through the shared quit command.
assert.match(nativeMenuHook, /onCloseRequested\(\(event\) => \{[\s\S]*event\.preventDefault\(\);\s*void invoke\("request_app_quit"\)/su);

console.log("source editing window lifecycle tests passed");

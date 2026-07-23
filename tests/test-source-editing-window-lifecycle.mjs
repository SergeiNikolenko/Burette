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

assert.match(app, /const confirmCloseWindow = useCallback[\s\S]*sourceEditing\.confirmCloseWindow\(\)[\s\S]*confirmDiscardAllDirtyGridDocuments\(\)[\s\S]*try \{[\s\S]*return permit;[\s\S]*catch \(error\) \{\s*permit\.release\(\);/u);
assert.match(app, /dirty: gridSnapshot\.dirty \|\| sourceSnapshot\.dirty/u);
assert.match(app, /closeTransitionActive: sourceSnapshot\.closeTransitionActive/u);
assert.match(app, /windowDocumentDirty: hasDirtyGridDocuments \|\| sourceEditing\.hasUnsavedOrSavingSessions/u);

assert.match(nativeMenuHook, /canSave: sourceSaveEnabled\s*\|\| Boolean\(isGrid/u);
assert.match(nativeMenuHook, /case "file\.save":\s*if \(sourceSaveEnabled\) await saveActiveSource\(\);\s*else gridCommand\(\);/su);
assert.match(nativeMenuHook, /closeTransitionActive: snapshot\.closeTransitionActive\s*\|\| barrier\.closeTransitionActive/su);
// A failed close must hand the permit back, otherwise the next one is refused.
assert.match(nativeMenuHook, /catch \(error\) \{\s*closingWindowRef\.current = false;\s*permit\?\.release\(\);/u);

console.log("source editing window lifecycle tests passed");

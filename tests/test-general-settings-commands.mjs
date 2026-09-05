import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../apps/desktop/src/components/settings-panel/index.tsx";
import { buildShellCommands } from "../apps/desktop/src/lib/shell-commands.ts";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store.ts";
const called = [];
const actions = new Proxy({}, { get: (_, name) => () => called.push(name) });
const state = { documents: [], tabs: [], recentStructures: [], preferences: defaultPreferences, update: { preferences: { checkAutomatically: true, channel: "stable" } } };
const html = renderToStaticMarkup(React.createElement(SettingsPanel, { location: { kind: "settings", section: "general" }, state, actions }));
assert.doesNotMatch(html, /Choose Files|Close All|Most recent structure/);
const commands = buildShellCommands(state, actions, "");
for (const id of ["open-structure", "open-recent", "close-all"]) {
  const command = commands.find(command => command.id === id);
  assert.ok(command, `document action ${id} stays available outside Settings`);
  command.run();
}
assert.deepEqual(called, ["chooseFiles", "openMostRecentStructure", "clearAllDocuments"]);
console.log("General settings command accessibility checks passed.");

#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  getKetcherAgentController,
  registerKetcherAgentController,
  subscribeKetcherAgentRegistry,
  unregisterKetcherAgentController,
} from "../apps/desktop/src/lib/ketcher-agent.ts";

let notifications = 0;
const unsubscribe = subscribeKetcherAgentRegistry(() => { notifications += 1; });
const editor = {
  getKet: async () => "",
  getMolfile: async () => "\n\n\n  0  0  0  0  0  0            999 V2000\nM  END\n",
  getSmiles: async () => "",
  setMolecule: async () => undefined,
  setMolfile: async () => undefined,
  subscribeChange: () => () => undefined,
};

const controller = registerKetcherAgentController("tab-registry", editor);
assert.equal(getKetcherAgentController("tab-registry"), controller);
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(controller.snapshot().phase, "ready");
assert.ok(notifications >= 2, "registration and ready transition must notify workspace observers");
unregisterKetcherAgentController("tab-registry", controller);
assert.equal(getKetcherAgentController("tab-registry"), null);
assert.ok(notifications >= 3);
unsubscribe();

console.log("Ketcher agent registry tests passed");

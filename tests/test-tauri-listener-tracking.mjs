#!/usr/bin/env node
import assert from 'node:assert/strict';
import { trackTauriListener } from '../apps/desktop/src/lib/tauri.ts';

const warnings = [];
const unhandled = [];
const originalWarn = console.warn;

function onUnhandled(reason) {
  unhandled.push(reason);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

try {
  console.warn = (...args) => {
    warnings.push(args);
  };
  process.on('unhandledRejection', onUnhandled);

  let resolveRegistration;
  let cleanupCalls = 0;
  const registration = new Promise((resolve) => {
    resolveRegistration = resolve;
  });
  const cleanup = trackTauriListener(registration, 'test-listener');
  cleanup();
  resolveRegistration(() => {
    cleanupCalls += 1;
    return Promise.reject(new Error('cleanup failed'));
  });
  await settle();

  assert.equal(cleanupCalls, 1);
  assert.equal(unhandled.length, 0);
  assert.ok(warnings.some((entry) => String(entry[0]).includes('test-listener listener cleanup failed')));

  trackTauriListener(Promise.reject(new Error('setup failed')), 'setup-listener');
  await settle();

  assert.equal(unhandled.length, 0);
  assert.ok(warnings.some((entry) => String(entry[0]).includes('setup-listener listener setup failed')));
} finally {
  process.off('unhandledRejection', onUnhandled);
  console.warn = originalWarn;
}

console.log('tauri listener tracking tests passed');

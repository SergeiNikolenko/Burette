#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class TestElement {
  constructor(document, tagName) {
    this.document = document;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parent = null;
    this.innerHTML = "";
    this.textContent = "";
    this.removed = false;
    this._id = "";
  }

  get id() {
    return this._id;
  }

  set id(value) {
    if (this._id) this.document.elements.delete(this._id);
    this._id = value;
    if (value) this.document.elements.set(value, this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    child.parent = this;
    child.removed = false;
    this.children.push(child);
    if (child.id) this.document.elements.set(child.id, child);
    return child;
  }

  remove() {
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
    if (this.id) this.document.elements.delete(this.id);
  }
}

function createHarness() {
  const listeners = new Map();
  const timeouts = [];
  const document = {
    elements: new Map(),
    appShellMounted: false,
    head: null,
    body: null,
    createElement(tagName) {
      return new TestElement(document, tagName);
    },
    getElementById(id) {
      return document.elements.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === ".app-shell" && document.appShellMounted) {
        return { className: "app-shell" };
      }
      return null;
    },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
  };
  document.head = new TestElement(document, "head");
  document.body = new TestElement(document, "body");
  const window = {
    document,
    setTimeout(callback) {
      timeouts.push(callback);
      return timeouts.length;
    },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
  };
  const context = vm.createContext({ document, window });
  return {
    context,
    document,
    dispatch(type, event) {
      for (const callback of listeners.get(type) ?? []) callback(event);
    },
    flushTimeouts() {
      for (const callback of [...timeouts]) callback();
    },
  };
}

const source = await readFile(new URL("../apps/desktop/public/boot-overlay.js", import.meta.url), "utf8");
const harness = createHarness();
vm.runInContext(source, harness.context);

assert.match(
  harness.document.getElementById("burette-boot-overlay")?.innerHTML ?? "",
  /Burette is starting/,
);

harness.dispatch("unhandledrejection", { reason: new Error("startup failed") });
assert.match(
  harness.document.getElementById("burette-boot-overlay")?.innerHTML ?? "",
  /Burette UI failed to start/,
);

harness.context.window.__BURETTE_BOOT_OVERLAY__.markMounted();
assert.equal(harness.document.getElementById("burette-boot-overlay"), null);

harness.document.appShellMounted = true;
harness.dispatch("unhandledrejection", { reason: new Error("late unregisterListener failure") });
harness.dispatch("error", { message: "late startup error", error: new Error("late startup error") });
harness.flushTimeouts();
assert.equal(harness.document.getElementById("burette-boot-overlay"), null);

console.log("boot overlay behavior tests passed");

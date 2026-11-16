import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { pickBrowserFiles } from "../apps/desktop/src/lib/browser-file-picker";

const browser = new Window({ url: "http://localhost/" });
const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
const originalClick = browser.HTMLInputElement.prototype.click;
const clicked: InstanceType<typeof browser.HTMLInputElement>[] = [];
browser.HTMLInputElement.prototype.click = function () { clicked.push(this); };
afterAll(async () => { browser.HTMLInputElement.prototype.click = originalClick; await browser.happyDOM.close(); if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
const select = (files: File[]) => {
  const input = clicked.at(-1)!;
  Object.defineProperty(input, "files", { value: files });
  input.dispatchEvent(new browser.Event("change"));
};

test("the chooser stays attached until selection and returns the selected immutable files", async () => {
  const pending = pickBrowserFiles({ accept: ".fchk,.molden", multiple: true });
  const input = clicked.at(-1)!;
  expect([input.isConnected, input.hidden, input.multiple, input.accept]).toEqual([true, true, true, ".fchk,.molden"]);
  const file = new File(["original"], "water.fchk"); select([file]);
  expect(await pending).toEqual([file]); expect(input.isConnected).toBe(false);
});

test("a new chooser retires the old pending one; cancel removes only the current chooser", async () => {
  const old = pickBrowserFiles(), oldInput = clicked.at(-1)!;
  const current = pickBrowserFiles({ directory: true }), input = clicked.at(-1)!;
  expect(await old).toEqual([]); expect(oldInput.isConnected).toBe(false);
  expect([input.isConnected, input.hasAttribute("webkitdirectory")]).toEqual([true, true]);
  input.dispatchEvent(new browser.Event("cancel")); expect(await current).toEqual([]); expect(input.isConnected).toBe(false);
});

test("a failed chooser click removes the input and a later chooser still succeeds", async () => {
  const click = browser.HTMLInputElement.prototype.click;
  browser.HTMLInputElement.prototype.click = function () { clicked.push(this); throw new Error("picker unavailable"); };
  try { await expect(pickBrowserFiles()).rejects.toThrow("picker unavailable"); expect(clicked.at(-1)!.isConnected).toBe(false); }
  finally { browser.HTMLInputElement.prototype.click = click; }
  const pending = pickBrowserFiles(); select([]); expect(await pending).toEqual([]);
});

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

export async function writeClipboardText(text: string) {
  if (isTauriRuntime()) {
    await invoke<void>("write_clipboard_text", { text });
    return;
  }
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    if (!copyTextWithSelectionFallback(text)) throw error;
    return;
  }
  if (!copyTextWithSelectionFallback(text)) throw new Error("Clipboard write is unavailable.");
}

export function copyTextWithSelectionFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

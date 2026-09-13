import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";
import { isKnownViewerMessageSource, postMessageToViewerSource } from "./viewer-bridge";

// This listener is installed only in the Mac desktop shell. Browser, iPhone and
// Quick Look viewers keep their own menus, even when they share viewer assets.
export function installNativeViewerMenus(): () => void {
  if (!isTauriRuntime() || !navigator.platform.startsWith("Mac")) return () => {};
  let active = false;
  const receive = async (event: MessageEvent) => {
    const body = event.data?.body;
    if (event.data?.source !== "burette-viewer" || !body || !isKnownViewerMessageSource(event.source, body.documentId)) return;
    const reply = (value: object) => postMessageToViewerSource(event.source, { source: "burette-native-menu", ...value });
    if (body.type === "nativeMenuReady") { reply({ kind: "available" }); return; }
    if (body.type !== "nativeMenuOpen" || typeof body.token !== "string" || body.token.length > 100) return;
    if (active) { reply({ kind: "fallback", token: body.token }); return; }
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>(".viewer-iframe[data-document-id]")).find(frame => frame.contentWindow === event.source);
    if (!frame || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return;
    active = true;
    const token = body.token;
    let finishControls: () => void = () => {};
    const finished = new Promise<void>(resolve => { finishControls = resolve; });
    const channel = new Channel<{ id: string; value: string | number | null; phase: "input" | "change" | "enter" | "leave" | "finished" }>();
    channel.onmessage = value => {
      if (value.phase === "finished") { finishControls(); return; }
      if (isKnownViewerMessageSource(event.source, body.documentId)) reply({ kind: "control", token, ...value });
    };
    try {
      const rect = frame.getBoundingClientRect();
      const result = await invoke<{ kind: "shown" | "unsupported"; selection?: string; controlsVersion?: number }>("popup_macos_context_menu", {
        items: body.items,
        at: { x: rect.left + body.x, y: rect.top + body.y },
        onControl: channel,
      });
      if (result.kind === "shown" && result.controlsVersion === 1) await finished;
      reply({ kind: result.kind === "shown" ? "closed" : "fallback", token, selection: result.selection });
    } catch {
      // A stale native binary or an unsupported control must never eat the menu.
      reply({ kind: "fallback", token });
    } finally { active = false; }
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}

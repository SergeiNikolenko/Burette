(function () {
  const overlayId = "burrete-boot-overlay";
  const styleId = "burrete-boot-overlay-style";
  const mountTimeoutMs = 3000;
  let pendingOverlay = null;
  let mounted = false;

  function whenBodyReady(callback) {
    if (document.body) {
      callback();
      return;
    }
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function ensureStyle() {
    if (document.getElementById(styleId)) return;
    if (!document.head) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${overlayId} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 28px;
        color: #f5f5f5;
        background: rgba(32, 32, 32, 0.78);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #${overlayId} .burrete-boot-card {
        width: min(720px, 100%);
        max-height: min(520px, 100%);
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        background: rgba(20, 20, 20, 0.88);
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.36);
        padding: 18px;
      }
      #${overlayId} h1 {
        margin: 0 0 8px;
        font-size: 16px;
        line-height: 1.25;
        font-weight: 700;
      }
      #${overlayId} p {
        margin: 0;
        color: rgba(245, 245, 245, 0.76);
      }
      #${overlayId} pre {
        margin: 14px 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: #ffd7d7;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (mounted) return null;
    if (!document.body) return null;
    ensureStyle();
    const existing = document.getElementById(overlayId);
    if (existing) return existing;
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = [
      '<section class="burrete-boot-card">',
      "<h1>Burrete is starting</h1>",
      "<p>Loading the desktop UI...</p>",
      "</section>",
    ].join("");
    document.body.appendChild(overlay);
    return overlay;
  }

  function setOverlay(message, details) {
    mounted = false;
    const overlay = ensureOverlay();
    if (!overlay) {
      pendingOverlay = { message, details };
      whenBodyReady(() => {
        if (pendingOverlay) setOverlay(pendingOverlay.message, pendingOverlay.details);
      });
      return;
    }
    pendingOverlay = null;
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("aria-live", "assertive");
    const detailsMarkup = details ? `<pre>${escapeHtml(details)}</pre>` : "";
    overlay.innerHTML = [
      '<section class="burrete-boot-card">',
      "<h1>Burrete UI failed to start</h1>",
      `<p>${escapeHtml(message)}</p>`,
      detailsMarkup,
      "</section>",
    ].join("");
  }

  function removeOverlay() {
    mounted = true;
    document.getElementById(overlayId)?.remove();
    document.getElementById(styleId)?.remove();
  }

  function errorDetails(error) {
    if (error instanceof Error) return error.stack || error.message;
    return String(error ?? "");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        default: return "&#39;";
      }
    });
  }

  whenBodyReady(() => {
    if (mounted) return;
    if (pendingOverlay) {
      setOverlay(pendingOverlay.message, pendingOverlay.details);
    } else {
      ensureOverlay();
    }
    window.setTimeout(() => {
      if (document.querySelector(".app-shell")) return;
      setOverlay("The desktop UI did not mount within 3 seconds.");
    }, mountTimeoutMs);
  });
  window.__BURRETE_BOOT_OVERLAY__ = {
    report: setOverlay,
    markMounted: removeOverlay,
  };
  window.addEventListener("error", (event) => {
    const details = event.error ? errorDetails(event.error) : [
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
    ].filter(Boolean).join("\n");
    setOverlay(event.message || "A startup script failed.", details);
  });
  window.addEventListener("unhandledrejection", (event) => {
    setOverlay("A startup promise was rejected.", errorDetails(event.reason));
  });
}());

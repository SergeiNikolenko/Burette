(function () {
  const overlayId = "burette-boot-overlay";
  const styleId = "burette-boot-overlay-style";
  const mountTimeoutMs = 15000;
  const iconUrl = new URL("./boot-mark.png", document.currentScript.src).href;
  const native = "__TAURI_INTERNALS__" in window;
  let preferences = {};
  try {
    preferences = JSON.parse(window.localStorage.getItem("burette.shell"))?.state?.preferences ?? {};
  } catch { /* Startup must also work with unavailable or corrupt storage. */ }
  const dark = preferences.theme === "dark" || (preferences.theme !== "light" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
  const savedBackground = preferences[dark ? "themeDarkBackground" : "themeLightBackground"];
  const background = typeof savedBackground === "string" && /^#[0-9a-f]{6}$/i.test(savedBackground)
    ? savedBackground : dark ? "#111111" : "#ffffff";
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
        background: ${native ? "transparent" : background};
        opacity: 1;
        transition: opacity 180ms ease-out;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #${overlayId}[data-ready] { opacity: 0; pointer-events: none; }
      #${overlayId} .burette-boot-button {
        display: grid;
        place-items: center;
        overflow: visible;
        width: 76px;
        height: 76px;
        padding: 0;
        border: 0;
        border-radius: 16px;
        background: transparent;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      #${overlayId} .burette-boot-button:focus-visible {
        outline: 2px solid ${dark ? "#737373" : "#909090"};
        outline-offset: 4px;
      }
      #${overlayId} .burette-boot-lift,
      #${overlayId} .burette-boot-response,
      #${overlayId} .burette-boot-icon {
        display: block;
        width: 76px;
        height: 76px;
        pointer-events: none;
      }
      #${overlayId} .burette-boot-lift {
        opacity: .92;
        transition: transform 650ms cubic-bezier(.2, .8, .2, 1), opacity 350ms ease;
      }
      #${overlayId} .burette-boot-button:is(:hover, :focus-visible) .burette-boot-lift {
        opacity: 1;
        transform: translateY(-4px);
      }
      #${overlayId} .burette-boot-tilt,
      #${overlayId} .burette-boot-rotation {
        transform-origin: 64px 64px;
      }
      #${overlayId} .burette-boot-tilt {
        transition: transform 650ms cubic-bezier(.2, .8, .2, 1);
      }
      #${overlayId} .burette-boot-button:is(:hover, :focus-visible) .burette-boot-tilt {
        transform: rotate(12deg);
      }
      #${overlayId} .burette-boot-base {
        fill: ${dark ? "#d4d4d4" : "#4a4a4a"};
        transition: fill 400ms ease;
      }
      #${overlayId} .burette-boot-button:is(:hover, :focus-visible) .burette-boot-base {
        fill: ${dark ? "#ffffff" : "#1f1f1f"};
      }
      #${overlayId} .burette-boot-wave {
        animation: burette-boot-wave 3.6s cubic-bezier(.4, 0, .3, 1) infinite;
      }
      #${overlayId} .burette-boot-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
      @keyframes burette-boot-wave {
        0%, 12% { transform: translate(-110px, -110px); }
        82%, 100% { transform: translate(220px, 220px); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${overlayId} { transition: none; }
        #${overlayId} .burette-boot-wave { animation: none; opacity: 0; }
        #${overlayId} .burette-boot-lift { transition: opacity 150ms ease; }
        #${overlayId} .burette-boot-button:is(:hover, :focus-visible) .burette-boot-lift { transform: none; }
        #${overlayId} .burette-boot-button:is(:hover, :focus-visible) .burette-boot-tilt { transform: none; }
      }
      #${overlayId} .burette-boot-card {
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
        font-weight: 400;
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
      `<button type="button" class="burette-boot-button" aria-label="Spin Burette symbol">
        <span class="burette-boot-lift"><span class="burette-boot-response">
          <svg class="burette-boot-icon" viewBox="0 0 128 128" aria-hidden="true">
            <defs>
              <filter id="burette-boot-matte" color-interpolation-filters="sRGB">
                <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .4 .4 .4 0 -.12"/>
              </filter>
              <mask id="burette-boot-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
                <g class="burette-boot-tilt"><g class="burette-boot-rotation">
                  <image href="${escapeHtml(iconUrl)}" width="128" height="128" filter="url(#burette-boot-matte)"/>
                </g></g>
              </mask>
              <linearGradient id="burette-boot-light" gradientUnits="userSpaceOnUse" x1="-50" y1="-50" x2="50" y2="50">
                <stop stop-color="${dark ? "#ffffff" : "#111111"}" stop-opacity="0"/>
                <stop offset=".5" stop-color="${dark ? "#ffffff" : "#111111"}" stop-opacity=".8"/>
                <stop offset="1" stop-color="${dark ? "#ffffff" : "#111111"}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <g mask="url(#burette-boot-mask)">
              <rect class="burette-boot-base" width="128" height="128"/>
              <rect class="burette-boot-wave" x="-256" y="-256" width="640" height="640" fill="url(#burette-boot-light)"/>
            </g>
          </svg>
        </span></span>
      </button>`,
      '<span class="burette-boot-label">Burette is starting</span>',
    ].join("");
    let turn = null;
    let bounce = null;
    overlay.onclick = (event) => {
      const button = event.target.closest(".burette-boot-button");
      if (!button || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const icon = button.querySelector(".burette-boot-rotation");
      const response = button.querySelector(".burette-boot-response");
      const currentTransform = window.getComputedStyle(icon).transform;
      const currentResponse = window.getComputedStyle(response).transform;
      turn?.cancel();
      bounce?.cancel();
      const matrix = new DOMMatrix(currentTransform === "none" ? undefined : currentTransform);
      const angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      turn = icon.animate([
        { transform: `rotate(${angle}deg)` },
        { transform: `rotate(${angle + 360}deg)` },
      ], { duration: 1350, easing: "cubic-bezier(.16, .75, .18, 1)", fill: "forwards" });
      bounce = response.animate([
        { transform: currentResponse, offset: 0 },
        { transform: "translateY(-5px) scale(1.09)", offset: .22 },
        { transform: "translateY(1px) scale(.99)", offset: .7 },
        { transform: "translateY(0) scale(1)", offset: 1 },
      ], { duration: 1000, easing: "cubic-bezier(.22, .7, .3, 1)" });
    };
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
      '<section class="burette-boot-card">',
      "<h1>Burette UI failed to start</h1>",
      `<p>${escapeHtml(message)}</p>`,
      detailsMarkup,
      "</section>",
    ].join("");
  }

  function hasMountedApp() {
    return mounted || Boolean(document.querySelector(".app-shell"));
  }

  function reportStartupFailure(message, details) {
    if (hasMountedApp()) {
      removeOverlay();
      return;
    }
    setOverlay(message, details);
  }

  function removeOverlay() {
    if (mounted) return;
    mounted = true;
    const overlay = document.getElementById(overlayId);
    const style = document.getElementById(styleId);
    overlay?.setAttribute("data-ready", "");
    window.setTimeout(() => {
      overlay?.remove();
      style?.remove();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
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
      if (hasMountedApp()) {
        removeOverlay();
        return;
      }
      const label = document.querySelector(".burette-boot-label");
      if (label) label.textContent = "Burette is taking longer than usual to start.";
    }, mountTimeoutMs);
  });
  window.__BURETTE_BOOT_OVERLAY__ = {
    report: setOverlay,
    markMounted: removeOverlay,
  };
  window.addEventListener("error", (event) => {
    const details = event.error ? errorDetails(event.error) : [
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
    ].filter(Boolean).join("\n");
    reportStartupFailure(event.message || "A startup script failed.", details);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportStartupFailure("A startup promise was rejected.", errorDetails(event.reason));
  });
}());

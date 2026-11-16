// Loaded first by the hosted widget and by every frame the widget mounts.
// The widget runs on the host's sandbox origin while all Burette assets come
// from the Burette origin. The sandbox refuses cross-origin frames, so frames
// such as the molecular editor are mounted as same-origin srcdoc documents
// whose relative URLs resolve against the Burette origin through <base>.
(() => {
  const script = document.currentScript;
  const scriptUrl = script.src;
  const NativeWorker = window.Worker;
  if (typeof NativeWorker === "function") {
    // Browsers refuse worker scripts from the asset origin. Start a same-origin
    // blob worker that loads the real script and reports its URL as the worker
    // location, so the script still resolves its WASM next to itself. The
    // worker is always classic: the host CSP sets worker-src to blob: only,
    // which also governs static imports inside module workers, while
    // importScripts falls under script-src. Burette builds emit workers as IIFE.
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        const source = new URL(String(url), document.baseURI);
        if (source.origin === window.origin || source.protocol !== "https:") {
          super(url, options);
          return;
        }
        const href = JSON.stringify(source.href);
        const body = "Object.defineProperty(self, 'location', { value: new URL(" + href + "), configurable: true }); importScripts(" + href + ");";
        super(URL.createObjectURL(new Blob([body], { type: "text/javascript" })), { ...options, type: "classic" });
      }
    };
  }

  const attribute = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  // Frame documents keep no inline scripts: the sandbox CSP blocks them in
  // srcdoc children. This script is the only addition and runs before the
  // frame's deferred module scripts.
  async function prepareFrame(href) {
    const response = await fetch(href, { credentials: "omit" });
    if (!response.ok) throw new Error(`Burette frame returned ${response.status}.`);
    const html = await response.text();
    const head = `<base href="${attribute(new URL(".", href).href)}">`
      + `<meta name="burette-host-origin" content="${attribute(window.origin)}">`
      + `<script src="${attribute(scriptUrl)}" data-burette-frame-child></script>`;
    if (!/<head[^>]*>/iu.test(html)) throw new Error("Burette frame has no document head.");
    return html.replace(/<head[^>]*>/iu, (tag) => tag + head);
  }

  const transport = { resolve: (href) => href, prepareFrame };
  window.BuretteHostedFrameTransport = transport;
  // Inside a child frame, the editor's 3D preview mounts its own viewer frame
  // through this hook, the same way it does in the native Codex widget.
  if (script.hasAttribute("data-burette-frame-child")) window.BuretteMcpWorkspace = transport;
})();

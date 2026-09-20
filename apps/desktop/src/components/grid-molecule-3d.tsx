import { useEffect, useMemo, useRef } from "react";

// Use the same packaged renderer, presets and menu as the main viewport.
const assets = import.meta.glob<string>("../../../../PreviewExtension/Web/{molstar.js,molstar.css,viewer.js,viewer-shell.js,viewer-runtime.css,renderer-view-state.js,molstar-preset-preview-controller.js,color-picker.js,sequence-panel.js,scene-file-actions.js}", { eager: true, query: "?url", import: "default" });
const asset = (name: string) => new URL(assets[`../../../../PreviewExtension/Web/${name}`], window.location.href).href;

export default function GridMolecule3D({ molblock, theme, onOpen }: { molblock: string; theme: string; onOpen: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef(molblock);
  const open = useRef(onOpen);
  open.current = onOpen;
  const html = useMemo(() => {
    if (!initial.current || initial.current.length > 350_000) return "<!doctype html><html></html>";
    const config = { format: "mol", molstarFormat: "mol", renderer: "molstar", label: "Molecule", appViewer: true,
      inspectorPreview: true, autoFocusStructure: true, theme, canvasBackground: theme === "dark" ? "#111111" : "#ffffff",
      molstarPreset: "automatic", molstarStyle: "illustrative", xyzrenderAvailable: false, sdfGrid: false,
      defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" } };
    const data = btoa(Array.from(new TextEncoder().encode(initial.current), byte => String.fromCharCode(byte)).join(""));
    const scripts = ["molstar.js", "viewer-shell.js", "renderer-view-state.js", "molstar-preset-preview-controller.js", "color-picker.js", "sequence-panel.js", "scene-file-actions.js", "viewer.js"];
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:${theme === "dark" ? "dark" : "light"};background:${theme === "dark" ? "#111111" : "#ffffff"}}</style>
      <link rel="stylesheet" href="${asset("molstar.css")}"><link rel="stylesheet" href="${asset("viewer-runtime.css")}">
      <style>html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}#status,.msp-toast-container,.msp-highlight-toast-wrapper{display:none!important}
      #buret-toolbar{left:auto!important;right:4px!important;top:4px!important;bottom:auto!important;width:auto!important}
      .buret-toolbar-content>*:not([data-buret-molstar-preset-slot]){display:none!important}
      .msp-viewport-controls,.buret-viewport-corner,.buret-viewport-rail,.buret-generate-3d-control,.buret-grip{display:none!important}
      .buret-molstar-preset-menu,.buret-tree-menu{background:${theme === "dark" ? "#202020" : "#ffffff"}!important;border:1px solid ${theme === "dark" ? "#383838" : "#e5e5e5"}!important;border-radius:8px;box-shadow:0 8px 24px #0003;backdrop-filter:none!important}
      .buret-molstar-preset-menu{max-height:calc(100vh - 44px);font-size:12px}
      .buret-molstar-preset-trigger{background:${theme === "dark" ? "#262626" : "#f5f5f5"}!important;border:0!important;border-radius:6px}

      </style></head><body><div id="app" class="buret-inspector-updating"></div><div id="status" class="hidden"></div>
      <script>window.BuretteConfig=${JSON.stringify(config)};window.BuretteDataBase64="${data}";</script>
      ${scripts.map(name => `<script src="${asset(name)}"></script>`).join("")}
      <script>
        let start;
        document.addEventListener('pointerdown', event => { start = event.target instanceof HTMLCanvasElement && event.button === 0 ? { x: event.clientX, y: event.clientY } : null; }, true);
        document.addEventListener('pointerup', event => {
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) window.parent.postMessage({ source: 'burette-inspector-open' }, '*');
          start = null;
        }, true);
        document.addEventListener('pointercancel', () => { start = null; });
      </script></body></html>`;
  }, [theme]);
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({ source: "burette-inspector-host", molblock }, "*");
    const ready = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.source === "burette-inspector-ready") send();
      if (event.data?.source === "burette-inspector-open") open.current();
    };
    window.addEventListener("message", ready);
    const timer = window.setTimeout(send, 60);
    return () => { window.clearTimeout(timer); window.removeEventListener("message", ready); };
  }, [molblock, html]);
  return <iframe ref={frame} className="grid-molecule-3d" title="Molecule 3D preview" srcDoc={html} sandbox="allow-scripts allow-same-origin allow-downloads" />;
}

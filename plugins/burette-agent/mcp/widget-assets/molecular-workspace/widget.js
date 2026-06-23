(function () {
  const payload = window.__BURETTE_AGENT_WIDGET_DATA__ || window.openai?.widgetData || {};
  const observe = payload.observe || {};
  const activeDocument = observe.activeDocument || {};
  const previewUrl = typeof payload.previewUrl === "string" ? payload.previewUrl : "";

  setText("title", payload.title || activeDocument.title || "Molecular Workspace");
  setText("summary", payload.summary || "Interactive Burrete workspace preview.");
  setText("document-title", activeDocument.title || activeDocument.path || "-");
  setText("document-ready", activeDocument.ready === true ? "Ready" : activeDocument.ready === false ? "Not ready" : "-");
  setText("viewer-agent", viewerAgentLabel(observe));
  setText("workspace-panels", workspacePanelsLabel(observe));

  const frame = document.getElementById("preview-frame");
  const empty = document.getElementById("empty-preview");
  const open = document.getElementById("open-preview");
  const reload = document.getElementById("reload-preview");

  if (previewUrl) {
    frame.src = previewUrl;
    open.href = previewUrl;
    open.removeAttribute("aria-disabled");
    empty.hidden = true;
  } else {
    frame.hidden = true;
    open.removeAttribute("href");
    open.setAttribute("aria-disabled", "true");
    empty.hidden = false;
  }

  reload.addEventListener("click", () => {
    if (!previewUrl) return;
    frame.src = previewUrl;
  });

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function viewerAgentLabel(state) {
    const agent = state.viewerAgent || state.viewer || null;
    if (!agent) return "-";
    if (agent.ready === true || agent.viewerReady === true) return "Ready";
    if (agent.available === false) return "Unavailable";
    return "Not ready";
  }

  function workspacePanelsLabel(state) {
    const panels = Array.isArray(state.workspacePanels) ? state.workspacePanels : Array.isArray(state.panels) ? state.panels : [];
    if (!panels.length) return "None";
    return panels.map(panel => typeof panel === "string" ? panel : panel.title || panel.kind || panel.id || "panel").join(", ");
  }
})();

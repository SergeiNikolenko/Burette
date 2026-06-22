(function () {
  const data = readPayload();
  render(data);

  window.addEventListener(
    "message",
    event => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.method !== "ui/notifications/tool-result") return;
      render(normalizePayload(message.params));
    },
    { passive: true },
  );

  function readPayload() {
    return normalizePayload(
      window.__BURETTE_AGENT_WIDGET_DATA__ ||
      window.openai?.widgetData ||
      window.openai?.toolOutput ||
      window.openai?.toolResponseMetadata ||
      {},
    );
  }

  function normalizePayload(value) {
    const payload = value || {};
    if (payload._meta?.widgetData) return payload._meta.widgetData;
    if (payload.structuredContent?.observe) {
      return {
        title: payload.structuredContent.title,
        observe: payload.structuredContent.observe,
      };
    }
    if (payload.structuredContent) return payload.structuredContent;
    return payload;
  }

  function render(payload) {
    const observe = payload.observe || payload.result || payload;
    document.getElementById("title").textContent = payload.title || observe.activeDocument?.title || "Molecular Workspace";
    document.getElementById("summary").textContent = payload.summary || statusLine(observe);
    renderDl("document", observe.activeDocument || {});
    renderDl("viewer", observe.viewerAgent || {});
    renderList("panels", (observe.workspacePanels || observe.panels || []).map(panel => {
      if (typeof panel === "string") return panel;
      return `${panel.kind || "panel"}: ${panel.title || panel.id || "untitled"}`;
    }));
    renderList("actions", observe.actions?.recent?.map(action => `${action.type || "action"}: ${action.status}`) || []);
  }

  function statusLine(observe) {
    if (!observe || !observe.apiVersion) return "No observe payload supplied.";
    const ready = observe.activeDocument?.ready ? "ready" : "not ready";
    const mode = observe.mode || "unknown mode";
    return `${mode}, ${ready}`;
  }

  function renderDl(id, value) {
    const node = document.getElementById(id);
    node.innerHTML = "";
    for (const [key, item] of Object.entries(value || {})) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = key;
      dd.textContent = typeof item === "object" ? JSON.stringify(item) : String(item);
      node.append(dt, dd);
    }
  }

  function renderList(id, items) {
    const node = document.getElementById(id);
    node.innerHTML = "";
    for (const item of items.length ? items : ["None"]) {
      const li = document.createElement("li");
      li.textContent = item;
      node.append(li);
    }
  }
})();

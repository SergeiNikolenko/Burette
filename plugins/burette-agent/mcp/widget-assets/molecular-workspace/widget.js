(function () {
  const data = window.__BURETTE_AGENT_WIDGET_DATA__ || window.openai?.widgetData || {};
  render(data);

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

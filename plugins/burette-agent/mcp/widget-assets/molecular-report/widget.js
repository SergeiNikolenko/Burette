(function () {
  const payload = window.__BURETTE_AGENT_WIDGET_DATA__ || window.openai?.widgetData || {};
  const manifest = payload.manifest || payload;
  const root = document.getElementById("report");
  for (const block of manifest.blocks || [{ type: "markdown", body: `# ${manifest.title || "Molecular Report"}\n\nNo blocks supplied.` }]) {
    if (block.type === "markdown") root.append(renderMarkdown(block.body || ""));
    else if (block.type === "table") root.append(renderPre(block));
    else if (block.type === "chart") root.append(renderPre(block));
    else root.append(renderPre(block));
  }

  function renderMarkdown(markdown) {
    const section = document.createElement("section");
    const lines = markdown.split(/\n+/);
    for (const line of lines) {
      if (line.startsWith("# ")) {
        const h1 = document.createElement("h1");
        h1.textContent = line.slice(2);
        section.append(h1);
      } else if (line.trim()) {
        const p = document.createElement("p");
        p.textContent = line;
        section.append(p);
      }
    }
    return section;
  }

  function renderPre(value) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    return pre;
  }
})();

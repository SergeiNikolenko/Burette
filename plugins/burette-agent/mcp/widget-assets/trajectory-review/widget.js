(function () {
  const payload = window.__BURETTE_AGENT_WIDGET_DATA__ || window.openai?.widgetData || {};
  document.getElementById("title").textContent = payload.title || "Trajectory Review";
  document.getElementById("summary").textContent = payload.summary || "Review trajectory metrics and produced artifacts.";
  const metrics = payload.metrics || [];
  const metricRoot = document.getElementById("metrics");
  for (const metric of metrics.length ? metrics : [{ label: "Status", value: payload.status || "ready" }]) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<div>${escapeHtml(metric.label)}</div><div class="value">${escapeHtml(metric.value)}</div>`;
    metricRoot.append(card);
  }
  const artifactRoot = document.getElementById("artifacts");
  for (const artifact of payload.artifacts || payload.snapshot?.artifacts || []) {
    const li = document.createElement("li");
    li.textContent = `${artifact.kind || "artifact"}: ${artifact.path || artifact.label || ""}`;
    artifactRoot.append(li);
  }
  if (!artifactRoot.children.length) {
    const li = document.createElement("li");
    li.textContent = "No artifacts supplied.";
    artifactRoot.append(li);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }
})();

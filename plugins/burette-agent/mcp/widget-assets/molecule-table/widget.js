(function () {
  const payload = window.__BURETTE_AGENT_WIDGET_DATA__ || window.openai?.widgetData || {};
  const rows = payload.rows || payload.table?.rows || payload.snapshot?.datasets?.[payload.datasetId || "molecules"] || [];
  document.getElementById("title").textContent = payload.title || "Molecule Table";
  document.getElementById("summary").textContent = payload.summary || `${rows.length} row${rows.length === 1 ? "" : "s"} shown`;
  const columns = payload.columns || inferColumns(rows);
  const table = document.getElementById("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column.label || column.key || column;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const key = column.key || column;
      const td = document.createElement("td");
      td.textContent = row[key] == null ? "" : String(row[key]);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);

  function inferColumns(values) {
    const keys = new Set();
    for (const row of values.slice(0, 20)) {
      Object.keys(row || {}).forEach(key => keys.add(key));
    }
    return Array.from(keys).map(key => ({ key, label: key }));
  }
})();

import type { ViewerDocument } from "../../types";
import { formatBytes } from "../format";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";

export function MesoscaleInfoPanel({ document }: { document: ViewerDocument }) {
  const session = useMesoscaleStore((state) => state.sessions[document.id]);
  const summary = session?.summary;
  const report = summary?.loadReport;
  return (
    <div className="mesoscale-panel mesoscale-info-panel">
      <section>
        <div className="mesoscale-section-title">Model</div>
        <dl className="mesoscale-metrics">
          <div><dt>Groups</dt><dd>{summary?.counts.groups.toLocaleString() ?? "—"}</dd></div>
          <div><dt>Entities</dt><dd>{summary?.counts.entities.toLocaleString() ?? "—"}</dd></div>
          <div><dt>Instances</dt><dd>{summary?.counts.instances.toLocaleString() ?? "—"}</dd></div>
          <div><dt>Elements</dt><dd>{summary?.counts.elements.toLocaleString() ?? "—"}</dd></div>
        </dl>
      </section>
      <section>
        <div className="mesoscale-section-title">Source</div>
        <div className="mesoscale-source-name">{document.title}</div>
        <div className="mesoscale-source-detail">{report ? `${report.kind} · ${formatBytes(report.sourceBytes)} · ${report.loadMs.toLocaleString()} ms` : formatBytes(document.byteCount)}</div>
        {report?.sourceSha256 ? <code className="mesoscale-checksum">SHA-256 {report.sourceSha256}</code> : null}
      </section>
      {report?.warnings.length ? (
        <section>
          <div className="mesoscale-section-title">Warnings</div>
          <ul className="mesoscale-warning-list">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      ) : null}
      {session?.error ? <div className="mesoscale-error">{session.error.message}</div> : null}
      <button className="mesoscale-secondary-button" type="button" onClick={() => void requestMesoscale(document.id, { type: "getSummary" }).catch(() => undefined)}>Refresh</button>
    </div>
  );
}

import { getDocumentStats } from "../../lib/document-stats";
import type { ViewerDocument } from "../../types";

function FooterMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="document-footer-metric">
      <span className="document-footer-value">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function relativeParent(path: string, workspaceRoot: string | null) {
  const normalized = path.replace(/\\/g, "/");
  const parent = normalized.slice(0, normalized.lastIndexOf("/"));
  if (!workspaceRoot) return parent;
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (parent === root) return ".";
  return parent.startsWith(root + "/") ? parent.slice(root.length + 1) : parent;
}

export function DocumentFooter({ document, workspaceRoot }: { document: ViewerDocument; workspaceRoot: string | null }) {
  const stats = getDocumentStats(document);

  return (
    <div className="document-footer">
      <div className="document-footer-location">
        <span className="document-footer-title">{document.title}</span>
        <span className="document-footer-path">{relativeParent(document.path, workspaceRoot)}</span>
      </div>
      <div className="document-footer-metrics">
        <FooterMetric label="format" value={stats.format} />
        <FooterMetric label="renderer" value={stats.renderer} />
        <FooterMetric label="size" value={stats.size} />
      </div>
    </div>
  );
}

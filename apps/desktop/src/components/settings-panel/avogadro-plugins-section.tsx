import { useId, useState, type ReactNode } from "react";
import type { AvogadroCatalogSnapshot } from "../../lib/extensions/avogadro-catalog";
import { FEATURE_LABELS, pluginLinkUrl, type AvogadroPlugin, type AvogadroPluginLink } from "../../lib/extensions/avogadro-plugin-index";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SearchInput } from "../ui/search-input";
import { ChevronDown, ChevronRight } from "../ui/app-icons";
import "./avogadro-plugins-section.css";

export type AvogadroPluginsSectionProps = {
  catalog: AvogadroCatalogSnapshot;
  onRetry: () => void;
  openLink: (plugin: AvogadroPlugin, link: AvogadroPluginLink) => Promise<void>;
  /** Install controls for one plugin. Absent on surfaces that cannot run Python packages. */
  renderPlugin?: (plugin: AvogadroPlugin) => PluginRowParts;
  installedError?: string | null;
  onRetryInstalled?: () => void;
  /** Shown instead of actions when the surface cannot install a plugin. */
  unavailableLabel?: string;
};
export type PluginRowParts = { actions: ReactNode; alert?: ReactNode; details?: ReactNode };
const PAGE_SIZE = 25;
const LINK_LABELS: Record<AvogadroPluginLink, string> = { source: "Source", readme: "Readme", issues: "Report an issue", download: "Download" };

function matches(plugin: AvogadroPlugin, query: string) {
  if (!query) return true;
  const haystack = [plugin.name, plugin.description ?? "", ...plugin.authors, ...plugin.features.map(feature => FEATURE_LABELS[feature])].join("\n").toLowerCase();
  return query.split(/\s+/u).every(word => haystack.includes(word));
}

export function AvogadroPluginsSection({ catalog, onRetry, openLink, renderPlugin, installedError, onRetryInstalled, unavailableLabel = "Desktop app" }: AvogadroPluginsSectionProps) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0), [expanded, setExpanded] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<{ plugin: AvogadroPlugin; link: AvogadroPluginLink } | null>(null);
  function onOpenLink(plugin: AvogadroPlugin, link: AvogadroPluginLink) {
    setLinkError(null);
    openLink(plugin, link).catch(() => setLinkError({ plugin, link }));
  }
  const headingId = useId();
  const filtered = catalog.plugins.filter(plugin => matches(plugin, query.trim().toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1), currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE, visible = filtered.slice(start, start + PAGE_SIZE);
  return <section className="settings-section" aria-labelledby={headingId}>
    <h2 id={headingId}>Avogadro plugins</h2>
    <Card className="settings-card">
      <div className="avogadro-plugins-toolbar">
        <SearchInput className="avogadro-plugins-search" name="avogadroPluginSearch" aria-label="Search Avogadro plugins" placeholder="Search plugins"
          maxLength={120} value={query} onValueChange={value => { setQuery(value); setPage(0); }} />
        {catalog.status === "loading" && <span role="status" className="text-sm">Loading…</span>}
      </div>
      {catalog.error && <div className="avogadro-plugins-row">
        <span role="alert" className="min-w-0 flex-1 break-words text-sm">{catalog.error}</span>
        <Button variant="outline" size="settings" disabled={catalog.status === "loading"} onClick={onRetry}>Retry</Button>
      </div>}
      {installedError && <div className="avogadro-plugins-row">
        <span role="alert" className="min-w-0 flex-1 break-words text-sm">{installedError}</span>
        <Button variant="outline" size="settings" onClick={onRetryInstalled}>Retry</Button>
      </div>}
      {linkError && <div className="avogadro-plugins-row">
        <span role="alert" className="min-w-0 flex-1 break-words text-sm">{`Could not open ${LINK_LABELS[linkError.link]}. Try again.`}</span>
        <Button variant="outline" size="settings" onClick={() => onOpenLink(linkError.plugin, linkError.link)}>Retry</Button>
        <Button variant="ghost" size="settings" onClick={() => setLinkError(null)}>Dismiss</Button>
      </div>}
      <ul aria-label="Avogadro plugins" className="avogadro-plugins-list">
        {visible.map(plugin => {
          const open = expanded === plugin.name, detailsId = `${headingId}-${plugin.name}`, parts = renderPlugin?.(plugin);
          return <li key={plugin.name} className="avogadro-plugins-item">
            <div className="avogadro-plugins-row">
              <Button variant="ghost" size="icon-toolbar" aria-expanded={open} aria-controls={detailsId} aria-label={`${plugin.name} details`}
                onClick={() => setExpanded(open ? null : plugin.name)}>{open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}</Button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium break-words">{plugin.name}</div>
                {plugin.description && <div className="text-sm break-words">{plugin.description}</div>}
              </div>
              <span className="text-sm tabular-nums">{plugin.version}</span>
              {parts ? parts.actions : <span className="text-sm">{unavailableLabel}</span>}
            </div>
            {parts?.alert && <div className="avogadro-plugins-row avogadro-plugins-alert">{parts.alert}</div>}
            {open && <dl id={detailsId} className="avogadro-plugins-details">
              <dt>Authors</dt><dd>{plugin.authors.join(", ")}</dd>
              <dt>License</dt><dd>{plugin.license}</dd>
              {plugin.features.length > 0 && <><dt>Provides</dt><dd>{plugin.features.map(feature => FEATURE_LABELS[feature]).join(", ")}</dd></>}
              {plugin.updatedAt && <><dt>Updated</dt><dd>{new Date(plugin.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</dd></>}
              <dt>Revision</dt><dd className="font-mono">{plugin.commit.slice(0, 12)}</dd>
              {parts?.details}
              <dt className="sr-only">Links</dt>
              <dd className="avogadro-plugins-links">
                {(["source", "readme", "issues", "download"] as const).filter(link => pluginLinkUrl(plugin, link)).map(link =>
                  <Button key={link} variant="link" size="settings" onClick={() => onOpenLink(plugin, link)}>{LINK_LABELS[link]}</Button>)}
              </dd>
            </dl>}
          </li>;
        })}
        {catalog.source !== "none" && !filtered.length && <li role="status" className="avogadro-plugins-row text-sm">No matching plugins</li>}
      </ul>
      {filtered.length > PAGE_SIZE && <div className="avogadro-plugins-row text-sm">
        <output className="flex-1 tabular-nums" aria-live="polite">{`${start + 1}–${start + visible.length} of ${filtered.length}`}</output>
        <Button variant="ghost" size="toolbar" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button variant="ghost" size="toolbar" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>}
    </Card>
  </section>;
}

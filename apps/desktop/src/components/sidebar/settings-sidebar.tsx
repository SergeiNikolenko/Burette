import { useMemo, useState } from "react";
import { settingsNavGroups, type SettingsSectionId } from "../../lib/settings-sections";
import { SystemIcon, type SystemIconName } from "../system-icon";
import type { ShellActions, ShellViewState } from "../types";

export function SettingsSidebar({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const [query, setQuery] = useState("");
  const activeSection = state.activeTab?.location.kind === "settings" ? state.activeTab.location.section : "general";
  const handleBackToApp = () => {
    const target = [...state.tabs].reverse().find((tab) => tab.location.kind !== "settings");
    if (target) {
      actions.selectTab(target.id);
      return;
    }
    actions.openNewTab();
  };
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return settingsNavGroups;
    return settingsNavGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => (
          item.label.toLowerCase().includes(normalizedQuery) ||
          item.description.toLowerCase().includes(normalizedQuery)
        )),
      }))
      .filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  return (
    <div className="settings-sidebar">
      <div className="settings-sidebar-spacer" data-tauri-drag-region />
      <button type="button" className="settings-back-button" onClick={handleBackToApp}>
        <BackIcon />
        <span>Back to app</span>
      </button>
      <label className="settings-search">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings..."
          aria-label="Search settings"
        />
      </label>
      <div className="settings-nav-scroll">
        {visibleGroups.map((group) => (
          <section className="settings-nav-group" key={group.title} aria-label={group.title}>
            <div className="settings-nav-title">{group.title}</div>
            <div className="settings-nav-items">
              {group.items.map((item) => (
                <SettingsNavButton
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  active={activeSection === item.id}
                  onClick={() => actions.openSettingsSection(item.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 ? <div className="settings-nav-empty">No matching settings</div> : null}
      </div>
    </div>
  );
}

function SettingsNavButton({
  id,
  label,
  active,
  onClick,
}: {
  id: SettingsSectionId;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="settings-nav-item"
      data-active={active || undefined}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="settings-nav-icon" aria-hidden="true">
        <SettingsItemIcon id={id} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function BackIcon() {
  return <SystemIcon name="chevron.left" size={16} />;
}

function SearchIcon() {
  return <SystemIcon name="magnifyingglass" size={16} />;
}

const settingsItemSymbols: Record<SettingsSectionId, SystemIconName> = {
  agent: "cpu",
  appearance: "sun.max",
  general: "gearshape",
  keyboard: "keyboard",
  maintenance: "wrench.and.screwdriver",
  structure: "atom",
  updates: "arrow.triangle.2.circlepath",
  workspace: "folder",
};

function SettingsItemIcon({ id }: { id: SettingsSectionId }) {
  return <SystemIcon name={settingsItemSymbols[id] ?? "gearshape"} size={17} />;
}

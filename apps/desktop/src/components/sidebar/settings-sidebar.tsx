import { useMemo, useState } from "react";
import { settingsNavGroups, type SettingsSectionId } from "../../lib/settings-sections";
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
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 3.5L5 8L9.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M7.25 12.5C10.1495 12.5 12.5 10.1495 12.5 7.25C12.5 4.35051 10.1495 2 7.25 2C4.35051 2 2 4.35051 2 7.25C2 10.1495 4.35051 12.5 7.25 12.5Z" stroke="currentColor" strokeWidth="1.35" />
      <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function SettingsItemIcon({ id }: { id: SettingsSectionId }) {
  if (id === "agent") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <path d="M3.2 5.7H13.8V12.4C13.8 13.2 13.2 13.8 12.4 13.8H4.6C3.8 13.8 3.2 13.2 3.2 12.4V5.7Z" stroke="currentColor" strokeWidth="1.35" />
        <path d="M5.4 5.7V4.5C5.4 3.4 6.3 2.5 7.4 2.5H9.6C10.7 2.5 11.6 3.4 11.6 4.5V5.7" stroke="currentColor" strokeWidth="1.35" />
        <path d="M6 9.2H6.01M11 9.2H11.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "appearance") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <path d="M8.5 2.2V4M8.5 13V14.8M3.7 3.7L5 5M12 12L13.3 13.3M2.2 8.5H4M13 8.5H14.8M3.7 13.3L5 12M12 5L13.3 3.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="8.5" cy="8.5" r="2.7" stroke="currentColor" strokeWidth="1.35" />
      </svg>
    );
  }
  if (id === "structure") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <circle cx="4.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.35" />
        <circle cx="11.8" cy="4.8" r="1.6" stroke="currentColor" strokeWidth="1.35" />
        <circle cx="8.8" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.35" />
        <path d="M5.9 5.6L7.7 10.4M10.6 6.1L9.4 10.3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "updates") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <path d="M13.4 8.5C13.4 11.1 11.3 13.2 8.7 13.2C6.5 13.2 4.7 11.8 4.1 9.9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M3.6 8.5C3.6 5.9 5.7 3.8 8.3 3.8C10.3 3.8 12 5 12.7 6.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M12.8 4.5V6.9H10.4M4.2 12.1V9.7H6.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === "maintenance") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
        <path d="M4.1 12.9L9.5 7.5M10.7 3.1L13.9 6.3L12.1 8.1L8.9 4.9L10.7 3.1Z" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.3 13.7L4.1 12.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M7.2 2.4H9.8L10.2 4.1C10.5 4.2 10.8 4.4 11.1 4.5L12.6 3.6L14.4 5.4L13.5 6.9C13.6 7.2 13.8 7.5 13.9 7.8L15.6 8.2V10.8L13.9 11.2C13.8 11.5 13.6 11.8 13.5 12.1L14.4 13.6L12.6 15.4L11.1 14.5C10.8 14.6 10.5 14.8 10.2 14.9L9.8 16.6H7.2L6.8 14.9C6.5 14.8 6.2 14.6 5.9 14.5L4.4 15.4L2.6 13.6L3.5 12.1C3.4 11.8 3.2 11.5 3.1 11.2L1.4 10.8V8.2L3.1 7.8C3.2 7.5 3.4 7.2 3.5 6.9L2.6 5.4L4.4 3.6L5.9 4.5C6.2 4.4 6.5 4.2 6.8 4.1L7.2 2.4Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="8.5" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

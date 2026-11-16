import { useMemo, useState } from "react";
import { settingsNavGroups, type SettingsSectionId } from "../../lib/settings-sections";
import { SidebarGlobe, Atom, Cube, Flask, Stopwatch, Agent as Bot, FolderOpen, Keyboard, Sun, Reload as RefreshCw, SettingsCog, SettingsWrench as Wrench, type AppIconType as LucideIcon } from "@/components/ui/app-icons";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnimatedBackIcon } from "../ui/animated-icons";
import type { ShellActions, ShellViewState } from "../types";

export function SettingsSidebar({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const [query, setQuery] = useState("");
  const activeSection = state.activeTab?.location.kind === "settings" ? state.activeTab.location.section : "general";
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
    <nav className="settings-sidebar" aria-label="Settings">
      <div className="settings-sidebar-spacer" data-tauri-drag-region />
      <Button type="button" variant="ghost" className="settings-back-button" onClick={actions.backToApp}>
        <AnimatedBackIcon />
        <span>Back to app</span>
      </Button>
      <SearchInput className="settings-search h-9 border-0 bg-(--color-background-primary-ghost-hover) px-3" name="settingsSearch" value={query} onValueChange={setQuery}
        placeholder="Search" aria-label="Search settings" clearLabel="Clear settings search" />
      <ScrollArea className="settings-nav-scroll">
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
        {visibleGroups.length === 0 ? <div role="status" className="settings-nav-empty">No matching settings</div> : null}
      </ScrollArea>
    </nav>
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
    <Button
      type="button"
      variant="ghost"
      className="settings-nav-item"
      data-active={active || undefined}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="settings-nav-icon" aria-hidden="true">
        <SettingsItemIcon id={id} />
      </span>
      <span>{label}</span>
    </Button>
  );
}

const SETTINGS_SECTION_ICONS: Record<SettingsSectionId, LucideIcon> = {
  general: SettingsCog,
  appearance: Sun,
  keyboard: Keyboard,
  structure: Atom,
  updates: RefreshCw,
  workspace: FolderOpen,
  jobs: Stopwatch,
  xtb: Flask,
  agent: Bot,
  extensions: Cube,
  connections: SidebarGlobe,
  maintenance: Wrench,
};

function SettingsItemIcon({ id }: { id: SettingsSectionId }) {
  const Icon = SETTINGS_SECTION_ICONS[id] ?? SettingsCog;
  return <Icon size={16} aria-hidden />;
}

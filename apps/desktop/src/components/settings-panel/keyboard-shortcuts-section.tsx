import { useMemo, useState } from "react";
import { SystemIcon } from "../system-icon";

type ShortcutRow = {
  command: string;
  description: string;
  keybindings: string[];
};

const keyboardShortcutRows: ShortcutRow[] = [
  {
    command: "Open command palette",
    description: "Search commands, settings, projects, and structures.",
    keybindings: ["⌘P", "/"],
  },
  {
    command: "Open structures",
    description: "Choose molecular structure files.",
    keybindings: ["⌘O"],
  },
  {
    command: "Open most recent structure",
    description: "Open the latest structure from recent files.",
    keybindings: ["⇧⌘O"],
  },
  {
    command: "Toggle sidebar",
    description: "Show or hide the project and structure browser.",
    keybindings: ["⌘B"],
  },
  {
    command: "Toggle bottom dock",
    description: "Show or hide the bottom workspace dock.",
    keybindings: ["⌘J"],
  },
  {
    command: "Toggle right dock",
    description: "Show or hide the right workspace dock.",
    keybindings: ["⌥⌘B"],
  },
  {
    command: "Open Settings",
    description: "Open the settings workspace.",
    keybindings: ["⌘,"],
  },
  {
    command: "Close active structure",
    description: "Close the selected structure tab.",
    keybindings: ["⌘W"],
  },
  {
    command: "Reveal in Finder",
    description: "Show the active structure file in Finder.",
    keybindings: ["⇧⌘R"],
  },
  {
    command: "Copy active path",
    description: "Copy the active structure file path.",
    keybindings: ["⇧⌘C"],
  },
  {
    command: "Show metadata",
    description: "Show renderer, format, path, and file size for the active structure.",
    keybindings: ["⌘I"],
  },
  {
    command: "Export preview as PNG",
    description: "Save the active external preview as a PNG file.",
    keybindings: ["⇧⌘E"],
  },
  {
    command: "Export preview as SVG",
    description: "Save the active external preview as an SVG file.",
    keybindings: ["⌥⌘E"],
  },
  {
    command: "Jump to tab",
    description: "Switch to the matching tab position.",
    keybindings: ["⌘1", "⌘2", "…", "⌘9"],
  },
];

export function KeyboardShortcutsSection() {
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return keyboardShortcutRows;
    return keyboardShortcutRows.filter((row) => (
      row.command.toLowerCase().includes(normalized) ||
      row.description.toLowerCase().includes(normalized) ||
      row.keybindings.join(" ").toLowerCase().includes(normalized)
    ));
  }, [query]);

  return (
    <section className="keyboard-shortcuts-section" aria-label="Keyboard shortcuts">
      <label className="keyboard-shortcuts-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
        />
      </label>
      <div className="keyboard-shortcuts-card">
        <div className="keyboard-shortcuts-header" aria-hidden="true">
          <span>Command</span>
          <span>Keybinding</span>
        </div>
        <div className="keyboard-shortcuts-list">
          {visibleRows.length > 0 ? (
            visibleRows.map((row) => (
              <div className="keyboard-shortcuts-row" key={row.command}>
                <div className="keyboard-shortcuts-copy">
                  <div className="keyboard-shortcuts-command">{row.command}</div>
                  <div className="keyboard-shortcuts-description">{row.description}</div>
                </div>
                <div className="keyboard-shortcuts-keys" aria-label={`${row.command} keybindings`}>
                  {row.keybindings.map((keybinding) => (
                    <kbd key={keybinding}>{keybinding}</kbd>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="keyboard-shortcuts-empty">No matching shortcuts</div>
          )}
        </div>
      </div>
    </section>
  );
}

function SearchIcon() {
  return <SystemIcon name="magnifyingglass" size={16} />;
}

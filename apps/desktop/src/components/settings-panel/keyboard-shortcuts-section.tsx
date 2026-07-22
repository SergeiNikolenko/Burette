import { useMemo, useState } from "react";
import { AnimatedSearchIcon } from "../ui/animated-icons";

type ShortcutRow = {
  command: string;
  description: string;
  keybindings: string[];
};

const keyboardShortcutRows: ShortcutRow[] = [
  {
    command: "Open command palette",
    description: "Search commands, settings, projects, and structures.",
    keybindings: ["⇧⌘P", "/"],
  },
  {
    command: "New window",
    description: "Open another Burrete workspace window.",
    keybindings: ["⌘N"],
  },
  {
    command: "New tab",
    description: "Open a launcher tab in the current window.",
    keybindings: ["⌘T"],
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
    command: "Undo",
    description: "Undo the latest workspace or focused preview edit.",
    keybindings: ["⌘Z"],
  },
  {
    command: "Redo",
    description: "Redo the latest workspace or focused preview edit when available.",
    keybindings: ["⇧⌘Z"],
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
    command: "Close active tab",
    description: "Close the selected tab.",
    keybindings: ["⌘W"],
  },
  {
    command: "Close active window",
    description: "Close the frontmost Burrete window.",
    keybindings: ["⇧⌘W"],
  },
  {
    command: "Select next tab",
    description: "Move to the next tab in the current window.",
    keybindings: ["⌃⇥"],
  },
  {
    command: "Select previous tab",
    description: "Move to the previous tab in the current window.",
    keybindings: ["⌃⇧⇥"],
  },
  {
    command: "Undo",
    description: "Undo in the active text editor or molecule collection.",
    keybindings: ["⌘Z"],
  },
  {
    command: "Redo",
    description: "Redo in the active text editor or molecule collection.",
    keybindings: ["⇧⌘Z"],
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
    command: "Get Info",
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
        <AnimatedSearchIcon />
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

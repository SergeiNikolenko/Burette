import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SettingControl } from "./setting-control";

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
    command: "New window",
    description: "Open another Burette workspace window.",
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
    command: "Save",
    description: "Save the active text source or collection document (desktop app).",
    keybindings: ["⌘S"],
  },
  {
    command: "Save As",
    description: "Save the active collection as a new file (desktop app).",
    keybindings: ["⇧⌘S"],
  },
  {
    command: "Find",
    description: "Search the active collection grid, otherwise focus sidebar search (desktop app).",
    keybindings: ["⌘F"],
  },
  {
    command: "Undo",
    description: "Undo in the active context: workspace history, or the collection grid when one is active.",
    keybindings: ["⌘Z"],
  },
  {
    command: "Redo",
    description: "Redo in the active context.",
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
    command: "Zoom in",
    description: "Scale all window content up one step.",
    keybindings: ["⌘="],
  },
  {
    command: "Zoom out",
    description: "Scale all window content down one step.",
    keybindings: ["⌘-"],
  },
  {
    command: "Actual size",
    description: "Reset window content scaling to 100%.",
    keybindings: ["⌘0"],
  },
  {
    command: "Toggle sidebar (browser)",
    description: "Show or hide the sidebar in the browser runtime.",
    keybindings: ["⌘\\"],
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
    description: "Close the frontmost Burette window.",
    keybindings: ["⇧⌘W"],
  },
  {
    command: "Quit Burette",
    description: "Quit after the exit preflight completes (desktop app).",
    keybindings: ["⌘Q"],
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
    command: "Jump to structure",
    description: "Open the numbered sidebar structure, or the matching tab when the sidebar is hidden. Hold ⌘ to show the numbers.",
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
      <SearchInput className="keyboard-shortcuts-search" name="shortcutSearch" value={query} onValueChange={setQuery}
        placeholder="Search shortcuts" aria-label="Search shortcuts" />
      {visibleRows.length > 0 ? <Card className="settings-card keyboard-shortcuts-card">
        {visibleRows.map(row => <SettingControl key={row.command} row={{
          label: row.command,
          description: row.description,
          control: <KbdGroup className="keyboard-shortcuts-keys" aria-label={`${row.command} keybindings`}>
            {row.keybindings.map(keybinding => <Kbd key={keybinding} className="keyboard-shortcuts-key">{keybinding}</Kbd>)}
          </KbdGroup>,
        }} />)}
      </Card> : <p role="status" className="keyboard-shortcuts-empty">No matching shortcuts</p>}
    </section>
  );
}

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowRotateCcw, Delete, Edit, KeystrokeSearch } from "@/components/ui/app-icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SearchInput } from "@/components/ui/search-input";
import { ShortcutTooltip } from "../shortcut-tooltip";
import {
  SHORTCUT_DEFINITIONS,
  acceleratorFromEvent,
  findShortcutConflict,
  formatAccelerator,
  formatHeldModifiers,
  isAssignableAccelerator,
  isEditableShortcut,
  nativeMenuAccelerators,
  resolveShortcutAccelerator,
  shortcutDisplayKeys,
  withShortcutOverride,
  withoutShortcutOverride,
  type ShortcutDefinition,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../lib/keyboard-shortcuts";
import { isTauriRuntime } from "../../lib/tauri";
import { useSettingsStore } from "../../stores/settings-store";
import { SettingControl } from "./setting-control";
import "./keyboard-shortcuts-section.css";

type CaptureProblem =
  | { kind: "invalid" }
  | { kind: "conflict"; accelerator: string; conflict: ShortcutDefinition };

// Native menu accelerators fire before the webview sees the keys, so recording
// lifts them for the duration of a capture and restores the saved set after.
function setNativeMenuAccelerators(accelerators: Record<string, string>) {
  if (!isTauriRuntime()) return;
  void invoke("set_menu_accelerators", { accelerators }).catch((error) => {
    console.warn("Native menu shortcut sync failed", error);
  });
}

function suspendNativeMenuAccelerators() {
  setNativeMenuAccelerators(Object.fromEntries(Object.keys(nativeMenuAccelerators({})).map((id) => [id, ""])));
}

function restoreNativeMenuAccelerators() {
  setNativeMenuAccelerators(nativeMenuAccelerators(useSettingsStore.getState().preferences.shortcutOverrides));
}

export function KeyboardShortcutsSection() {
  const overrides = useSettingsStore((store) => store.preferences.shortcutOverrides);
  const setPreference = useSettingsStore((store) => store.setPreference);
  const [query, setQuery] = useState("");
  const [searchByKeys, setSearchByKeys] = useState(false);
  const [capturingId, setCapturingId] = useState<ShortcutId | null>(null);
  const setOverrides = (next: ShortcutOverrides) => setPreference("shortcutOverrides", next);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return SHORTCUT_DEFINITIONS;
    if (searchByKeys) {
      // A recorded combo matches exactly; held modifiers alone narrow by substring.
      const partial = /^[⌃⌥⇧⌘]+$|\+$/u.test(query);
      return SHORTCUT_DEFINITIONS.filter((definition) => shortcutDisplayKeys(definition, overrides)
        .some((keys) => partial ? keys.includes(query) : keys === query));
    }
    return SHORTCUT_DEFINITIONS.filter((definition) => (
      definition.label.toLowerCase().includes(normalized) ||
      definition.description.toLowerCase().includes(normalized) ||
      shortcutDisplayKeys(definition, overrides).join(" ").toLowerCase().includes(normalized)
    ));
  }, [overrides, query, searchByKeys]);

  useEffect(() => {
    if (!capturingId && !searchByKeys) return undefined;
    suspendNativeMenuAccelerators();
    return restoreNativeMenuAccelerators;
  }, [capturingId, searchByKeys]);

  // Codex's "Search by keystrokes": the field records a combo instead of text.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchByKeys || (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (event.key === "Escape" && bare) setSearchByKeys(false);
    else if ((event.key === "Backspace" || event.key === "Delete") && bare) setQuery("");
    else {
      const recorded = acceleratorFromEvent(event.nativeEvent);
      setQuery(recorded ? formatAccelerator(recorded) : formatHeldModifiers(event.nativeEvent));
    }
  };

  return (
    <section className="keyboard-shortcuts-section" aria-label="Keyboard shortcuts">
      <div className="keyboard-shortcuts-controls">
        <SearchInput className="keyboard-shortcuts-search" name="shortcutSearch" value={query} onValueChange={setQuery}
          placeholder={searchByKeys ? "Press shortcut to search" : "Search shortcuts"} aria-label="Search shortcuts"
          readOnly={searchByKeys} clearable={!searchByKeys} onKeyDown={onSearchKeyDown} onBlur={() => setSearchByKeys(false)}
          trailing={<ShortcutTooltip label="Search by keystrokes">
            <Button type="button" variant="ghost" size="icon-toolbar" aria-label="Search by keystrokes" aria-pressed={searchByKeys}
              className="keyboard-shortcuts-keystroke-search" onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                setSearchByKeys(!searchByKeys);
                setQuery("");
                (event.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null)?.focus();
              }}>
              <KeystrokeSearch size={16} aria-hidden />
            </Button>
          </ShortcutTooltip>} />
        {Object.keys(overrides).length > 0 ? <ResetAllShortcutsButton onConfirm={() => setOverrides({})} /> : null}
      </div>
      {visibleRows.length > 0 ? <Card className="settings-card keyboard-shortcuts-card">
        {visibleRows.map((definition) => <SettingControl key={definition.id} row={{
          label: definition.label,
          description: definition.description,
          control: isEditableShortcut(definition)
            ? <ShortcutSetter
                definition={definition}
                overrides={overrides}
                capturing={capturingId === definition.id}
                onCapturingChange={(capturing) => setCapturingId(capturing ? definition.id : null)}
                onOverridesChange={setOverrides}
              />
            : <KbdGroup className="keyboard-shortcuts-keys" aria-label={`${definition.label} keybindings`}>
                {shortcutDisplayKeys(definition, overrides).map((keys) => <Kbd key={keys} className="keyboard-shortcuts-key">{keys}</Kbd>)}
              </KbdGroup>,
        }} />)}
      </Card> : <p role="status" className="keyboard-shortcuts-empty">No matching shortcuts</p>}
    </section>
  );
}

function ShortcutSetter({
  definition,
  overrides,
  capturing,
  onCapturingChange,
  onOverridesChange,
}: {
  definition: ShortcutDefinition;
  overrides: ShortcutOverrides;
  capturing: boolean;
  onCapturingChange: (capturing: boolean) => void;
  onOverridesChange: (overrides: ShortcutOverrides) => void;
}) {
  const id = useId();
  const valueId = `${id}-value`;
  const problemId = `${id}-problem`;
  const containerRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [held, setHeld] = useState("");
  const [problem, setProblem] = useState<CaptureProblem | null>(null);
  const accelerator = resolveShortcutAccelerator(definition.id, overrides);
  const isModified = typeof overrides[definition.id] === "string";

  const startCapture = (initialProblem: CaptureProblem | null = null) => {
    setHeld("");
    setProblem(initialProblem);
    onCapturingChange(true);
  };
  const endCapture = (restoreFocus: boolean) => {
    setHeld("");
    setProblem(null);
    onCapturingChange(false);
    if (restoreFocus) requestAnimationFrame(() => editButtonRef.current?.focus());
  };
  const assign = (next: ShortcutOverrides) => {
    onOverridesChange(next);
    endCapture(true);
  };
  const replaceConflict = (target: string, conflict: ShortcutDefinition) => {
    assign(withShortcutOverride(withShortcutOverride(overrides, conflict.id as ShortcutId, ""), definition.id, target));
  };
  const resetToDefault = () => {
    const conflict = definition.defaultAccelerator
      ? findShortcutConflict(definition.id, definition.defaultAccelerator, withoutShortcutOverride(overrides, definition.id))
      : null;
    if (conflict) startCapture({ kind: "conflict", accelerator: definition.defaultAccelerator, conflict });
    else onOverridesChange(withoutShortcutOverride(overrides, definition.id));
  };

  const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    // Plain Tab moves focus to Cancel/Replace instead of being recorded.
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === "Escape" && bare) {
      endCapture(true);
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && bare) {
      assign(withShortcutOverride(overrides, definition.id, ""));
      return;
    }
    const recorded = acceleratorFromEvent(event.nativeEvent);
    if (!recorded) {
      setHeld(formatHeldModifiers(event.nativeEvent));
      return;
    }
    setHeld("");
    if (!isAssignableAccelerator(definition, recorded)) {
      setProblem({ kind: "invalid" });
      return;
    }
    const conflict = findShortcutConflict(definition.id, recorded, overrides);
    if (conflict) {
      setProblem({ kind: "conflict", accelerator: recorded, conflict });
      return;
    }
    assign(withShortcutOverride(overrides, definition.id, recorded));
  };

  // Leaving the row (not moving between its own controls) cancels the capture.
  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!capturing) return;
    const next = event.relatedTarget;
    if (next instanceof Node && containerRef.current?.contains(next)) return;
    endCapture(false);
  };

  if (capturing) {
    const prompt = held ? `${held}…` : problem?.kind === "conflict" ? formatAccelerator(problem.accelerator) : "Press shortcut";
    return (
      <div ref={containerRef} className="keyboard-shortcut-setter" data-capturing="" onBlurCapture={onBlurCapture}>
        <div className="keyboard-shortcut-capture-row">
          <Input
            variant="compact"
            className="keyboard-shortcut-capture"
            autoFocus
            readOnly
            name="keyboard-shortcut-capture"
            value={prompt}
            aria-label={`Shortcut capture for ${definition.label}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            onKeyDown={onCaptureKeyDown}
            onKeyUp={(event) => setHeld(formatHeldModifiers(event.nativeEvent))}
          />
          {problem?.kind === "conflict" && isEditableShortcut(problem.conflict) ? (
            <Button type="button" variant="secondary" size="toolbar" onMouseDown={(event) => event.preventDefault()}
              onClick={() => replaceConflict(problem.accelerator, problem.conflict)}>
              Replace
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="toolbar" onMouseDown={(event) => event.preventDefault()} onClick={() => endCapture(true)}>
            Cancel
          </Button>
        </div>
        {problem ? (
          <span id={problemId} role="alert" className="keyboard-shortcut-problem" data-kind={problem.kind}>
            {problem.kind === "conflict"
              ? `Used by ${problem.conflict.label}`
              : "Use a key combination with ⌘, ⌃, or ⌥, or a function key"}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="keyboard-shortcut-setter" role="group" aria-label={`${definition.label} shortcut`}>
      <div className="keyboard-shortcut-value">
        <span id={valueId} className="keyboard-shortcut-keys" onClick={() => startCapture()}>
          {accelerator
            ? <Kbd className="keyboard-shortcuts-key">{formatAccelerator(accelerator)}</Kbd>
            : <span className="keyboard-shortcut-unassigned">Unassigned</span>}
        </span>
        <ShortcutTooltip label={accelerator ? "Change shortcut" : "Set shortcut"}>
          <Button ref={editButtonRef} type="button" variant="ghost" size="icon-toolbar"
            aria-label={`${accelerator ? "Change" : "Set"} shortcut for ${definition.label}`} aria-describedby={valueId}
            onClick={() => startCapture()}>
            <Edit size={16} aria-hidden />
          </Button>
        </ShortcutTooltip>
      </div>
      <div className="keyboard-shortcut-actions">
        {accelerator ? (
          <ShortcutTooltip label="Clear shortcut">
            <Button type="button" variant="ghost" size="icon-toolbar" aria-label={`Clear shortcut for ${definition.label}`}
              onClick={() => onOverridesChange(withShortcutOverride(overrides, definition.id, ""))}>
              <Delete size={16} aria-hidden />
            </Button>
          </ShortcutTooltip>
        ) : null}
        {isModified ? (
          <ShortcutTooltip label="Reset to default">
            <Button type="button" variant="ghost" size="icon-toolbar" aria-label={`Reset shortcut for ${definition.label}`}
              onClick={resetToDefault}>
              <ArrowRotateCcw aria-hidden />
            </Button>
          </ShortcutTooltip>
        ) : null}
      </div>
    </div>
  );
}

function ResetAllShortcutsButton({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="secondary" size="toolbar" className="keyboard-shortcuts-reset-all">
          Reset all to defaults
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset all keyboard shortcuts?</AlertDialogTitle>
          <AlertDialogDescription>This will discard all custom shortcuts and restore the defaults</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>Reset all</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

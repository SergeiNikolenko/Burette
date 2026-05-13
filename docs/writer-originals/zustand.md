# Zustand Guidelines

## Side Effects After `set()`

Never call side effects that read state back inside Zustand's `set()` callback — state isn't committed yet.

Side effects that read store state (via `getState()`) must be called **after** `set()` returns, not inside the `set()` callback. Inside `set()`, `getState()` returns stale state because the update hasn't been committed yet.

**Why:** Bug where `scheduleSave` was called inside `set()`, so `performSave` read old state and skipped the save entirely.

**How to apply:** When a store action needs to trigger a side effect that reads state, hoist the side effect call after `set()` returns. Use a local variable to pass data out of `set()` if needed:

```typescript
// WRONG — scheduleSave reads stale state
updateContent: (path, content) => {
  set((state) => {
    // ...
    if (isDirty) scheduleSave(path); // performSave sees OLD state
    return { openFiles: files };
  });
},

// RIGHT — scheduleSave reads committed state
updateContent: (path, content) => {
  let dirty = false;
  set((state) => {
    // ...
    dirty = full !== file.diskContent;
    return { openFiles: files };
  });
  if (dirty) scheduleSave(path); // performSave sees NEW state
},
```

## One Selector Per Hook

Each domain hook should select a single slice of state. Never bundle multiple `useStore()` calls into one hook that returns an object — every consumer subscribes to all of them.

**Why:** Zustand uses `Object.is` on selector results. A hook that selects `openFiles` (a Map that gets cloned on every update) forces re-renders on every consumer — even those that only need `activeFilePath`.

```typescript
// WRONG — every consumer re-renders when any slice changes
function useTabs() {
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  return { tabOrder, openFiles, activeFilePath };
}

// RIGHT — components subscribe only to what they need
function useTabOrder() {
  return useEditorStore((s) => s.tabOrder);
}
function useOpenFiles() {
  return useEditorStore((s) => s.openFiles);
}
function useActiveFilePath() {
  return useEditorStore((s) => s.activeFilePath);
}
```

## Components Read Stores Through Hooks

Components must not import a store module directly (`useEditorStore`, `useSettingsStore`, etc.) — they consume state via the hooks in `@/hooks/`. The hooks are the slice boundary: each one selects a single slice (per the rule above) and gives the component a typed, narrow view. A component reaching into the store directly defeats both disciplines at once: it picks its own selector (often the whole store, causing unrelated re-renders) and bypasses the type narrowing the hook provides.

If a component needs a slice no hook exposes yet, **add the hook**, don't reach into the store. Hooks are cheap; a one-line selector is fine. The rule applies to subscriptions inside component bodies — store-level access from non-component code (e.g., `useSettingsStore.getState()` inside another hook, an event handler, or startup glue) is still permitted, since those aren't subscriptions.

```typescript
// WRONG — component imports the store and picks its own selector
import { useSettingsStore } from "@/stores/settings-store";
function ThemeCard() {
  const schema = useSettingsStore((s) => s.schema);
  // …
}

// RIGHT — component uses a hook; the hook owns the selector
import { useSettingsSchema } from "@/hooks/use-settings";
function ThemeCard() {
  const schema = useSettingsSchema();
  // …
}
```

## Bail Out When Values Haven't Changed

Store actions that clone a Map or object must check whether the value actually changed before calling `set()`. Otherwise every action produces a new reference and triggers re-renders even when nothing changed.

```typescript
// WRONG — clones the Map even when pos is the same
updateCursorPos: (path, pos) => {
  set((state) => {
    const files = new Map(state.openFiles);
    const file = files.get(path);
    if (!file) return state;
    files.set(path, { ...file, cursorPos: pos });
    return { openFiles: files };
  });
},

// RIGHT — bail out early if nothing changed
updateCursorPos: (path, pos) => {
  set((state) => {
    const file = state.openFiles.get(path);
    if (!file || file.cursorPos === pos) return state;
    const files = new Map(state.openFiles);
    files.set(path, { ...file, cursorPos: pos });
    return { openFiles: files };
  });
},
```

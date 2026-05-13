# React Guidelines

## Import Conventions

- Use `@/` absolute imports for cross-directory imports within `apps/desktop/src/`. The alias `@` maps to `apps/desktop/src/`.
  - Example: `import { useEditorStore } from "@/stores/editor-store"`
  - Example: `import * as tauri from "@/lib/tauri"`
- Keep `./` relative imports for same-directory or downward imports (co-located files).
  - Example: `import { FileTreeNode } from "./file-tree-node"`
- Never use `../` to reach a different top-level `src/` directory. Use `@/` instead.

## State Management — Don't Leak Implementation Details

Components and app-level hooks must never import directly from `stores/`. State management (Zustand, Redux, signals, etc.) is an implementation detail hidden behind domain-focused hooks in `hooks/`.

### Rules

- **Components import from `hooks/`, never `stores/`.** A component should not know whether state comes from Zustand, Context, a server cache, or a plain variable.
- **One hook per domain concept.** Group by what the feature _does_, not by which store it lives in. Examples: `useTabs`, `useWorkspace`, `useSidebar` — not `useEditorStore`.
- **Keep hooks focused.** A hook returning 6+ values is a smell. Split by read-vs-write or by sub-domain. A component that only needs `activeFilePath` shouldn't subscribe to `openFiles` too — it causes unnecessary re-renders and couples it to state it doesn't use.
- **Add behavior in hooks, not components.** Cross-cutting concerns like derived state, logging, or optimistic updates belong in the hook layer. Components should never need to change when you add these.
- **Imperative (non-reactive) access goes through an API module, not `store.getState()`.** See `hooks/editorApi.ts` for the pattern. Use this for class components, event listeners, and standalone async functions.
- **Re-export types from hooks.** If a store defines a type that consumers need (e.g., `OpenFile`), re-export it from the relevant hook so nobody imports from `stores/` for types either.

### Why

- Swapping state libraries or restructuring stores requires changing only the hooks, not every component.
- Components read like domain logic, not wiring code.
- Easier to test — mock a hook, not a store.
- Adding features (caching, derived state, logging) happens in one place without touching consumers.

### Hook Placement — Domain vs Implementation

Not all hooks belong in `hooks/`. The `hooks/` directory is the app's **domain API layer** — the public interface between components and state. Hooks that are internal wiring for a single component live next to that component instead.

#### Where a hook lives

- **`hooks/` (domain hooks)** — Hooks that abstract store access, expose app-wide concepts, or could reasonably be consumed by more than one component. These form the stable API that components program against.
  - Store accessor hooks: `useTabs`, `useTheme`, `useCommandPalette`, `useSidebar`, `useWorkspace`, `useDirectoryCache`, `useExpandedDirs`, `useToggleDirectory`
  - App-level effect hooks: `useFileSave`, `useFileWatcher`, `useKeyboardShortcuts`
  - Imperative API modules: `editorApi`
  - Import with `@/hooks/...`

- **Co-located with the component (implementation hooks)** — Hooks that encapsulate internal wiring no other component would use: DOM setup, third-party library instances (CodeMirror, a canvas, a map), component-specific data fetching or transformation.
  - Examples: `use-editor-view.ts` in `components/editor-area/`, `use-fuzzy-search.ts` in `components/command-palette/`
  - Import with `./` (relative, same directory)

#### Decision test

Ask: _"If I deleted this component, would any other component miss this hook?"_

- **Yes** → domain hook, lives in `hooks/`
- **No** → implementation hook, co-locate it

A second signal: domain hooks typically select from stores or orchestrate app-wide side effects. Implementation hooks typically manage a ref, a local subscription, a third-party library instance, or a component-scoped async operation.

#### When to promote a co-located hook

If a second component needs the hook, move it to `hooks/` and switch both consumers to `@/hooks/...` imports. Do not import across component directories with `../`.

#### Naming and file conventions

- **Use kebab-case for all filenames**, including hooks: `use-editor-view.ts`, not `useEditorView.ts`. This matches the component file convention (`editor-pane.tsx`, `file-tree-node.tsx`).
- Place the hook file as a sibling inside the component's directory (e.g., `components/editor-area/use-editor-view.ts` alongside `editor-pane.tsx`).
- If a component is a single file (not a directory), create a directory for it first — move the component to `index.tsx` — then add the hook alongside it.

## Side Effects — Act, Don't React

Perform side effects at the action or event level, not by watching for state changes.

### Principles

- **Side effects belong in actions, not watchers.** When a store action causes a state change that needs a side effect, perform it in the action itself — don't set up a separate watcher to react to the change.
- **No `useEffect` in components.** If a component needs imperative behavior, extract it into a dedicated leaf component (e.g., `WindowTitle`) or a hook in `hooks/`. Components should be pure render functions.
- **One concern per leaf component.** Cross-cutting behaviors like window title, keyboard shortcuts, or file watching each get their own leaf component or hook — don't bundle unrelated logic into a single component.
- **Prefer CSS over JS listeners.** `@media` queries, `:has()`, attribute selectors handle what would otherwise be JS event subscriptions.
- **Ref callbacks over `useRef` + `useEffect`.** For imperative DOM setup/teardown, callback refs are idiomatic and don't require effects.
- **External event listeners register once.** Keyboard shortcuts, Tauri events, and other external listeners register on mount with `[]` deps and read current state at event time.

## Persistence — Use Tauri Store, Not localStorage

This is a Tauri desktop app. Never use `localStorage` or `sessionStorage` for persistence.

### Rules

- **Use `@/lib/preferences.ts`** for reading and writing app preferences. It wraps `@tauri-apps/plugin-store` which persists to a JSON file in the app data directory.
- **Stores load preferences eagerly on creation** and persist on change via store actions — not via effects.
- **Preferences are async.** Initial state uses sensible defaults; the persisted value overrides once loaded.
- **Keep the inline `<script>` in `index.html` for flash prevention** — it uses system OS preference as default until the store loads.

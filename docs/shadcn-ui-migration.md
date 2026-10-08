# shadcn UI Migration

## Objective

Move the ordinary React interface in `apps/desktop` onto shared, source-owned
components styled from Codex InterfaceAtlas. Preserve Tauri, the classic
edge-to-edge sidebar and background, dynamic light/dark themes, and the existing
scientific workflows. Component radii and spacing come from the corresponding
Atlas variant, not a single global radius or a generic dashboard template.

The shared controls use Radix with source-owned Atlas styles; the current visual
direction is documented in `design-system.md`. Notifications use Sonner through
`apps/desktop/src/components/ui/toast.tsx`, not Base UI Toast. Base UI remains
scoped to `ui/scroll-area.tsx`. Existing animated components live in
`apps/desktop/src/components/animate-ui/`. Do not add another primitive stack.

Toast cards use Atlas spacing, typography and content-sized width, constrained
to the notification stack and viewport. They deliberately keep neutral surfaces
in both themes: errors color the title, not the entire card. The colorful solid
Atlas variants are not the product default.

## Inspected Baseline (historical)

The inventory below reflects the React source under `apps/desktop/src` before
the shadcn foundation was added. It is kept as the migration baseline; several
of its "current implementation" entries no longer exist (for example
`notification-popup.tsx` was removed when the Base UI toast layer landed).

| Surface | Current implementation | Migration target |
| --- | --- | --- |
| Settings and forms | `settings-panel/**`, `agent-integration-panel/**`, settings sections in `structure-info-panel.tsx`; custom buttons, inputs, selects, switches, ranges, and Radix confirmation dialogs | `Field`, `FieldGroup`, `FieldSet`, `Button`, `Input`, `InputGroup`, `NativeSelect` or `Select`, `Switch`, `Checkbox`, `Slider`, `AlertDialog`, `Card`, `Separator` |
| Dialogs and confirmations | Radix Dialog markup in `notification-popup.tsx` and `settings-panel/setting-control.tsx`; Ketcher export dialogs | Shared `Dialog` and `AlertDialog` compositions with `.app-shell` portal ownership |
| Menus | `radix-menu.tsx`, `native-context-menu.ts`, editor and project menus | Shared `DropdownMenu` and `ContextMenu` wrappers while preserving the native-menu selection boundary |
| Command palette | `command-palette/index.tsx` using `cmdk` and Radix Dialog directly | Shared `Command` inside `Dialog`, retaining current actions, keyboard navigation, and query contract |
| Notifications and status | `notification-popup.tsx`, local status rows, custom error/status panels | Shared Sonner toast adapter (`ui/toast.tsx`), `Alert`, `Badge`, `Progress`, and `Spinner` where their interaction model matches |
| Shell chrome | `app-layout.tsx`, `sidebar/**`, `dock-panel.tsx`, `editor-area/editor-tabs.tsx` | Shared buttons, input groups, tabs, tooltips, popovers, separators, scroll areas, and collapsibles without changing layout or drag regions |
| Inspectors and tools | `structure-info-panel.tsx`, `descriptor-panel.tsx`, `folding-results-panel.tsx`, `spectrum-viewer.tsx` | Feature components composed from shared fields, controls, cards, badges, progress, empty, and loading states |
| Welcome and failure states | `welcome/**`, `error-boundary.tsx`, dock and folding empty/loading states | Shared `Empty`, `Alert`, `Skeleton`, `Spinner`, and `Button` compositions |
| Small data views | Descriptor and inspector tables | Existing feature tables styled with shared tokens; no table framework is introduced |

The raw JSX baseline contains 171 `button`, 30 `input`, 17 `select`, one
`textarea`, and two `table` elements. The densest owners are
`structure-info-panel.tsx`, `dock-panel.tsx`, `descriptor-panel.tsx`, and
`settings-panel/setting-control.tsx`. Counts are migration indicators, not a
requirement to replace specialized controls mechanically.

Existing reusable feature boundaries are retained: `SettingsSection`,
`SettingControl`, `RadixDropdownMenu`, `ShortcutTooltip`, editor tabs, dock
tabs, structure inspector sections, descriptor workflows, and notification
state. They should compose shared primitives instead of being flattened into a
single generic component.

## Protected Runtime Contracts

The following boundaries must remain behaviorally unchanged:

- Mol*, RDKit/xyzrender, Ketcher, and the virtualized collection grid internals.
- Finder Quick Look generated assets and native menu or Tauri bridge payloads.
- Editor-tab keep-alive behavior, keyboard navigation, tab context menus, and
  document lifecycle.
- `data-tauri-drag-region` and the explicit `app-region: no-drag` controls.
- The `.app-shell` portal container used to inherit the active theme and remain
  inside hosted MCP or browser-dev surfaces.
- Browser-dev, hosted MCP widget, packaged desktop, and Quick Look runtime
  distinctions.
- Native context menus in Tauri with Radix fallback in browser surfaces.

The migration may replace the surrounding React chrome for these surfaces, but
not their rendering engines, message contracts, generated assets, or native
behavior.

## Foundation (shipped)

The component source of truth lives in `apps/desktop/src/components/ui`
(27 primitives plus the shared portal container as of 2.1.x).
`apps/desktop/components.json` configures the registry (style `radix-nova`,
`iconLibrary: "hugeicons"`, the `@animate-ui` registry), Tailwind CSS v4 is
integrated into the existing Vite build through `@tailwindcss/vite`, and the
`cn()` helper lives in `apps/desktop/src/lib/utils.ts`.

Generated primitives must map shadcn semantic tokens onto existing Burette
variables such as `--bg-base`, `--fg-base`, `--surface-*`, `--line-*`,
`--focus-ring`, and `--accent`. The app continues to select light, dark, and
automatic themes through `.app-shell[data-theme]`; no independent shadcn theme
state is allowed.

Only components required by a migration stage are installed. React Hook Form,
TanStack Table, and other high-level form or table frameworks are out of scope
unless a later measured requirement justifies them.

## Migration Stages

1. **Foundation** — *shipped.* The Radix-based shadcn source layer, Tailwind
   v4, aliases, semantic token bridge, and `cn()` are in place (see Foundation
   above).
2. **Settings and forms** — *shipped.* Settings, preference controls, and
   confirmation flows compose shadcn `Field`/`AlertDialog`/`Button`/`Card`
   primitives (`settings-panel/setting-control.tsx`).
3. **Dialogs, menus, notifications, and command** — *substantially shipped.*
   Notification presentation now uses the Sonner adapter with a
   standalone details dialog; Radix menu wrappers and the command palette keep
   their `.app-shell` portals and native-menu fallback.
4. **Shell and inspectors** — *in progress.* The Inspector (Info dock) is
   rebuilt as a section list; remaining dock/toolbar chrome migrates
   incrementally. Specialized editor-tab behavior remains feature-owned.
5. **States and small data views** — migrate welcome, error, empty, loading,
   progress, status, badges, and small tables.
6. **Completion sweep** — migrate remaining ordinary controls, remove only CSS
   proven dead by the completed replacements, and document deliberate
   exclusions.

Each stage is committed independently. Non-mechanical changes should remain
below roughly 500 changed lines and must be split before approaching 800 lines.

## Validation Matrix

Every stage must pass the smallest checks for its changed surface:

- `bun run typecheck` and `bun run build` from `apps/desktop` when TypeScript or
  build configuration changes.
- Focused UI contract tests for changed shell or component behavior.
- Browser-dev verification in light and dark themes.
- Keyboard focus, disabled, hover, error, loading, and empty states relevant to
  the migrated component.
- Hosted MCP and `.app-shell` portal behavior when overlays or menus change.

Browser-dev success does not prove packaged desktop, native menus, Finder Quick
Look, or Apple GPU behavior. Those claims require their own real runtime checks.

## Completion Criteria

The migration is complete when ordinary React controls use shared primitives or
have a documented feature-specific reason not to; semantic tokens own their
visual states; duplicate live CSS is removed; protected runtime contracts still
pass; and the browser surface is verified in both themes and representative
interaction states.

# shadcn UI Migration

## Objective

Move the ordinary React interface in `apps/desktop` onto a shared shadcn/ui
component layer without changing Burette into a generic dashboard. The target
keeps the current compact macOS-oriented chrome, system typography, dynamic
light/dark themes, 10 px control radius, and existing semantic CSS variables.
shadcn/ui is used as source-owned primitives and composition guidance, not as a
new product skin.

The migration uses the Radix base because Burette already depends on Radix
Dialog, Dropdown Menu, and Context Menu. It must not introduce a second
incompatible primitive stack.

## Inspected Baseline

The inventory below reflects the React source under `apps/desktop/src` before
the shadcn foundation was added.

| Surface | Current implementation | Migration target |
| --- | --- | --- |
| Settings and forms | `settings-panel/**`, `agent-integration-panel/**`, settings sections in `structure-info-panel.tsx`; custom buttons, inputs, selects, switches, ranges, and Radix confirmation dialogs | `Field`, `FieldGroup`, `FieldSet`, `Button`, `Input`, `InputGroup`, `NativeSelect` or `Select`, `Switch`, `Checkbox`, `Slider`, `AlertDialog`, `Card`, `Separator` |
| Dialogs and confirmations | Radix Dialog markup in `notification-popup.tsx` and `settings-panel/setting-control.tsx`; Ketcher export dialogs | Shared `Dialog` and `AlertDialog` compositions with `.app-shell` portal ownership |
| Menus | `radix-menu.tsx`, `native-context-menu.ts`, editor and project menus | Shared `DropdownMenu` and `ContextMenu` wrappers while preserving the native-menu selection boundary |
| Command palette | `command-palette/index.tsx` using `cmdk` and Radix Dialog directly | Shared `Command` inside `Dialog`, retaining current actions, keyboard navigation, and query contract |
| Notifications and status | `notification-popup.tsx`, local status rows, custom error/status panels | `Sonner`, `Alert`, `Badge`, `Progress`, and `Spinner` where their interaction model matches |
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

## Foundation

The component source of truth will live in
`apps/desktop/src/components/ui`. `components.json` belongs in `apps/desktop`,
and Tailwind CSS v4 is integrated into the existing Vite build. The `cn()`
helper belongs in `apps/desktop/src/lib/utils.ts`.

Generated primitives must map shadcn semantic tokens onto existing Burette
variables such as `--bg-base`, `--fg-base`, `--surface-*`, `--line-*`,
`--focus-ring`, and `--accent`. The app continues to select light, dark, and
automatic themes through `.app-shell[data-theme]`; no independent shadcn theme
state is allowed.

Only components required by a migration stage are installed. React Hook Form,
TanStack Table, and other high-level form or table frameworks are out of scope
unless a later measured requirement justifies them.

## Migration Stages

1. **Foundation** — configure the Radix-based shadcn source layer, Tailwind v4,
   aliases, semantic token bridge, `cn()`, and the first primitives needed by
   settings.
2. **Settings and forms** — migrate settings, preference controls, confirmation
   flows, and agent integration status. Verify labels, descriptions, reset
   behavior, disabled states, focus, and keyboard operation.
3. **Dialogs, menus, notifications, and command** — consolidate Radix wrappers,
   dialog titles/descriptions, menu items, tooltips/popovers, command palette,
   and notification presentation. Preserve `.app-shell` portals and native
   menu fallback.
4. **Shell and inspectors** — migrate sidebar search, dock/inspector chrome,
   toolbars, ordinary tab controls, scroll regions, and collapsible sections.
   Specialized editor-tab behavior remains feature-owned.
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

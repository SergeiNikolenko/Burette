# Control Affordances

Burrete uses compact toolbars, icon buttons, short mode labels, and embedded
viewer controls. Every control whose visible text is abbreviated, icon-only, or
domain-specific must expose a short explanation on hover and keyboard focus.

## Capability Routing

- Invoke `@product-design` before changing product flows, information
  architecture, prototypes, or user-facing workflow direction.
- Invoke `$apple-design` before Apple-platform UI, SwiftUI/AppKit, icon,
  typography, accessibility, or Human Interface Guidelines decisions.
- Invoke `@build-ios-apps` or `@build-macos-apps` when UI work needs native
  iOS/macOS build, run, screenshot, log, simulator, device, or Xcode validation.

## SF Symbols And Icon Sets

- For Apple-platform UI or native shell work, invoke `$apple-design` and check
  Apple Design Resources / SF Symbols before adding a custom icon.
- Prefer SF Symbols when a symbol matches the action, state, or object and the
  target surface can render Apple system symbols natively.
- Keep existing web icon libraries for browser/runtime surfaces unless the task
  explicitly migrates the icon system. Do not mix icon systems opportunistically
  in one surface.
- Use product-specific or molecular icons only when SF Symbols does not express
  the domain concept clearly.
- Do not use text-in-a-rounded-rectangle as a pseudo-icon when a recognizable
  system symbol or existing icon exists.
- Every icon-only control still needs an accessible label plus tooltip or menu
  detail.

## Required Tooltip Coverage

Add a tooltip or menu detail when introducing:

- icon-only buttons
- abbreviated buttons such as `L`, `R`, `Seq`, `Mol*`, `xyzr`, or `3D`
- renderer and mode switches
- import, export, save, copy, and destructive actions
- controls inside embedded runtimes such as Mol*, `xyzrender`, Grid, and Ketcher

Use plain, action-oriented copy. Prefer "Open selected molecules in Molstar" or
"Render cards with external xyzrender" over generic labels such as "Open" or
"Mode".

## Implementation Surfaces

- React shell buttons should use `ShortcutTooltip` from
  `apps/desktop/src/components/shortcut-tooltip.tsx`.
- Radix menu items should use `detail` on `MenuItemSpec` when the menu choice
  needs explanation.
- Preview runtime controls in `PreviewExtension/Web/viewer-shell.js` should use
  the `.buret-tooltip` element styled by `PreviewExtension/Web/viewer-runtime.css`.
- Grid controls in `apps/desktop/src/preview-grid/grid-ui.tsx` should use
  `.buret-control-tooltip`, styled by `PreviewExtension/Web/grid.css`.
- Ketcher internal toolbar controls use the tooltip injection in
  `apps/desktop/src/components/ketcher-page.tsx`; add new Ketcher `data-testid`
  mappings there when Ketcher adds new buttons.

## Verification

For tooltip work, verify both pointer and keyboard focus where practical. For
viewer-runtime changes, open a local browser-dev sample and check dark and light
themes because the tooltip background follows runtime theme tokens.

# Isolated molecule preview

Run from the repository root:

```sh
vp dev apps/desktop --host 127.0.0.1 --port 1497 --strictPort --config apps/desktop/vite.config.ts
```

Open `/dev/molecule-preview.html` in the in-app Browser. This development-only
fixture reads the production card markup, CSS, geometry and hide/restore handlers.
RDKit draws GDP; three fixture instances exercise the navigation controls.
Ketcher is disabled because this page has no workspace host. Lasso and zoom use
the production interaction controller; selection highlights atoms locally. Copy
uses the production feedback handler, including success/failure and reset.

Check both appearances, edge resize, hide, background click, Escape, and restore
using the bottom chip. Selection changes and document teardown are covered by
`tests/test-molecule-preview-interactions.mjs`. This is not native-app acceptance.

## Form dialogs

Open `/dev/forms.html` on the same development server to exercise the production
Merge Columns and Calculated Values dialogs. Switch Light/Dark before opening a
form. Inputs, validation, dismissal and submitted arguments use real components;
outcomes are kept in page memory and never write files or start compute jobs.
The same page exercises shared default/form dialogs, a nested popover, and the
slide-from-left popover. Check Escape/focus restoration and a narrow viewport.

The connection list uses the production `SshConnectionsList` with in-memory
connections. Its menu, enable switch, status, and removal confirmation are live;
no SSH request or saved connection is changed. `build-box` checks succeed,
`Research` checks fail, and Add folder renames the fixture row to `Structures`.

## Welcome and contextual guides

Open `/dev/onboarding.html` to see the three first-visit steps and every
contextual guide. Cards and full-size previews render the production
`OnboardingContent` and `ContextualGuideCard`; each guide card lists where it
appears and the user action that first shows it, from `contextual-guides.ts`.
Light/Dark changes only this page. Previews never change saved onboarding
progress. Each card has a stable fragment, such as `#welcome` or `#guide-ketcher`.

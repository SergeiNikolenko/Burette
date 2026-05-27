# Writer Computer Shell Port

This spec is the source of truth for replacing the current Burrete desktop
shell with a Writer Computer-style shell while keeping Burrete's application
logic.

## Goal

Burrete must look and feel like Writer Computer at the shell level. This is not
a sidebar polish pass. It is a shell migration: sidebar, top chrome, tabs,
search, tree rows, spacing, typography, colors, translucency, dimming, button
states, and light/dark themes must be treated as one coherent system.

The Writer Computer repository may be used as a direct implementation
reference, including component structure, package structure, CSS organization,
and modules where appropriate. Burrete-specific data flow, molecular preview
logic, Quick Look behavior, renderer errors, project handling, and file actions
must remain Burrete's own logic unless explicitly replaced by a compatible
adapter.

## Reference

- Repository: `https://github.com/joelbqz/writer-computer`
- Product reference: `https://writer.computer/`
- Primary areas to inspect in the reference repository:
  - `apps/desktop/src/App.css`
  - `apps/desktop/src/components/sidebar/index.tsx`
  - `apps/desktop/src/components/sidebar/file-browser.tsx`
  - `apps/desktop/src/components/sidebar/file-tree-node.tsx`
  - `apps/desktop/src/components/sidebar/workspace-switcher.tsx`
  - `assets/screenshot.png`

## Interpretation

The intended result is not "similar to Writer Computer". The intended result is
that Burrete uses Writer Computer as the visual and interaction baseline.

The shell should be copied or ported as a system where that is useful, then
adapted to Burrete's data model. Avoid incremental local tweaks that preserve
the old Burrete visual language.

## Scope

Port or reproduce these shell surfaces:

- macOS-style window chrome and traffic-light area
- left sidebar width, density, padding, and visual hierarchy
- sidebar search control
- workspace/library switcher area where applicable
- file/project tree rows
- folder/file icons, indentation, disclosure affordances, and truncation
- selected, hover, pressed, focus, and disabled states
- top navigation controls
- tab strip and active tab treatment
- main content background relationship to the shell
- light and dark theme token pairs
- translucent, blurred, dimmed, and shadowed surfaces
- motion timing for buttons, rows, tabs, and controls

Do not treat these as separate style patches. The shell must read as one
continuous Writer Computer interface.

## Burrete Mapping

Use this mapping unless implementation discovers a better fit:

- Writer workspace tree maps to Burrete project roots and grouped structures.
- Writer file row maps to a Burrete structure/document row.
- Writer selected file maps to the active Burrete document/tab.
- Writer tab maps to an open Burrete document tab.
- Writer search maps to Burrete project and structure search.
- Writer workspace switcher/library maps to the closest Burrete project/library
  affordance, without adding extra UI that the reference shell does not need.
- Writer editor/content area maps to Burrete's molecular viewer, grid viewer,
  or renderer error surface.

The mapping must preserve Burrete behavior: opening files, switching tabs,
closing documents, showing renderer errors, and using project data must keep
working.

## Elements To Remove From The Current Shell

The migrated shell must not keep old Burrete sidebar artifacts that conflict
with the Writer Computer reference:

- root path subtitles under project names
- item subpaths under file names
- "Recent" badges
- project counters rendered as pills
- per-project open-folder micro buttons inside tree rows
- card-like active folder rows
- bordered nested cards inside the sidebar
- oversized row heights or heavy shadows that are not present in the reference

If any of these capabilities are still needed, expose them through a
Writer-compatible interaction pattern instead of keeping the old visual element.

## Visual Requirements

Match the reference at the shell level:

- Use the same apparent sidebar density, row height, icon size, text size, and
  spacing.
- Use the same apparent border radius scale for search, rows, tabs, and
  controls.
- Use the same selected-row and active-tab visual weight.
- Use the same muted/inactive text treatment and truncation behavior.
- Use the same dark-mode contrast and translucent surface feel.
- Provide a light theme that is designed as the paired light equivalent of the
  same shell, not a separate Burrete palette.
- Replace Writer Computer's orange accent with Burrete purple `#af52de` across
  focus rings, selected controls, toggles, menus, drop states, and any other
  accent-bearing shell affordance.
- Keep transitions smooth and short; pressed states should feel immediate and
  physical, not delayed or decorative.

## Implementation Guidance

Start from the reference shell structure before editing details. Prefer a
single coherent port over scattered CSS overrides.

Use adapters at the boundary between Writer-style components and Burrete state.
The adapter should translate Burrete projects, structures, open documents, and
actions into the props expected by the shell components.

Keep the implementation inspectable:

- shell components should stay small and named around their UI role
- domain logic should remain outside visual-only components
- copied or ported modules should be adapted intentionally, not mixed with old
  Burrete shell code by accident
- tests should verify the absence of old shell artifacts and the presence of
  required shell contracts

## Verification

The implementation is not done until all of the following are true:

1. The local app at `http://127.0.0.1:1420/` is served from the current checkout,
   not from another worktree.
2. A browser screenshot of Burrete visually matches the Writer Computer shell
   reference for sidebar, top chrome, tabs, row density, color, and interaction
   states.
3. Both light and dark themes have been checked.
4. Sidebar rows no longer show old Burrete artifacts listed in this spec.
5. Opening a project, opening a structure, switching tabs, and closing tabs still
   work.
6. Renderer error surfaces still appear inside the content area without breaking
   the shell layout.
7. `vp check` passes without errors.
8. `vp test` passes.
9. `vp build` passes.

## Use Of Subagents

Use subagents for this work when available. Recommended narrow scopes:

- Reference scout: inspect Writer Computer shell components, CSS, assets, and
  packages; return exact files and behaviors to port.
- Burrete mapping scout: inspect current shell stores, sidebar data flow, tabs,
  and project actions; return the safest adapter boundary.
- Visual QA scout: inspect the running app after implementation and list
  remaining mismatches against the Writer Computer reference.

Main-agent responsibility remains final integration, code review, verification,
and user-facing reporting.

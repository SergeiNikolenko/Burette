---
version: alpha
name: Burrete Molecular Glass
description: Finder-native molecular preview system derived from Writer Computer's restrained translucent macOS workspace language.
colors:
  primary: "#ff6a00"
  on-primary: "#111111"
  secondary: "#8fc7ff"
  on-secondary: "#071923"
  tertiary: "#0b6bcb"
  on-tertiary: "#ffffff"
  background: "#101010"
  on-background: "#f7f7f7"
  surface: "#0e1014"
  surface-container-low: "#181b21"
  surface-container: "#1f232b"
  surface-container-high: "#323232"
  surface-light: "#f5f3ef"
  on-surface-light: "#171716"
  outline: "#3d4148"
  outline-variant: "#252932"
  muted: "#c1c7d1"
  faint: "#6f7680"
  canvas-black: "#000000"
  canvas-graphite: "#111317"
  canvas-white: "#f7f7f2"
  error: "#ff8f8f"
  on-error: "#2d0000"
typography:
  headline-lg:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, Segoe UI, sans-serif"
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0em
  headline-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0em
  body-md:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0em
  body-sm:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0em
  label-md:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0em
  label-sm:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.06em
  data-sm:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0em
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  modal: 16px
  full: 9999px
spacing:
  unit: 8px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  chrome-control: 32px
  preview-control: 26px
  chrome-height: 56px
  drag-region-height: 72px
  sidebar-min: 220px
  sidebar-default: 268px
  sidebar-max: 420px
  grid-card-min: 230px
  grid-card-gap: 12px
  molecule-picture-min-height: 190px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 12px
  button-primary-hover:
    backgroundColor: "#e17909"
  button-secondary:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-background}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 12px
  button-secondary-hover:
    backgroundColor: "{colors.surface-container-high}"
  chrome-icon-button:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 32px
    width: 32px
  chrome-icon-button-hover:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-background}"
  tab-active:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-background}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 0 14px
  sidebar-list-item:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 6px
  sidebar-list-item-hover:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-background}"
  preview-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-background}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.xl}"
    padding: 6px
  preview-toolbar-button:
    backgroundColor: transparent
    textColor: "{colors.on-background}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    height: 26px
    padding: 0 7px
  molecule-grid-card:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 12px
  molecule-grid-card-selected:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-background}"
    rounded: "{rounded.lg}"
  molecule-grid-filter:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-background}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    height: 34px
    padding: 7px
  status-badge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.data-sm}"
    rounded: "{rounded.lg}"
    padding: 8px
  window-background:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-background}"
  renderer-active-dark:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    height: 26px
    padding: 0 7px
  renderer-active-light:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    height: 26px
    padding: 0 7px
  settings-panel-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface-light}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 18px
  separator-line:
    backgroundColor: "{colors.outline}"
    height: 1px
  separator-line-subtle:
    backgroundColor: "{colors.outline-variant}"
    height: 1px
  metadata-muted:
    backgroundColor: transparent
    textColor: "{colors.faint}"
    typography: "{typography.body-sm}"
  preview-canvas-black:
    backgroundColor: "{colors.canvas-black}"
    textColor: "{colors.on-background}"
  preview-canvas-graphite:
    backgroundColor: "{colors.canvas-graphite}"
    textColor: "{colors.on-background}"
  preview-canvas-white:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.on-surface-light}"
  error-badge:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.data-sm}"
    rounded: "{rounded.lg}"
    padding: 8px
---

# Burrete Molecular Glass

## Overview

Burrete should feel like a Finder-native instrument panel for molecular
inspection: quiet, compact, and precise. The visual foundation comes from
Writer Computer's translucent macOS/Tauri shell, but the domain is different:
the main object is always a molecule, structure, grid, or renderer state, not a
document editor.

The product personality is technical and calm. The shell recedes into dark
glass and compact chrome while structure viewers, molecule cards, and renderer
controls stay readable. Avoid marketing-style layouts, decorative backgrounds,
and oversized explanatory panels inside the app. The first viewport is the
working surface.

## Colors

The palette combines Writer's warm orange command accent with Burrete's cool
molecular preview accent.

- **Primary Orange (#ff6a00):** Inherited from Writer's command system. Use it
  sparingly for the most important shell action, update state, or focused
  Finder/app command.
- **Molecular Cyan (#8fc7ff):** The preview accent for dark renderer surfaces,
  Mol* controls, molecule-grid focus rings, and selected molecular entities.
- **Scientific Blue (#0b6bcb):** The light-mode equivalent of molecular cyan.
  Use it where cyan would lose contrast on bright preview backgrounds.
- **Graphite Surfaces (#101010, #0e1014, #111317):** Dark shell and canvas
  foundations. These should feel close to macOS graphite, not pure black UI.
- **Warm Light Surface (#f5f3ef and #f7f7f2):** Light-mode settings and white
  preview backgrounds. Keep it slightly warm so it does not feel like a blank
  browser page.
- **Element Colors:** Atom and structure colors are scientific data, not brand
  decoration. Do not remap CPK or renderer-provided colors to match the brand
  palette.

## Typography

Use Apple's system fonts throughout the app shell and preview chrome. This is a
native macOS utility, so typography should follow platform expectations instead
of establishing a separate editorial voice.

- **Headlines:** 18-24px, semibold, system display stack. Use for settings
  titles, empty states, and grid headers only.
- **Body and Controls:** 13px system text is the default for tabs, sidebars,
  status rows, settings rows, and compact controls.
- **Labels:** 11px-13px semibold labels work for toolbar controls, renderer
  mode chips, filter labels, and metadata. Use uppercase only for short
  technical labels such as "SMARTS" or file-format badges.
- **Data:** Use the monospace token only for paths, logs, flags, and compact
  molecular metadata. Do not use monospace for normal app navigation.

## Layout

The shell follows Writer's compact workspace pattern: fixed-height chrome,
resizable sidebar, central working stage, and a small persistent status bar.

- Top chrome is 56px high, with 32px controls and a 72px drag region so the
  window still behaves like a macOS app.
- The sidebar is a utility rail, not a file browser product surface. Keep it
  between 220px and 420px, with 268px as the default.
- The main stage belongs to the active renderer. Avoid nesting renderer content
  inside cards or framed previews.
- Molecule-grid cards use a responsive grid with 230px minimum cards, 12px gaps,
  and stable picture areas so filtering, sorting, and loading do not shift the
  layout.
- Settings pages may use a centered 760px content column, but preview surfaces
  should stay full-bleed.

## Elevation & Depth

Depth is created with translucent graphite layers, blur, and fine borders. Use
shadows only to separate floating toolbars and molecule cards from live canvas
content.

- **Shell Layer:** `background` with high opacity and a broad blur. It should
  feel integrated with macOS vibrancy.
- **Sidebar and Status Layer:** Slightly stronger surface fill with 1px lines.
  These areas hold utility information, so avoid deep shadows.
- **Preview Toolbar Layer:** Floating dark glass with 10-18px blur, 1px
  low-opacity border, and a soft shadow when it sits over 3D content.
- **Molecule Grid Layer:** Cards may use a modest 8-14px shadow and an inset
  highlight. Keep shadows low enough that chemical drawings remain primary.
- **Transparent Preview Mode:** Treat transparency as a canvas mode only. Do
  not let shell controls become unreadable over arbitrary desktop backgrounds.

## Shapes

The shape language is compact and technical. Most controls use an 8px radius,
with larger radii reserved for floating overlays.

- 6px for the smallest preview toolbar buttons and inline controls.
- 8px for tabs, sidebar items, standard buttons, and settings controls.
- 10px for molecule cards, search fields, and grid toolbar groups.
- 12px for drop overlays and floating preview toolbars.
- 16px only for modal or command-palette style surfaces.

## Components

### Chrome Controls

Tabs, sidebar toggles, and text buttons should keep the Writer pattern: 32px
height, transparent default state, subtle graphite hover fill, and semibold 13px
labels. Active tabs use a stronger surface, not a bright accent fill.

### Preview Toolbars

Preview controls float above Mol*, fast XYZ, xyzrender, and grid surfaces. They
should be compact, movable when supported, and visually quieter than the
molecule. Use cyan or blue only for active renderer state and focus; avoid
orange in the preview unless it represents an app-level command.

### Molecule Grid

Grid cards should privilege chemical drawings and metadata. Use dark or light
surface tokens depending on the selected theme, stable card dimensions, small
metadata labels, and clear selected/focused states. Search, SMARTS filters, sort
menus, and export controls share the 34px grid-filter component token.

### Settings

Settings should use native SwiftUI/AppKit conventions where possible. When the
Tauri shell renders settings, match the token system but keep the density and
alignment close to macOS Form controls.

### Status And Diagnostics

Status badges, runtime errors, paths, and logs use the monospace data token only
when the content benefits from fixed-width scanning. Error states use the error
tokens and should never be encoded by color alone.

## Do's and Don'ts

- Do keep the molecule, molecular grid, or renderer output as the visual focus.
- Do use orange for app-level command emphasis and cyan/blue for molecular
  preview interaction.
- Do keep controls compact and stable: 26px preview buttons, 32px shell
  controls, and 34px grid filters.
- Do preserve native macOS behavior for titlebar drag, sidebar density, focus
  rings, and settings forms.
- Do maintain light and dark variants for preview chrome because canvas
  backgrounds can be black, graphite, white, or transparent.
- Don't turn the app into a landing page or explanatory dashboard.
- Don't put the 3D viewer or grid inside decorative cards.
- Don't override scientific atom or renderer colors for brand consistency.
- Don't rely on transparency without enough contrast for arbitrary Finder or
  desktop backgrounds.
- Don't mix large editorial typography into compact settings, sidebars, tabs, or
  toolbars.

---
name: Burrete
description: Finder-native molecular structure previews for macOS.
colors:
  accent-blue: "#0169CC"
  shell-dark: "#111111"
  shell-light: "#FFFFFF"
  shell-dark-text: "#FCFCFC"
  shell-light-text: "#0D0D0D"
  shell-dark-line: "#353630"
  shell-light-line: "#D7D1C8"
  shell-danger: "#D96A61"
  shell-danger-bg: "#40201D"
typography:
  title:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.shell-dark-text}"
    rounded: "{rounded.sm}"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.shell-light}"
    textColor: "{colors.shell-light-text}"
    rounded: "{rounded.sm}"
    height: "36px"
  field-default:
    backgroundColor: "{colors.shell-light}"
    textColor: "{colors.shell-light-text}"
    rounded: "{rounded.sm}"
    height: "36px"
  tab-active:
    backgroundColor: "{colors.shell-light}"
    textColor: "{colors.shell-light-text}"
    rounded: "{rounded.sm}"
---

# Design System: Burrete

## Overview

**Creative North Star: "The Native Lab Utility"**

Burrete should feel like a focused macOS utility for molecular inspection: compact, quiet, and highly reliable. The shell is a product workspace, not a brand canvas. It should support quick file triage, renderer switching, recent-file recall, and maintenance actions without drawing attention away from the previewed structure.

This system favors restrained product UI patterns over decorative novelty. Surfaces stay calm, typography stays system-native, and motion exists only to confirm state or reveal hierarchy. The desktop shell should look like a serious tool that belongs next to Finder, not like a generic web dashboard wrapped in Tauri.

Key Characteristics:
- native-feeling macOS chrome and controls
- restrained color with a single working accent
- compact but readable spacing
- visible focus and explicit interactive states
- consistent vocabulary across sidebar, tabs, palette, settings, and status surfaces

## Colors

The palette is restrained and utility-first. Most of the interface runs on neutrals, while the accent exists for state, primary actions, and active selection.

### Primary
- **Command Blue** (`#0169CC`): used for focus, primary actions, active accents, and the most important state changes. It should stay rare enough that it still reads as intent.

### Neutral
- **Graphite Shell** (`#111111`): the default dark shell background for the desktop workspace.
- **Codex White** (`#FFFFFF`): the light shell background for the desktop workspace.
- **Porcelain Text** (`#FCFCFC`): primary text on dark shell surfaces.
- **Carbon Text** (`#0D0D0D`): primary text on light shell surfaces.
- **Dark Line** (`#353630`): dark-theme separators, borders, and container definition.
- **Light Line** (`#D7D1C8`): light-theme separators, borders, and container definition.

### Named Rules
**The Molecule First Rule.** Accent color highlights action and state, not decoration. The molecular preview remains the visual focal point.

## Typography

**Display Font:** none. Burrete does not use a display face in the shell.
**Body Font:** system UI stack (`-apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif`)
**Label/Mono Font:** the same system UI stack for labels, with monospace only inside error or log surfaces when literal runtime text is shown

**Character:** the shell should read like a native desktop tool, not like a marketing site. Typography should be compact, legible, and stable across tabs, settings, menus, and maintenance surfaces.

### Hierarchy
- **Title** (500, 13px, 1.2): tabs, primary control labels, document rows, settings labels.
- **Body** (400, 13px, 1.35): descriptions, status copy, supporting text, empty states.
- **Label** (600, 11px, 1.2): section headings, compact metadata, command group labels.

### Named Rules
**The No Display Type Rule.** Buttons, tabs, settings, and status surfaces use the same system family. Burrete earns trust through consistency, not flourish.

## Elevation

Burrete should stay mostly flat. Depth comes from layered neutral surfaces, borders, and focused highlights rather than heavy blur or floating glass panels. Overlays such as the command palette or status surface may separate themselves slightly from the workspace, but they should still feel like part of the same restrained shell.

### Named Rules
**The Flat-At-Rest Rule.** Default shell surfaces are calm and solid. Elevation appears only when it improves clarity, never as decorative atmosphere.

## Components

### Buttons
- **Shape:** soft rectangles with 8px radius.
- **Primary:** accent background with high-contrast text for the launcher's main open action and the most important call to action in a local surface.
- **Secondary / Utility:** neutral filled buttons for maintenance and navigation actions.
- **Hover / Focus:** hover slightly increases contrast; focus uses an explicit ring, not just a tint shift.

### Sidebar Search
- **Style:** quiet input surface with icon-leading layout and explicit border/focus state.
- **Behavior:** filters open and recent structures in place; does not masquerade as a separate command palette entrypoint.

### Tabs
- **Style:** compact product tabs with reserved space for close controls.
- **Active State:** active tabs must be distinguishable by both fill and boundary treatment, not color alone.
- **Close Control:** close buttons remain keyboard reachable and reveal themselves on hover or focus within the tab shell.

### Lists and Rows
- **Structure Rows:** open/recent structure rows use the same spacing, text treatment, and close-control behavior as the tab vocabulary.
- **Active Row:** active selection uses surface contrast plus a structural cue such as inset border treatment.

### Settings
- **Containers:** settings groups live in bordered, low-elevation cards with consistent internal spacing.
- **Controls:** selects, toggles, and action buttons use the same corner radius and state vocabulary as the rest of the shell.

### Overlays
- **Command Palette:** modal product surface with dialog semantics, solid background, and clear selection state.
- **Status Surface:** compact informational panel with semantic success/error treatment and readable supporting details.

## Do's and Don'ts

### Do:
- **Do** keep the shell visually restrained and let the preview content carry the session's visual weight.
- **Do** use a single system UI family across tabs, settings, command palette, and launcher controls.
- **Do** show explicit focus rings on controls that matter to keyboard users.
- **Do** keep sidebar, tabs, palette, and settings on the same component vocabulary: matching radii, heights, and state transitions.
- **Do** separate shell theming from the molecular canvas background preference.

### Don't:
- **Don't** use glassmorphism as the default language for the app shell.
- **Don't** hide active state behind color alone; tabs and rows need a structural cue too.
- **Don't** replace native-feeling titlebar behavior with experimental chrome tricks.
- **Don't** let destructive or error states depend on raw hard-coded colors outside the token system.
- **Don't** ship a launcher that hides the primary file-open action behind secondary navigation.

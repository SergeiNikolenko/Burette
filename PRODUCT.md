# Product

## Register

product

## Users
Burrete is for macOS users who inspect molecular structure files as part of a technical workflow. The primary users are computational chemists, structural biologists, cheminformaticians, and related researchers who need a fast way to open, compare, and triage structures without launching a heavyweight modeling environment. They often come from Finder, want immediate visual feedback, and expect the shell to stay out of the way while preserving access to renderer choices, recent files, and maintenance actions.

## Product Purpose
Burrete provides Finder-native structure previews and a compact desktop workspace for molecular files. It exists to make routine inspection fast: open a file, confirm what it is, switch renderer when needed, compare multiple structures in tabs, and recover quickly when preview infrastructure needs maintenance. Success means the app feels like a reliable macOS utility with domain-specific rendering power, not like a generic web dashboard wrapped in a desktop window.

## Brand Personality
Practical, native, restrained.

The product voice should communicate quiet competence. Burrete should feel precise, familiar, and trustworthy, with a native macOS sensibility and minimal visual noise. The shell is not the star of the experience; the molecular content is. The interface should signal control and predictability, especially when users are switching renderers, reopening recent files, or diagnosing preview issues.

## Anti-references
- Decorative glassmorphism used as the default visual language.
- Loud SaaS dashboard aesthetics with hero-metric cards, saturated inactive states, or ornamental gradients.
- Experimental frameless-window behavior that sacrifices native macOS expectations.
- Inconsistent component vocabulary where tabs, buttons, menus, and settings controls each look like they came from a different app.

## Design Principles
- Preserve native macOS expectations. Window chrome, focus behavior, and command surfaces should feel familiar to a macOS user.
- Keep the shell subordinate to the molecule. The content and renderer state matter more than decorative UI treatment.
- Prefer restrained product patterns. Use familiar controls, compact spacing, and consistent states instead of inventing new affordances.
- Make maintenance and recovery obvious. Logs, cache reset, Quick Look reset, renderer switching, and update checks must stay easy to discover and operate.
- Treat desktop shell and preview runtime as connected but separate layers. The shell orchestrates files, tabs, and preferences; the preview runtime renders the molecule.

## Accessibility & Inclusion
Burrete should target practical WCAG AA behavior for the desktop shell surfaces. Every interactive shell surface must be reachable by keyboard, focus indicators must be visible, icon-only controls must have accessible names, and the command palette and launcher must remain operable without a pointer. Screen-reader-perfect narration inside embedded molecular canvases is not required in v1, but the surrounding shell must expose structure, state, and maintenance actions clearly.

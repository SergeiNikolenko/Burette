# Interaction Principles

Apply these rules when changing a Burette workflow. Examples below are design
targets, not an audit or a claim of implemented behavior. Reuse the existing
components, themes, scientific selection semantics, and native conventions in
[Design Direction](design-system.md).

## Rules

1. **Make progress truthful and useful.** Acknowledge the action promptly. For
   measurable work, show completed/total items; show failures separately. With an
   unknown total, show the actual activity without an invented percentage or ETA.
   Distinguish loading a file from having a usable, interactive molecular view.
2. **Deliver useful output as soon as it is ready.** Keep existing content usable
   during loading. Reveal valid partial results when supported. Do not reset the
   camera, selection, filters, scroll, or layout as more results arrive.
3. **Finish at the user's result.** Completion should expose the resulting file,
   view, or selection and one relevant next action. A toast alone is insufficient
   if the user must hunt for output. Avoid celebratory overlays in routine work.
4. **Make effort visible without manufacturing it.** Never add artificial delays,
   fake checks, fake progress, or minimum spinner durations to imply rigor.
   Prevent flicker by delaying the appearance of loading chrome when appropriate,
   never by delaying a ready result. A fast result does not require an apology.
5. **Reduce simultaneous decisions.** Keep frequent actions near the selected
   object. Put advanced options in an existing disclosure/menu. Keep scientific
   choices that materially affect interpretation visible at the relevant decision.
   Do not turn this rule into new toolbars, mandatory wizards, or feature removal.
6. **Give emphasis a purpose.** Use one primary action per task context, clear
   selection and keyboard focus, and stable placement. Prefer structure and
   labels over additional badges, illustrations, or colors. Do not reuse molecular
   coloring for decorative UI emphasis or make UI state depend on color alone.
7. **Preserve control and make recovery cheap.** Prefer undo for reversible
   changes, cancellation for long work where supported, and retry of failed items
   without discarding successful ones. Preserve original coordinates and files.
   State an irreversible effect before its commit point; do not confirm every click.
8. **Keep action and feedback connected.** Selecting a table row, pose, residue,
   or molecular feature should identify the same object in the associated view.
   Hover may preview; clicking commits. Do not silently move the camera on hover.
   Preserve an explicit way back after focus/isolation or alignment.
9. **Prefer recognition and consistency.** Use the same names and semantics for
   the same actions across menus, shortcuts and supported surfaces. Show the
   current selection/scope at the action: selected, filtered, or all molecules.
   Keep both keyboard and pointer routes discoverable.
10. **Make errors actionable without erasing work.** Keep valid files and edits
    intact. Identify the affected item and a concrete recovery action. Technical
    diagnostics belong in the existing details surface, not routine UI chrome.
    Scientifically meaningful values, units and comparability information belong
    beside the result when needed for interpretation; do not add generic caveats.

## Concrete Workflow Targets

| Scenario | Intended behavior | Acceptance observation |
| --- | --- | --- |
| Open 20 structures | Show actual loaded/total counts; make loaded structures usable while the remainder load | One failed file remains identifiable; other structures can still be inspected |
| Align a structure set | Retain the reference, show successful/failed counts and applicable RMSD with units; expose undo and failed items | Partial alignment is not presented as complete success; undo restores original placement |
| Review docking poses | Choosing a pose updates the same viewer and preserves the comparison context | Switching poses does not repeatedly rebuild the shell or lose the user's orientation |
| Filter and export a collection | Make selected/filtered/all scope explicit before export; expose the saved file after success | Exported record count matches the chosen scope; failure preserves selection |
| Edit a molecule | Keep drawing primary, show the active tool, and retain undo/redo and useful contextual actions | A researcher can change a bond and recover without navigating a dense settings panel |
| Inspect a trajectory | Keep playback controls and position stable; separate buffering from scientific time/frame values | Pause, seek and view manipulation remain predictable during loading |

## Acceptance Checklist

For a changed workflow, record evidence in the PR/review, not in product chrome:

- Name the user's task, starting state, expected result and intended surface.
- Exercise success, slow work, empty input, partial failure and recovery as applicable.
- Can the user tell what was accepted, what is running and what is ready?
- Can the user reach the actual result without an extra search or forced modal?
- Does cancellation/undo/retry preserve valid work and the relevant view state?
- Are selection, focus, disabled controls and progress accessible in both themes?
- For motion changes, honor reduced motion and keep interaction available.
- Compare task completion, errors and time to the first usable result; do not use
  a "10x" claim or cosmetic animation as evidence of improvement.
- Verify each affected runtime separately: browser, packaged macOS, Quick Look,
  mobile or embedded widget. Do not infer acceptance across those boundaries.

## Rationale And References

Goal-gradient, peak-end, salience and choice-overload ideas motivate these
requirements; they are context-dependent heuristics, not guaranteed multipliers.
For repeated scientific work, speed, recoverability and accurate interpretation
take precedence over engagement tricks.

- [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [Progress indicators](https://www.nngroup.com/articles/progress-indicators/)
- [Video that prompted this discussion](https://www.youtube.com/watch?v=MVOpq3WRnbo)

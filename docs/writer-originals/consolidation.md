# Consolidation

A small set of structural principles for keeping state, behavior, and data in one place. The unifying smell test: _if I add the next thing in this domain, how many files do I edit?_ If the answer is more than one, the structure is wrong. Each principle below is here because we've already been bitten by ignoring it.

These are reasoning frameworks, not rules. When you find yourself making one of these mistakes — fix the structure, don't paper over the symptom.

---

## Single source of truth

When a value or shape is defined in two places, one must derive from the other.

**Why it matters.** Two declarations drift. The drift surfaces as a bug nobody can reproduce because the two halves were checked separately. The cost of the drift is paid by the person debugging six months later, not the person who wrote the duplication.

**Smells.**

- The same key appears in a Rust struct _and_ a TypeScript interface, with the values typed by hand on each side.
- Defaults declared in one file and re-declared as fallback values in another.
- A list of fields written in code A's switch statement and again in code B's iteration order.
- A schema described in config and re-described in a control-rendering list.

**Worked example.** Theme primaries had defaults in three places: `default_settings()` in Rust, `settings_schema()` in Rust, and `theme-presets.ts` in TS. Adding a new setting required editing three files; forgetting any one produced a subtle inconsistency (e.g. preset selector showing a value that didn't match the actual default). The fix: pick one to own (a JSON schema file), have the others derive.

**When duplication is OK.** Rare. Performance-critical mirrors (e.g. a hot-path cache) can justify it, but only if the derivation is enforced — codegen, a lint rule, or a runtime assertion that the two are equal. "We'll remember to update both" is not enforcement.

---

## Don't hardcode lists you already iterate

Per-key branches (`if key === "x" do A; if key === "y" do B`) mean the keys are data. Promote them to a registry and iterate.

**Why it matters.** Per-key branches scale linearly with the number of cases and don't notice when a case is missing. Adding the next case requires editing the switch in every file that has one. The compiler can't help you find them all.

**Smells.**

- A function with one branch per setting/feature/event type, especially if the branches do roughly the same thing with different parameters.
- A "list of things" written as code (a sequence of `setSetting("a", ...)`, `setSetting("b", ...)`, `setSetting("c", ...)`) when the list could be a data structure iterated over.
- Multiple files containing the same set of `if`/`switch` cases — `setting-control.tsx` knows the types, `themes-section.tsx` knows the keys, `use-editor-settings.ts` knows another subset, and they go out of sync.

**Worked example.** `themes-section.tsx#applyPreset` had seven hardcoded `setSetting(settingKey(mode, "accent"), p.accent)` lines, one per primary. Adding a new primary token required edits in this function, in `parseThemeImport`, in `exportTheme`, and in `matchesPreset` — four parallel iterations of the same list. A registry-driven `Object.entries(preset).forEach(([k, v]) => setSetting(k, v))` collapses all four to one.

**Refactor recipe.** When you spot it: lift the per-case data into a typed array or record at module scope; replace each call site with a fold over the data; remove the branches.

---

## Side effects belong with their owner

If a store owns a domain, it owns the side effects of mutating that domain. Don't call them from hydration paths, from call sites, or from anywhere outside the store.

**Why it matters.** Side effects sprinkled across call sites can't be added to or changed in one place. The next person who adds a side effect (a new CSS variable, a metric emission, a cache invalidation) updates the store but forgets the hydration path, and the bug only manifests on cold start. The compiler can't catch it because the call sites _do_ have all required arguments — they just lack the new one.

**Smells.**

- A call site that does `useStore.setState({ ... })` directly to load data, instead of going through a method.
- The same effect (`applyTheme`, `flushCache`, `emitEvent`) called from both the store and the call site.
- A "side effect helper" exported from a store module so external code can apply it itself.

**Worked example.** `use-open-drop.ts` hydrated settings on startup by calling `useSettingsStore.setState({ settings, schema, isLoaded: true })` directly, then calling `applyTheme(settings["appearance.theme"])` separately to push CSS variables. When the theming refactor added six more CSS variables to push, `applyTheme`'s implementation needed `settings` to read the primary tokens — but the startup call site had been written before that requirement existed and silently passed only the first argument. Initial paint used defaults; only after the user edited a setting did the store's `setSetting` (which went through the proper pipeline) push the real values.

The fix: the store now exposes `hydrateFromBackend({ settings, schema })` which is the single entry point. It runs the same `applySettingsSideEffects` that runtime mutations use. No external file imports `applyTheme`.

**Test for ownership.** If you add a side effect and have to update more than one file to make it run, the side effect doesn't have a clear owner. Refactor until adding the next one is a single-file change.

---

## Funnel writes through one path

Hydration, mutation, and reset should all reach the same downstream pipeline. Branches that bypass the pipeline silently miss future side effects.

**Why it matters.** This is the corollary to the previous principle. When a store has multiple "ways to set state" — `setSetting`, `resetSetting`, `loadSettings`, `updateFromBackend`, plus external `setState` calls — every new side effect has to be added to every entry point. The number of places to update grows with the number of entry points, not with the size of the change.

**Smells.**

- A store with `setX`, `loadX`, `hydrateX`, and `resetX` methods that each do their own version of "apply changes".
- `setState` called from outside the store to mutate state the store also mutates.
- A method that takes a "raw" payload and a sibling method that takes a "processed" one, with side effects only on one path.

**Worked example.** Same as above. `setSetting`, `resetSetting`, and the (now-replaced) `updateFromBackend` all called `applySettingsSideEffects` internally. The startup path bypassed the store entirely with `setState` + a separate `applyTheme` call. After the refactor, all four paths converge on `applySettingsSideEffects`. Adding a sixth side effect now requires editing one function.

**Design test.** Sketch the data flow: where does data enter the system, and where does it cause effects? If the answer is "many entry points, many effect call sites", redraw it as a funnel: many entry points, _one_ effect application stage, then UI/IO. The funnel is the pipeline.

---

## How to use this doc

When reviewing or writing code:

- If you're about to declare the same shape twice — stop, pick an owner.
- If you're about to write a switch that lists known cases — stop, ask if the list is data.
- If you're about to call a side-effect helper from a place that isn't the domain owner — stop, move the call into the owner.
- If you're about to add a third entry point that mutates the same state — stop, funnel them.

The smell test for all four is the same: _if I add the next thing in this domain, how many files do I edit?_ If the answer is more than one, the structure is wrong.

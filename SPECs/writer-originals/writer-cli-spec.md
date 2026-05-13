# Writer CLI Spec

## Summary

Add a standalone-first, markdown-only `writer` CLI focused on spec authoring and validation.

The CLI should be useful even when the desktop app is not running. It should help users create structured spec documents, inspect markdown workspaces, edit frontmatter safely, and validate spec quality from the terminal and CI.

This feature is intentionally scoped so a single agent can implement it end to end in one pass. That means the initial version must stay narrow, avoid platform-specific installer work, and avoid larger programmatic surfaces such as HTTP APIs, MCP servers, TUIs, or JSON output.

## Background

Writer is currently a Tauri desktop application with a React frontend and a Rust backend. The Rust side already has useful primitives for:

- reading and writing files
- indexing markdown workspaces
- fuzzy searching markdown paths
- tracking workspace state

Those primitives currently sit behind Tauri commands, but they are close to being reusable from a CLI.

Because the underlying source of truth is plain markdown, a CLI does not add much value if it only mirrors generic shell operations. The CLI becomes worth building when it adds Writer-specific behavior:

- opinionated spec templates
- frontmatter-aware edits
- validation of required sections and metadata
- consistent markdown scaffolding
- workspace inspection tailored to markdown specs

## Product Thesis

The CLI should be a fast, markdown-native companion to the desktop app, not a replacement for every shell tool and not an app-wide remote control surface.

The first version should optimize for three jobs:

1. Create a new spec quickly and consistently.
2. Validate a spec or spec workspace in CI and pre-commit workflows.
3. Inspect markdown content and frontmatter without opening the GUI.

## Goals

- Build a headless CLI that works without a running GUI.
- Keep all inputs and outputs markdown, YAML, or plain text.
- Add Writer-specific value through templates and validation.
- Reuse as much existing Rust logic as possible.
- Keep the implementation small enough for one agent to complete end to end.
- Keep the CLI script-friendly through stable stdout, stderr, and exit codes.

## Non-Goals

- No JSON output.
- No local HTTP API.
- No MCP server.
- No interactive TUI.
- No plugin, theme, sync, or developer-tool command surface.
- No bundling the CLI into the desktop installer in v1.
- No requirement to control or focus a running Writer instance in v1.
- No full parity with the desktop command palette.
- No non-markdown export formats such as PDF in v1.

## Single-Agent Scope Boundary

This spec must remain implementable by one agent in a single end-to-end pass. To keep the scope realistic, v1 must follow these rules:

- The CLI lives inside the existing Rust package at `apps/desktop/src-tauri/`.
- The implementation may add shared Rust modules, but it should not begin with a full multi-crate refactor.
- The CLI should operate directly on the filesystem and markdown files.
- GUI integration is explicitly deferred unless it falls out naturally from existing code with almost no extra complexity.
- Output should stay plain text only.
- Validation should be deterministic and strict enough for CI.
- The command surface should stay under ten top-level commands in v1.

If a design choice increases scope materially, prefer the smaller alternative.

## Product Decisions

### Markdown-only output

The CLI will not support JSON. Output must be designed for humans first, while still being grep-friendly and stable enough for shell scripts.

### Standalone-first

Every v1 command should work without the desktop app running. The CLI should read and write markdown files directly.

### Spec-aware, not shell-clone

The CLI should avoid duplicating broad filesystem tooling unless the behavior is meaningfully Writer-specific.

### Narrow v1 surface

The first release should focus on:

- markdown workspace inspection
- frontmatter edits
- spec creation
- spec validation

## Primary User Workflows

### Create a new spec

Examples:

```bash
writer spec create "Login flow" --template feature
writer spec create "Quarterly planning" --template prd --dir specs/product
writer spec create "Use local caching for search index" --template decision
```

Expected result:

- a slugged `.md` file is created
- frontmatter is prefilled
- required sections are scaffolded
- the file is immediately ready to edit in any editor

### Validate a single spec

Examples:

```bash
writer spec validate specs/login-flow.md
writer spec validate docs/decision-cache-index.md
```

Expected result:

- validation diagnostics print to stderr or stdout in stable text format
- exit code is `0` for valid input, `1` for validation failures

### Validate a workspace in CI

Examples:

```bash
writer spec validate specs
writer spec validate .
```

Expected result:

- all markdown specs under the target path are checked
- each issue is reported on its own line
- CI can fail the build on invalid specs

### Inspect and edit frontmatter

Examples:

```bash
writer frontmatter show specs/login-flow.md
writer frontmatter get specs/login-flow.md status
writer frontmatter set specs/login-flow.md status review
```

Expected result:

- frontmatter can be printed, queried, and updated without opening the GUI
- updates preserve markdown body content
- rewriting the YAML block into a canonical format is acceptable in v1

### Search a spec workspace

Examples:

```bash
writer list specs
writer search login
writer read specs/login-flow.md
```

Expected result:

- users can inspect a spec workspace from the shell quickly
- filename search is fast and limited to markdown files

## V1 Command Surface

### Top-level commands

| Command                                       | Purpose                                | Notes                     |
| --------------------------------------------- | -------------------------------------- | ------------------------- |
| `writer list [path]`                          | List markdown files under a directory  | recursive                 |
| `writer read <file>`                          | Print file contents to stdout          | raw markdown              |
| `writer search <query>`                       | Fuzzy-search markdown filenames        | workspace-aware           |
| `writer frontmatter show <file>`              | Print full frontmatter block           | YAML only                 |
| `writer frontmatter get <file> <key>`         | Print one frontmatter value            | scalar or YAML fragment   |
| `writer frontmatter set <file> <key> <value>` | Update one frontmatter field           | rewrites YAML canonically |
| `writer spec create <title>`                  | Create a new spec from a template      | Writer-specific           |
| `writer spec validate [path]`                 | Validate one file or a whole directory | CI-friendly               |
| `writer completion <shell>`                   | Generate shell completions             | bash, zsh, fish           |

### Deferred commands

The following should not be part of the first implementation, but may be revisited later:

- `writer open`
- `writer grep`
- `writer outline`
- `writer spec format`
- `writer spec bundle`
- `writer spec links`

These are useful, but not necessary to make the first release valuable.

## CLI UX Rules

### Global behavior

- Use standard subcommand and flag syntax via `clap`.
- Print human-readable errors to stderr.
- Print command results to stdout.
- Avoid decorative formatting that makes shell usage awkward.
- Keep one result per line where possible.
- Paths should print relative to the resolved workspace root when practical, otherwise relative to the invocation directory.

### Supported global flags

These flags are recommended for v1:

- `--workspace <path>`: resolve relative operations against a specific workspace root
- `--quiet`: suppress non-essential success messages
- `--no-color`: disable colored diagnostics

V1 does not need `--json`, `--stdin`, or interactive prompts.

### Exit codes

- `0`: success
- `1`: validation failed
- `2`: invalid CLI usage
- `3`: runtime or IO failure

## Command Details

### `writer list [path]`

Purpose:

- list markdown files recursively beneath the target directory

Behavior:

- default path is current directory or `--workspace` if provided
- include `.md` and `.markdown`
- ignore hidden directories and files via the same traversal rules as workspace indexing
- return one relative path per line

Examples:

```bash
writer list
writer list specs
writer --workspace ~/work/project list docs
```

### `writer read <file>`

Purpose:

- print raw file contents to stdout exactly as stored on disk

Behavior:

- preserve frontmatter and body
- fail if the path does not exist or is not a markdown file

### `writer search <query>`

Purpose:

- fuzzy-search markdown files by relative path

Behavior:

- search within the resolved workspace root or current directory
- reuse the existing nucleo-based filename search where possible
- print one relative path per line in descending score order
- default result limit should be 20
- support `--limit <n>`

### `writer frontmatter show <file>`

Purpose:

- print the file's frontmatter block without the surrounding markdown body

Behavior:

- if no frontmatter exists, print nothing and exit `0`
- print YAML content without surrounding `---` delimiters to keep piping simple

### `writer frontmatter get <file> <key>`

Purpose:

- print one frontmatter field value

Behavior:

- if the key is missing, exit `3` with a clear error
- scalar values print on one line
- array or map values print as YAML fragments

### `writer frontmatter set <file> <key> <value>`

Purpose:

- set or create a frontmatter field

Behavior:

- if the file has no frontmatter, create one
- rewrite the YAML block into a canonical format
- preserve the markdown body unchanged
- support repeated `--tag <value>` style handling later, but v1 only needs single key/value updates

Example:

```bash
writer frontmatter set specs/login-flow.md status review
```

### `writer spec create <title>`

Purpose:

- create a new markdown spec using a built-in template

Required flags:

- `--template <feature|prd|decision>`

Optional flags:

- `--dir <path>`: destination directory, default `specs`
- `--status <value>`: default `draft`
- `--owner <value>`: may be repeated later, but v1 only requires single owner support
- `--tag <value>`: optional tag, may be repeated later if easy
- `--force`: overwrite if the destination file already exists

Behavior:

- generate a slug from the title
- write `<slug>.md` into the destination directory
- write frontmatter and template sections
- fail if the file exists unless `--force` is provided
- print the created path on success

### `writer spec validate [path]`

Purpose:

- validate a single file or every markdown file under a directory

Behavior:

- default path is current directory or `--workspace` if provided
- if the target is a file, validate only that file
- if the target is a directory, validate all markdown files recursively beneath it
- print one diagnostic per line
- return `1` when any validation issue is found
- return `0` when all checked files are valid

Example diagnostic format:

```text
specs/login-flow.md: missing required section "Acceptance Criteria"
specs/login-flow.md: invalid status "inprogress" (expected draft|review|approved|done)
specs/login-flow.md: broken link ./auth-overview.md
```

### `writer completion <shell>`

Purpose:

- generate shell completions using `clap_complete `

Supported shells:

- `bash`
- `zsh`
- `fish`

## Spec Template Model

The CLI only becomes meaningfully different from generic shell tooling if Writer defines a concrete spec shape. V1 should ship with three templates.

### Common frontmatter

Required fields:

- `title`: non-empty string
- `type`: one of `feature`, `prd`, `decision`
- `status`: one of `draft`, `review`, `approved`, `done`

Optional fields:

- `owners`: YAML list of strings
- `tags`: YAML list of strings

Canonical field order when creating or rewriting frontmatter:

1. `title`
2. `type`
3. `status`
4. `owners`
5. `tags`

### Common section rules

All spec templates should use H2 sections for major headings.

V1 validation should require exact H2 names for required sections. That constraint is intentionally strict to keep the first implementation deterministic.

Common required sections:

- `Summary`
- `Goals`
- `Non-Goals`

### Feature template

Required sections:

- `Summary`
- `Goals`
- `Non-Goals`
- `Requirements`
- `Acceptance Criteria`

Template body:

```md
---
title: Login flow
type: feature
status: draft
owners:
  - product
tags:
  - auth
---

## Summary

Describe the feature in 2-4 sentences.

## Goals

- Goal 1
- Goal 2

## Non-Goals

- Non-goal 1

## Requirements

- Requirement 1
- Requirement 2

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

### PRD template

Required sections:

- `Summary`
- `Goals`
- `Non-Goals`
- `User Problems`
- `Requirements`
- `Acceptance Criteria`

Template body:

```md
---
title: Quarterly planning workspace
type: prd
status: draft
owners:
  - product
tags:
  - planning
---

## Summary

Describe the product decision or initiative.

## Goals

- Goal 1

## Non-Goals

- Non-goal 1

## User Problems

- Problem 1

## Requirements

- Requirement 1

## Acceptance Criteria

- [ ] Criterion 1
```

### Decision template

Required sections:

- `Summary`
- `Goals`
- `Non-Goals`
- `Context`
- `Decision`
- `Consequences`

Template body:

```md
---
title: Use local caching for search index
type: decision
status: draft
owners:
  - engineering
tags:
  - architecture
---

## Summary

State the decision at a high level.

## Goals

- Goal 1

## Non-Goals

- Non-goal 1

## Context

Explain the constraints and background.

## Decision

State the chosen approach.

## Consequences

- Consequence 1
- Consequence 2
```

## Validation Rules

### General markdown file rules

- Only validate `.md` and `.markdown` files.
- A validated file must parse as UTF-8 text.
- If frontmatter exists, it must be the first thing in the file.
- If frontmatter exists, it must be valid YAML.

### Required frontmatter rules

- `title` must exist and be non-empty.
- `type` must exist and match the expected template type.
- `status` must exist and be one of `draft`, `review`, `approved`, `done`.
- If present, `owners` must be a YAML list of strings.
- If present, `tags` must be a YAML list of strings.

### Required section rules

- Required H2 headings must exist exactly once.
- Headings are matched case-sensitively in v1.
- A required section must contain non-whitespace content.
- For templates with `Acceptance Criteria`, the section must contain at least one markdown list item.

### Internal markdown link rules

- Check standard markdown links of the form `[text](path.md)`.
- Ignore external URLs with a scheme such as `http:`, `https:`, or `mailto:`.
- Ignore bare fragment links such as `#section` in v1.
- Relative markdown links must resolve against the current file's directory.
- A broken internal markdown link is a validation error.

### Filename rules

- Created specs must use a slugged filename with `.md` extension.
- Validation may warn or fail on whitespace-heavy filenames, but v1 should keep this simple and only enforce the create path.

## Implementation Strategy

### Repo-level approach

Implement the CLI inside the existing Rust package instead of starting with a new workspace-wide refactor.

This keeps the work small enough for one agent and avoids unnecessary packaging complexity.

### Recommended Rust layout

Existing Tauri commands should delegate to reusable pure functions. New shared modules should live under `apps/desktop/src-tauri/src/`.

Recommended structure:

```text
apps/desktop/src-tauri/
  Cargo.toml
  src/
    bin/
      writer.rs
    core/
      mod.rs
      markdown.rs
      frontmatter.rs
      spec.rs
      workspace.rs
      output.rs
    commands/
      fs.rs
      search.rs
      ...
```

Suggested responsibilities:

- `core/markdown.rs`: basic markdown helpers, heading extraction, link extraction
- `core/frontmatter.rs`: parse, serialize, show, get, set
- `core/spec.rs`: templates, validation rules, diagnostic types
- `core/workspace.rs`: resolve workspace root, list markdown files, relative path helpers
- `core/output.rs`: plain-text diagnostic formatting
- `src/bin/writer.rs`: `clap`-based CLI entrypoint

### Dependencies

Add the following Rust dependencies if needed:

- `clap`
- `clap_complete`
- `serde_yaml`
- optionally `regex-lite` for lightweight markdown parsing if existing string scanning is too brittle

### Parsing strategy

V1 should use pragmatic parsing, not a full markdown AST.

That means:

- detect frontmatter with a simple line-based parser
- parse YAML using `serde_yaml`
- detect H2 headings with line scanning
- detect markdown links with a small regex or scanner

This is sufficient for the first release and small enough for one agent.

### Frontmatter rewrite strategy

`frontmatter set` may rewrite the entire frontmatter block into canonical YAML order. Preserving comments or custom formatting is not required in v1.

This tradeoff is acceptable because:

- it keeps the implementation simple
- it reduces edge cases
- it still preserves markdown body content exactly

### Search strategy

Reuse the existing markdown workspace indexing approach where practical.

- `list` can reuse recursive ignore-aware traversal logic
- `search` can reuse nucleo-based fuzzy matching on relative paths

### Validation strategy

Represent validation issues as a simple internal diagnostic struct with:

- file path
- optional line number
- message

No JSON serializer is needed.

## Files Expected To Change

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/commands/fs.rs`
- `apps/desktop/src-tauri/src/commands/search.rs`
- `apps/desktop/src-tauri/src/error.rs`
- `apps/desktop/src-tauri/src/core/mod.rs`
- `apps/desktop/src-tauri/src/core/markdown.rs`
- `apps/desktop/src-tauri/src/core/frontmatter.rs`
- `apps/desktop/src-tauri/src/core/spec.rs`
- `apps/desktop/src-tauri/src/core/workspace.rs`
- `apps/desktop/src-tauri/src/core/output.rs`
- `apps/desktop/src-tauri/src/bin/writer.rs`
- new Rust tests under `apps/desktop/src-tauri/tests/` or adjacent unit test modules

The Tauri UI code should not need meaningful changes for this feature.

## Single-Agent Execution Plan

The implementing agent should follow this sequence and finish the work in one pass.

1. Add the CLI and YAML dependencies to `Cargo.toml`.
2. Create shared `core` modules and move or wrap reusable filesystem and search logic so both Tauri commands and the CLI can call them.
3. Implement markdown helpers for frontmatter extraction, heading scanning, and link detection.
4. Implement frontmatter operations: show, get, and set.
5. Implement built-in template generation for `feature`, `prd`, and `decision`.
6. Implement validation rules and plain-text diagnostics.
7. Implement the `clap` CLI binary with the v1 command surface.
8. Add unit tests for frontmatter parsing, template generation, heading extraction, link checking, and validation.
9. Add integration tests for the CLI commands against temp markdown workspaces.
10. Run formatting, tests, and linting for the Rust package.
11. Update docs or README only if needed to explain CLI usage.

## Test Plan

### Unit tests

Add tests for:

- frontmatter detection with and without body content
- frontmatter set on files with and without existing YAML
- heading extraction for exact required H2 headings
- internal markdown link extraction and resolution
- feature template validation success
- missing section failures
- invalid status failures
- broken internal link failures

### CLI integration tests

Use temporary directories and real filesystem fixtures to test:

- `writer list` returns markdown files only
- `writer read` prints exact file content
- `writer search` returns fuzzy matches in score order
- `writer frontmatter show` prints YAML block content
- `writer frontmatter get` returns a single field
- `writer frontmatter set` updates YAML and preserves body
- `writer spec create` creates the correct file and template
- `writer spec validate` returns `0` for valid specs
- `writer spec validate` returns `1` and diagnostics for invalid specs

### Verification commands

From `apps/desktop/src-tauri/`, the agent should run:

```bash
cargo fmt
cargo test
cargo clippy --all-targets --all-features
```

## Risk Review

### Main risks

- frontmatter rewriting can change YAML formatting unexpectedly
- markdown heading detection can be too strict or too loose
- link validation can misclassify external or fragment links
- trying to support too many commands will blow up scope

### Mitigations

- explicitly allow canonical YAML rewrite in v1
- require exact H2 names for deterministic validation
- keep internal link rules narrow and ignore unsupported link types
- defer `open`, `grep`, `outline`, and bundling features
- keep the implementation inside one Rust package instead of over-architecting

## Acceptance Criteria

- A user can create a new spec from the terminal with `feature`, `prd`, and `decision` templates.
- A user can inspect and update markdown frontmatter from the terminal.
- A user can validate a single spec file or a full directory of specs.
- Validation failures are easy to read and produce exit code `1`.
- The CLI works without the desktop app running.
- No JSON output is introduced.
- The implementation is completed within the existing Rust package and is small enough for one agent to deliver end to end.

## Future Follow-Ups

These are intentionally out of scope for this spec, but are natural next steps if the first CLI release lands well:

- `writer open` to launch or focus the desktop app on a file or workspace
- `writer grep` for content search
- `writer outline` for heading inspection
- `writer spec format` for canonical markdown formatting
- `writer spec bundle` for flattening linked markdown into a single `.md` artifact
- a later decision on HTTP API and MCP support once the core CLI surface proves useful

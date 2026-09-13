# Budget-safe hosted plugin deployment

Scope: `apps/burette-public-plugin`, Vercel project `burette-plugin` only.
Do not change the desktop runtime, unrelated projects, plan or spending limit
as part of publication. The repository remains the source of truth even when
its Vercel Git integration is disconnected.

## Stop before spending

- Read the team's actual billing-cycle dates, remaining budget and project
  pause state. Calendar-month usage is not necessarily billing-cycle usage.
- If the budget is exhausted or the project is paused, do not deploy, promote,
  resume or retry a blocked deployment. Continue source work only. A prebuilt
  upload is not permission to bypass the budget or resume billable traffic.
- Keep the $1 spend-management limit and automatic pausing unchanged unless
  the user explicitly changes that instruction. Vercel accounting and pausing
  can lag; the limit alone cannot guarantee an exact cap under live traffic.
- Never print production secrets or copy them into a build artifact, Git,
  screenshots or review evidence.

## Avoid repeated builds

1. Keep Git-triggered deployment disabled for this project. The project-level
   Git disconnect also covers older branches that lack the current
   `git.deploymentEnabled: false` configuration. Reconnecting the repository
   requires a deliberate deployment-policy change.
2. Batch changes in an isolated worktree, fetch current `main`, and preserve
   unrelated changes. Do not push as a way to test a deployment.
3. Run focused checks on the existing compute host. Run a full hosted build
   only when runtime changes invalidate the previous evidence, not after
   documentation-only edits. Reuse build caches and record the source commit.
4. When budget permits, prepare Vercel Build Output on the configured Linux
   compute host with the matching runtime and Vercel project settings. A plain
   Next.js `.next` directory is not a deployable Vercel prebuilt artifact.
   Review how runtime secrets are supplied before building; do not assume
   Sensitive variables can be pulled or safely embedded at build time.
5. Verify the prepared artifact, including the Python rendering function,
   assets and routes, before one `vercel deploy --prebuilt` publication.
   If this path is not yet validated, stop instead of silently falling back to
   another Vercel-hosted build. See the local packaging checkpoint below;
   live Vercel acceptance remains separate.
6. Validate the candidate, then promote that same deployment without rebuilding.
   Keep the production origin stable and check deployment protection before
   using a candidate with an external host.

## Acceptance remains separate

### Local packaging checkpoint — 2026-09-14

The mixed Next.js/Python package was built on Gauss with Vercel CLI 59.1.4,
Node 24.13.0, Bun 1.3.8 and Python 3.12 in an Amazon Linux 2023 container
(base digest `sha256:181f98c48832fe926f8ca3b6ffeafcce128e96e77b93d08fbe9a9bc9403ce284`).
The container used 8 CPUs and 16 GiB, no Vercel credentials, and only the public
production origin as application configuration. No upload or deployment ran.

Plain Linux CLI packaging assumed manylinux 2.17 and forced large scientific
dependencies into a 422.61 MiB function, exceeding its 225 MiB check. With the
Amazon Linux build environment and Python exposed at `/uv/python/bin/python3.12`,
`vercel build --prod --standalone` completed. No large-function feature, plan
change, dependency removal or chemistry-code change was used.

Output verification passed for 3,510 unique files (344.58 MiB), widget assets,
MCP, health aliases, Python handler and filesystem routing. Symlinks remain
within the output directory; no `.env` files were found there. This is a
structural check, not an exhaustive secret scan or a live route check.

The Python function occupies about 177 MiB on disk. Vercel's standard optimizer
externalized dependencies into a locked runtime installation. In a clean
Amazon Linux container with the output mounted read-only, the generated
handler installed them in 1.78 seconds and rendered water XYZ and ethanol
SMILES to valid SVG (1,342 and 1,769 bytes). This does not prove Vercel cold-start
latency, outbound dependency access, request routing or live host behavior.

Reproduction evidence is retained on Gauss under
`/home/nikolenko/work/Projects/burette-csp-validation.kr2myZ`:
`prebuilt-al2023.log`, `prebuilt-python-smoke.log`, `.vercel/Dockerfile.prebuilt`,
`.vercel/verify-output.mjs`, `.vercel/smoke-xyzrender.py`, and `.vercel/output`.
The remote runtime sources were checksum-compared with the local integration
branch. The Vercel Python builder generated a temporary Python manifest and
lockfile in this scratch checkout; these are not repository source changes.
Preserve the complete artifact and its lockfile for candidate review instead
of assuming a later fresh dependency resolution is identical.

After publication, run the production preflight and refresh the ChatGPT
connector. Only then record the one-command demo from
[`recording-guide.md`](../apps/burette-public-plugin/submission/recording-guide.md).
Local tests, a successful build and responsive emulation do not replace the
real ChatGPT, Codex and physical-iPhone checks in the
[manual checklist](../apps/burette-public-plugin/submission/manual-review-checklist.md).

References: [Git deployment control](https://vercel.com/docs/project-configuration/git-configuration),
[prebuilt deployment](https://vercel.com/docs/cli/deploy),
[spend management](https://vercel.com/docs/spend-management).

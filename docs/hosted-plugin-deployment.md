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
   another Vercel-hosted build. Prebuilt packaging is not currently acceptance-
   tested for this mixed Next.js/Python project.
6. Validate the candidate, then promote that same deployment without rebuilding.
   Keep the production origin stable and check deployment protection before
   using a candidate with an external host.

## Acceptance remains separate

After publication, run the production preflight and refresh the ChatGPT
connector. Only then record the one-command demo from
[`recording-guide.md`](../apps/burette-public-plugin/submission/recording-guide.md).
Local tests, a successful build and responsive emulation do not replace the
real ChatGPT, Codex and physical-iPhone checks in the
[manual checklist](../apps/burette-public-plugin/submission/manual-review-checklist.md).

References: [Git deployment control](https://vercel.com/docs/project-configuration/git-configuration),
[prebuilt deployment](https://vercel.com/docs/cli/deploy),
[spend management](https://vercel.com/docs/spend-management).

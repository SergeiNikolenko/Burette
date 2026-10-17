# Protected releases

Start Release with workflow_dispatch on protected main after merging and checking
the release version. Tag pushes no longer execute the privileged release workflow.
The workflow checks out the triggering main SHA and creates the version tag during
publication. Missing Developer ID or notarization credentials stop publication.
Local release.sh also fails closed by default; an explicit
BURETTE_RELEASE_ALLOW_ADHOC=1 remains available for local development packages.

Before enabling releases, configure the GitHub environment `release` to accept
only the main branch (no tags), with required reviewers. Move all Apple signing,
Sparkle, manifest and Homebrew publishing credentials into this environment and
remove repository-wide copies. Protect main and v* tags against unreviewed writes,
and restrict Actions write-token permissions outside approved releases.

The job-level branch check is defense in depth, not the trust boundary: a branch
can modify its own workflow. Server-side environment restrictions and secret
migration are required to close the tag/ref attack. These settings and native
macOS signing/notarization have not been changed or verified from the Linux audit
workspace; do not mark release findings closed until that evidence exists.

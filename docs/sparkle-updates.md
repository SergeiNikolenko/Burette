# Sparkle updates

Burette can package Sparkle 2.9.6 with the pinned Tauri bridge 0.2.6. The
`sparkle-updater` Cargo feature is selected by `scripts/build.sh` when
`BURETTE_SPARKLE_PUBLIC_KEY` is set. Without that key the existing updater remains
available, so landing the integration does not strand existing installations.

## Runtime

`commands/native_updates.rs` initializes Sparkle after the AppKit termination
handler is installed. `native_update` accepts `configure` (automatic checks and
stable/beta channel) or `check`; it never accepts a feed URL or an archive URL.
The existing update preferences configure Sparkle through `use-native-updates`.
Automatic checks also enable background downloads. Sparkle owns the update
dialog, reminders, skipped versions, download progress and install-on-quit.
Settings' Check action opens that native dialog, including a prepared update.

Sparkle uses `NSApplication` termination. Burette's existing
`applicationShouldTerminate:` handler defers the decision until every workspace
has passed its unsaved-document preflight. Cancellation replies negatively to
AppKit. The legacy shell installer cannot run in a Sparkle-enabled session.
Packaged dev namespaces disable checks. Standard Homebrew cask installations
are detected through the Caskroom symlink and keep `brew` as their updater.

Quick Look registration continues through the existing startup maintenance.
An existing owned Burette plugin is refreshed by its bundled installer on first
launch of each app/plugin revision. The success receipt is written only after
the installer succeeds; failures are retried on the next launch. An absent
plugin is not installed by this startup path.

## Enable distribution

1. Generate an app-specific key using the pinned SDK's
   `build/sparkle/2.9.6/bin/generate_keys --account burette`. Keep the private key
   in the login Keychain and a secure backup; do not put it in git or logs.
2. Set the GitHub repository variable `BURETTE_SPARKLE_PUBLIC_KEY` to the printed
   base64 public key. Export the key through `generate_keys --account burette -x`
   to a protected temporary file and store its contents as the repository secret
   `BURETTE_SPARKLE_PRIVATE_KEY`, then remove that temporary file. The release
   scripts use the new 32-byte seed format and pass it to `sign_update` on stdin.
3. Cut a normal versioned release. The workflow requires both key settings,
   checks the signing key against the key inside the final app, and signs the
   final ZIP before creating the public release.
4. The serialized release job updates `appcast.xml` in the persistent prerelease
   named `update-feed`. The built-in URL is
   `https://github.com/SergeiNikolenko/Burette/releases/download/update-feed/appcast.xml`.
   Keep that release available. Both stable and beta entries share this feed;
   it retains ten entries per channel and marks arm64-only builds appropriately.

The SDK download is pinned by SHA-256. Packaging includes its license and signs
nested helpers, XPC services and the framework before signing the outer app.
Developer ID/notarization uses the existing release credentials. Sparkle's
Ed25519 signature authenticates an update independently; it does not give an
ad-hoc signed app Developer ID trust or remove Gatekeeper's first-install checks.

Existing Burette installations receive the first Sparkle-enabled ZIP through
the legacy updater. Preserve ZIP/SHA-256 sidecars and the older Burrete bridge.
Do not rotate the Sparkle key or feed URL without planning that migration.

## Validation

- `python3 tests/test-sparkle-appcast.py`: metadata, channels, retention and retries.
- `bun tests/test-sparkle-signing.mjs`: real Sparkle signature, tamper rejection,
  appcast generation and rejection of a mismatched signing key; prepare the SDK first.
- Native Bundle Build compiles/packages the feature under an isolated dev
  namespace with a non-production public key; checks remain disabled there.

Release acceptance also needs a real installed old-to-new update on a disposable
Mac or VM: automatic/manual checks, a prepared download, cancelled and accepted
termination with dirty documents in multiple windows, relaunch, Quick Look, and
installed plugin refresh. A dev bundle build or signature test does not prove
that end-to-end path. Before enabling the repository variable, complete this
native acceptance and upload a valid feed with the first enabled release.

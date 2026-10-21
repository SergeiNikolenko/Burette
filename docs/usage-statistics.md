# Optional desktop usage statistics

The desktop app asks once before sharing statistics. Refusing has no effect on
features. Settings → General contains the same disclosure, a sharing switch and
an export action. Switching off stops collection and requests erasure of the
installation's earlier statistics. Local diagnostic logs remain separate and
are never uploaded by this feature.

## Scope and interpretation

The native process owns consent, a cryptographically random UUID credential,
and a bounded in-memory queue shared by windows. The UUID is generated only
after consent; it is not derived from a device, account or hardware identifier.
The receiver stores its SHA-256 digest, never the credential itself.
These data are **pseudonymous**, not guaranteed anonymous: the random identifier
links activity from the same installation.

Events contain only closed enums:

| Kind | Recorded meaning |
| --- | --- |
| `active/day` | A foreground desktop window was active; deduplicated by UTC receipt day |
| `feature` | Entering a structure, table/chemical-space, sketch, docking, compute or document view |
| `error` | Locally classified network, parse, render, timeout, permission, unsupported or unknown error |

The wire schema also reserves trajectory and export feature categories; these
are not yet instrumented. Feature counts measure view entries, not successful
jobs or individual scientific operations. Error coverage comes from the
existing frontend error forwarder, not native crash dumps. Multiple windows can
produce multiple feature events. A background or closed app has no heartbeat.
No pre-consent activity is replayed.

Every batch includes app version, arm64/x64 architecture, consent version, batch
UUID and installation credential. The receiver assigns the UTC day. No file
names, paths, molecular data, entered text, raw errors, stack traces, account
information, hostname, IP address or user-agent is stored in the database.
Transport infrastructure necessarily handles IP addresses while serving HTTPS.
Do not enable proxy, CDN or hosting request logs without revising the notice.

Browser demos retain their separate existing analytics. Browser development,
native preview windows, hosted/native widgets, Finder Quick Look and iPhone do
not start this desktop statistics client.

## Retention, withdrawal and bounds

- Daily events expire after at most 90 days, including for continuing users.
- Consent version/receipt time remains while that installation has events.
- Batch deduplication entries expire after two days.
- Erasure deletes events, consent and deduplication entries. A digest-only
  revocation marker remains for 90 days to reject late uploads.
- The local consent file is mode 0600. Events are never queued on disk.
  The queue holds 64 events plus one 64-event retry batch. A batch is tried at
  most three times, using the same batch ID; then it is dropped.
- Pending erasure survives restart and retries on connectivity/one-minute
  ticks. No uploads or reenabling are permitted until erasure succeeds.
  The old credential is then discarded; reenabling creates a new one.
- A changed recipient or consent version disables sharing and erases at the
  original recipient. Bump `CONSENT_VERSION` in both native and receiver code
  for changes of purpose, fields, retention or material notice terms.
- Public request bodies are limited to 16 KiB. Each batch has at most 64 events.
  The receiver limits all public requests to 1,200/minute and each installation
  to 1,000 input events/day and four version/architecture pairs/day.
  Export is bounded by 90 days × 4 pairs × 16 event categories, below the native
  2 MiB response limit. Version summaries return the 100 most recently active
  version/architecture pairs.

Deleting the application before pending erasure completes can lose the local
credential. The server's automatic retention still applies. Since identities
are not linked to email accounts, an email address alone cannot locate records.

## Deployment gate

No collector or production notice is configured by this change. Without both
build-time variables, the app shows no solicitation and cannot enable uploads:

```
BURETTE_TELEMETRY_URL=https://<collector-origin>
BURETTE_TELEMETRY_NOTICE_URL=https://<public-notice>
```

These must be HTTPS URLs without credentials, query strings or fragments.
Changing the variables triggers a native rebuild. Never configure the endpoint
in a release until the notice and operational setup below are complete.

1. Choose the actual receiving host, hosting provider, storage country and any
   subprocessors. Document these in the published notice. This does not require
   displaying the controller's country in the consent banner.
2. Complete and publish [the notice text](privacy/desktop-statistics.md), with
   actual hosting/transfer information. Check obligations applicable to the
   operator and users (including any registration or localisation duties).
   This implementation is a technical consent mechanism, not legal certification.
3. Run `services/telemetry/server.ts` with Bun, an absolute private
   `BURETTE_TELEMETRY_DB` path and a random `BURETTE_TELEMETRY_ADMIN_TOKEN` of at
   least 32 characters. Keep secrets in a protected service environment file.
   The process binds 127.0.0.1:43180; `PORT` can override the port.
4. Put a TLS reverse proxy in front, disable access/request-body/error-payload
   logging, limit request time/body/concurrency, and restrict `/summary` to the
   administrator network as well as bearer authentication. Do not add cookies,
   tracking scripts, third-party analytics or request tracing to this service.
5. Use an encrypted volume, restrict service/database permissions, and ensure
   snapshots/backups do not retain erased or expired data. The simplest initial
   policy is no database backups. Stop safely before moving SQLite/WAL files.
6. Verify with a disposable installation: no requests before consent or after
   refusal; accepted upload; own export; disable while offline; restart and
   reconnect; server erasure; late batch rejected; new ID after reenabling.
   Validate the configured native build on this Mac before release.

Run the receiver from the repository with:

```
vp exec bun services/telemetry/server.ts
```

`GET /summary` requires `Authorization: Bearer <admin-token>` and returns daily
active installation counts, feature/error counts and version distribution.
`POST /export` and `/erase` require the random installation credential in JSON;
the app manages it without exposing it in URLs, logs or process arguments.
Do not infer total users from opt-in installations or combine these records
with landing-page analytics.

## Verification

```
vp exec bun test services/telemetry/telemetry.test.ts tests/test-usage-statistics.test.tsx
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::telemetry --lib
vp run typecheck
```

The consent approach follows the EDPB's principles of freely given, specific,
informed and unambiguous consent, and withdrawal as easy as giving consent:
[EDPB guidance](https://www.edpb.europa.eu/sme-data-protection-guide/process-personal-data-lawfully_en).

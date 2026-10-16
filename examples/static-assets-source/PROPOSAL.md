# Workers Static Assets: deployment authority proposal

Status: **approved and proven live**. The [native evidence](verification/native-20261016.md)
records the supported upload, deployment, served-byte checks and browser interaction.
This document retains the approval boundary for issue #133; the [runnable recipe](README.md)
is separate from the completed Vite release. Eric supplied a separate credential
locally; its value is never recorded here.

## Approved resources

Eric approved these dedicated resources in the existing test account, and the private
source-reader connection described below. Do not reuse the HMD deployment token,
release target, immutable demo-site publisher or local personal OAuth token.

| Resource | Approved exact name | Purpose |
| --- | --- | --- |
| Public Worker | `effect-ci-static-assets-demo` | Serve the uploaded three-file fixture with an `ASSETS` binding |
| Private broker Worker | `effect-ci-static-assets-broker` | Fixed-target upload/deployment orchestration; no public writer |
| Native Workflow | `effect-ci-static-assets-publish` | Durable, zero-retry mutation checkpoints and served-byte verification |
| Broker SQLite DO class | `StaticAssetRevisions` | Immutable source records and mutation journal; 32 revisions, no eviction/reset |
| Existing App private export | `StaticAssetSourceReader` | Read only the enrolled testbed paths at an exact commit |
| Broker secret | `STATIC_ASSETS_DEPLOY_TOKEN` | Assets upload and Worker version/deployment API authority |

The App export is an additional private service edge, not a public
endpoint. It uses the existing selected-testbed installation's one-repository
Contents READ token, revoke it in `finally`, and return only bounded plain source
data. No token enters the broker's project data, a container or a model. No new
repository enrollment, GitHub installation permission or signing authority is
requested. The App deployment received its own fresh deployment preflight.

## Credential boundary and limitation

Cloudflare's upload-session API requires Workers Scripts Write. Its API-token
resource scope is the selected **account**, not an enforced single-script scope.
The broker's fixed target is a code fence, **not** a restriction on what a stolen
token could do. Approval must explicitly accept that account-level credential
risk; this proposal does not describe the token as script-scoped.

Eric requested a long expiry for the upcoming demo: use a separate 90-day token
in the ignored file
`examples/static-assets-source/.secrets.env` as
`STATIC_ASSETS_DEPLOY_TOKEN=...`, with file mode 600. Never send its value in chat
or commit it. Grant Workers Scripts Write only for the existing test account;
no token-management, DNS, Access or account-membership grants. Verify the actual
required permission set before activation rather than silently widening it.
Keep expiry visible in the private receipt; revoke when the dedicated demo is
retired or the credential is no longer needed, not automatically before the
upcoming demo. If account-level authority is not
acceptable, stop here and choose an independently restricted capability broker
or account boundary; do not substitute the existing HMD token.

Implementation-time exception: Eric subsequently supplied the broader “Edit
Cloudflare Workers” template token, verified active. Dashboard inspection showed
13 permissions and no expiry. When offered narrowing to Scripts-only plus a
90-day expiry, he explicitly chose **leave this token unchanged**. The supplied
credential is therefore used as-is only inside the fixed-target host boundary;
the original narrower/90-day recommendation is not a claim about that token.
No permission, expiry or value change was made. CLI token creation did not return
a usable credential; the user supplied this one independently.

References: [upload-session permission](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/),
[token permission scopes](https://developers.cloudflare.com/fundamentals/api/reference/permissions/),
[token creation and expiry](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## Closed source and publication policy

Enrolled source is `ericclemmons/effect-ci-testbed`, installation `165265172`,
at a lowercase full 40-character commit. The standalone fixture contains
exactly `site/index.html`, `site/app.js` and `site/style.css` under this
directory: regular, non-executable UTF-8 files, no NUL bytes, at most 32 KiB each
and 64 KiB combined. The encoded source manifest is at most 96 KiB. These are
no-build protocol fixtures, not a second claim about the already released Vite
build. The three-file fixture and pure preparation/reader implementation are
present, alongside the broker, upload journal and native Workflow configuration.
The private App export and both new Workers are deployed. The linked native
evidence establishes live acceptance separately from the local fake-API tests.

Local verification (fake GitHub API; no token mint or external calls):

```sh
node --test packages/cloudflare/src/static-assets-source.test.ts \
  packages/cloudflare/src/static-assets-github.test.ts \
  apps/effect-ci/src/static-assets-read.test.ts
```

These tests prove bounded preparation, raw Git blob identity, scoped capability
composition and revocation-before-return with fake responses. They do not prove
native private RPC, a real upload or served assets.

The private reader and broker must independently bind the source commit, exact
paths and raw-byte SHA-256 digests. A claimed commit or a matching manifest hash
alone does not authenticate GitHub provenance. The DO must retain both the Git
commit and manifest digest; the existing 64-character source-revision key must
not be mistaken for a 40-character Git commit. Identical replay is readable;
changed bytes for a recorded commit, overflow, unknown source or corruption fail
closed. There is no actor-selected account, script, URL, module or destination.

Cloudflare's supported upload sequence is a manifest, missing-asset uploads,
then a Worker/version upload referencing the completion token. The documented
SDK example derives each 32-hex asset hash from SHA-256 of the file's base64 text
plus its extension without the dot. Keep full raw-file SHA-256 separately for
independent served-byte verification; do not conflate the two identities.
Session and completion tokens remain host-only and must never appear in public
receipts. The trusted broker uses the API; `cf` does not run inside the DO.

References: [Direct Uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/),
[official upload example](https://github.com/cloudflare/cloudflare-typescript/blob/main/examples/workers/script-with-assets-upload.ts).

## Failure, proof and cleanup requirements

Before each external mutation, persist its semantic identity and create-only
intent. Use zero native checkpoint retries. An uncertain acknowledgement holds
the operation for read-only reconciliation, not another upload/deployment under
a new identity. Where an API does not expose enough readback to establish the
outcome, report the unresolved boundary rather than inventing a recovery claim.

Acceptance requires an actual native no-Container run: pinned source read,
immutable DO storage, supported asset upload, dedicated Worker deployment,
independent version/allocation readback and all three served files matching the
checked bytes. Tests must cover bad paths, limits, conflicting revisions,
corruption and ambiguous acknowledgement. Public serving is GET/HEAD with a
fixed host-authored module and restrictive CSP; source text is never evaluated
inside the broker. These live criteria were met by the linked evidence, not by
this authority document alone. The original failed history and separate GET-only
reconciliation remain preserved alongside the successful bugfix-source run.

Before any deployment, commit reproducible standalone config, setup commands,
permission/cost documentation and cleanup instructions, then rebuild exact
merged source and record fresh current-resource/security preflights and private
create-only receipts. Workers, Workflows, SQLite and Assets usage may incur costs
under the existing plan; no AI call, Container or new provider is required.

Cleanup requires a separate explicit decision: revoke the new token first,
disable the new private connection/dispatch, then remove only these new targets
and their explicitly identified storage after preserving receipts. Never reset
or remove existing release journals, immutable assets, incident histories or
the committed `ef0d65a2` release. No cleanup is performed by this proposal.

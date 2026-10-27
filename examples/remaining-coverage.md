# Remaining comparison coverage

Scope: [issue #161](https://github.com/ericclemmons/effect-ci-testbed/issues/161).
Baseline: main `20f29103911800606929de4f9afa095667606e48`, inspected October 26,
2026. The October 24 [matrix and splitting proof](./parallel-recipes-verification.md)
is unchanged. Recipe migrations belong to #162, not this work.

## Separate cells

| Recipe | Environment | Input identity | Evidence and boundary |
| --- | --- | --- | --- |
| Snapshot fanout | Effect Local, macOS arm64 | Public `app/` fixture; receipt includes source file hashes | Local execution passes with one prepare, overlapping independent branches and unchanged source/prepared snapshots. Local receipt is retained below. Filesystem copies are not a security sandbox. |
| Snapshot fanout | Effect on GitHub | Git checkout at the run SHA | Baseline [run 40149142030](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40149142030) has successful plan/execute fanout jobs, but no immutable receipt for the full conditions. New receipt upload is implemented but not yet verified on GitHub. Keep this cell unverified. |
| Host-only outbound | Effect Local, Docker Desktop on macOS arm64 | Empty read-only Node container; inert host-only random credential | Local execution passes: one authenticated upstream request, three rejected requests, no credential in guest configuration or returned output, no host mounts. This is opt-in Node HTTP proxying to a loopback fixture, not transparent VM interception or an external API. |
| R2 source | Conventional GitHub | Bucket `effect-ci-r2-source-input`, key `source/6759fef7f59ccbd363fb8c42062fb4903d98070d08da56c6ae873d9a75ea41cd.json` | Unverified. Conventional runner and manual workflow are implemented, not dispatched. No read capability has been configured or exercised. |
| Immutable DO source | Conventional GitHub | Object `owned-source`, revision `c79e699009991bf593f593ae81b03241c6de16447d4598ba66bee96d8b2eeed9` | Unverified and unsupported by the current HTTP surface. Conventional consumer is implemented; a private fixed-revision reader is not. No gateway was deployed. |
| R2 / DO source | Effect Local and Effect on GitHub | Checked-in `source.txt` in each recipe | Existing checks prove the file-backed recipe only. They are not storage-provider reads. |
| R2 / DO source | Effect Cloudflare | Owned binding-backed fixtures | Existing standalone providers and their October 15 histories remain delivered. Their read-only replay assertions live in each recipe's `src/live.test.ts`; they do not establish conventional GitHub execution. |

## Receipts

Local execution receipts are stored separately under
[`remaining-coverage-proof`](./remaining-coverage-proof). Each records its
environment, source commit and SHA-256 hashes of the executable source files.
Those hashes also identify uncommitted code; a base commit alone is not the
identity of a dirty worktree. GitHub receipts additionally record run/attempt.
Committed receipts and run-specific GitHub artifacts are evidence snapshots,
not signatures, provenance attestations or reusable signed check evidence.

Conventional source receipts deliberately omit the capability URL. Their input
digest proves bytes, not the service that supplied them. A genuine comparison
also requires an issuer receipt linking the read capability to R2 or the exact
DO revision, plus the GitHub run and immutable artifact identity. An arbitrary
HTTPS server returning matching bytes is insufficient.

## Implementation boundary

The README authoring process is documented in `apps/docs/README.md`. Existing
prior art is the snapshot adapter, shared credential capability, standalone
source providers, bounded manifest decoder, and October 24 run receipts. No
existing process grants conventional GitHub storage access; the provider
Workers explicitly return 404 from their HTTP entrypoints.

Baseline below is landed main. Additions are implemented in this PR, not landed
APIs. No behavior moves between providers.

```diff
 CLI.run(workflow)
   snapshot.local({ root }) -> CI.RunConfiguration
     CI.parallel([left(), right()]) -> prepare() once
       materialize(workspace, stepId) -> separate filesystem copies
       capture(workspace, stepId) -> retained snapshot
+    dispose() -> verify hashes, overlap and branch contents -> receipt -> cleanup in finally
   secretOutbound.authenticate() -> workspace.exec(node fetch(placeholder))
-    Local: credential.ci has no host interceptor
+    secretOutbound.local({ root }) -> disposable read-only Docker container
+      Node HTTP proxy -> fixed credential.ci capability
+        credentialRequest(request, credential, upstream) -> loopback upstream
+          host injects credential; returns success bit only; denies wrong capability
+      dispose() -> remove container -> close proxy/upstream in finally
   Cloudflare.SecretOutbound.fetch(request) -> credentialRequest(...) -> CredentialVault.fetch(...)
+ Conventional GitHub: source-comparison(provider) -> host HTTPS capability read
+   decodeSourceManifest(bytes, fixedDigest) -> fixed fixture files
+   Docker(network=none, no credentials) -> check source.txt -> separate receipt
+   finally -> remove container and temporary input
```

## Authority still required

No manual GitHub dispatch, cloud deployment, new bucket, DO migration, secret,
permission grant or external target was created for this work.

To run the conventional R2 comparison, approve a short-lived, read-only HTTPS
capability for the existing exact bucket/key above and its GitHub secret. To run
the DO comparison, separately approve a private fixed-revision HTTPS reader over
the existing `owned-source` object, its scoped authentication and deployment.
Neither needs a general storage writer or credentials inside the workload.
Manual dispatch must be approved separately after the source is reviewed and
landed; the workflow refuses non-main refs. Preserve Access and signed callbacks.

Keep #161 open until both conventional target-environment runs and the full
Effect-on-GitHub fanout receipt exist. Do not replace those receipts with these
Local runs, a dry run, a simulated provider or an approval.

# Maintain one preview per pull request

Build the existing containerless-site fixture at the current PR head, publish its
real HTML/CSS/JavaScript, and keep one GitHub comment linked to that exact revision.
The host owns deployment and cleanup. The notification provider only presents
the host's result; adding a Slack-style notifier does not grant lifecycle authority.

This recipe is **implemented but unlanded and not deployed**. Deployment,
GitHub delivery and the real create/update/close proof need Eric's approval of
the scope below. [Issue #156](https://github.com/ericclemmons/effect-ci-testbed/issues/156)
remains open. Do not treat a local build or the historical demo's preview proof
as this recipe's hosted acceptance.

## Scope to approve

| Boundary | Fixed scope |
| --- | --- |
| Repository | `ericclemmons/effect-ci-testbed` only |
| Source | Five immutable files under `examples/containerless-site/site`, fetched at the canonical PR head |
| Deployment | One new `effect-ci-pr-previews` Worker in Eric Clemmons account `da2f8f3e41d6b5018df12a58b417d918`; origin `effect-ci-pr-previews.eric-clemmons-da2.workers.dev` |
| Storage | One new SQLite DO class `PreviewRegistry`, named instance `pr-previews-v1`; at most 16 PR records over its lifetime |
| Execution | One new native Workflow `effect-ci-pr-preview-build`; at most 64 build admissions over the namespace lifetime |
| Build | Existing network-free Dynamic Worker builder, 250 ms CPU/5 s deadline, no container, secrets or host bindings |
| Publication | Only `/pr/<number>/<generation>/<40-character-head>/<asset-digest>/<asset>` on the new origin; no mutable alias |
| Retention | Current generation only, up to 24 hours from admission; update, close, deleted source branch or expiry removes its served assets |
| Execution history | Native Workflow source/build checkpoints remain under platform retention; no automatic Workflow-history deletion or source erasure is authorized |
| Forks | Reject all forks, including collaborator-owned forks; no actor allowlist or label override |
| GitHub | Existing App `effect-ci` (5089816), installation 165265172, bot `effect-ci[bot]` (334321206); one maintained bot-owned comment only on individually approved PR destinations |
| Token | Host mints a repository-restricted installation token with Contents read and Pull requests read; Issues write is requested only when notification destinations are configured; revocation follows each operation |
| Events | One new repository webhook for signed `pull_request` opened/reopened/synchronize/closed and branch `delete`, with its own secret; leave the existing App webhook URL and all existing hooks untouched |
| Exclusions | No HMD target, production traffic, historical demo storage, old immutable URLs, broad purge, arbitrary repository, credential export or automatic budget reset |

The limits bound admissions and asset volume, **not a dollar budget**. GitHub
readbacks, Workflow storage, DO calls, alarms, Dynamic Worker execution and public
requests are metered. Approve an account/budget and a fixture PR/comment
destination before enabling the host. Existing [`#142`](https://github.com/ericclemmons/effect-ci-testbed/issues/142)
closed on October 16, 2026 for the HMD target; it does not authorize this namespace.

`PREVIEW_AUTHORITY` must equal the exact policy string; it is deliberately absent
from the checked-in config. Missing authority disables every route. The App key
and webhook secret stay in host secrets; they never enter project files, Workflow
parameters, build inputs or a child Worker. The existing App must support the
explicit reduced token permissions; this recipe cannot grant them itself.

Notification authority is separate: `PREVIEW_NOTIFY_PULL_REQUESTS` is an optional,
host-configured comma-separated allowlist of at most 16 approved PR numbers.
It is absent by default, so lifecycle authority alone cannot post a comment or
request an Issues-write token. Set it only for explicitly approved fixture
destinations. Removing it stops comment writes without stopping owned cleanup.

GitHub documents [repository webhook creation](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)
and [event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads).
Repository webhook payloads need not have an App `installation` object. This host
checks the HMAC and exact repository; when an installation is present it must
match the fixed installation. API execution/notification authority is independently
bound to that installation through the host's App token, not inferred from a
signed payload or notification receipt.

[Fixed authority and naming](./src/policy.ts#symbol=previewPolicy "source")

[Standalone resource declaration](./cloudflare.config.ts "source")

## Ownership and recovery

Events trigger a fresh GitHub PR/branch read, not a deployment using the event's
claimed SHA. Closed or deleted branches invalidate only a known owned PR record.
An old close/delete delivery therefore cannot delete a reopened live branch.
Fork heads never start a build or receive a publication capability.

Every accepted new revision or observed reopen increments a durable generation.
The Workflow name includes PR, generation and full revision. Publication rereads
GitHub, validates the lease and digest, and commits under the same DO concurrency
boundary as webhook ownership changes. Old completions cannot overwrite a newer
generation, even after an ABA return to the same SHA. A failed old build cannot
change newer state. An already committed identical publication replays; changed
bytes under that lease fail closed.

Only the current generation is served. URLs identify immutable bytes, **not
permanent retention**: previous or expired URLs return 404. `Cache-Control:
no-store` prevents this host from instructing downstream caches to retain removed
previews. Cleanup cannot revoke bytes a reader already copied or an in-flight
response. Expiry blocks reads even if an alarm is delayed; alarms remove stored
asset bodies. Compact generation/budget/notification records remain for replay
and fencing; there is no `deleteAll`, external Worker deletion or historical
registry cleanup capability.

Native Workflow history separately retains its recorded source/build outputs
under platform retention. The 24-hour limit applies to served previews and the
registry's asset bodies, not execution-history erasure. At most 64 build
admissions can create those histories in this namespace; no history is deleted.

Workflow creation records its deterministic intent first. A lost create ACK is
read back using the **same** instance ID on a later delivery. No second create is
attempted when readback is unavailable or absent. A build failure remains failed;
duplicate delivery does not spend another admission. Expiry cannot be renewed by
replaying the same open-head event. Only a new head or an observed closed-to-open
transition can request another generation, within the lifetime budget.

Notification intent is stored before the remote write. Its stable lifecycle
identity reuses the maintained GitHub provider, including bot/PR/marker ownership
checks and its bounded 500-comment discovery. An uncertain write blocks newer
comment writes. Recovery is read-only and requires that exact operation body;
absence is not permission to post again. Preview cleanup and publication commit
independently of presentation failures. A notification can therefore remain stale
while its linked preview is already gone. A later valid event can reconcile an
acknowledged write; missing or changed messages need operator investigation.

GitHub's head read and the DO commit are not a cross-system transaction. The lease
fences all **observed** newer generations; a newly changed GitHub head may precede
webhook processing. That does not grant an older run authority over an already
observed newer generation. The next delivery refreshes canonical state.

[Controller and isolated build](./src/worker.ts#symbol=PreviewRegistry "source")

[Native Workflow](./src/worker.ts#symbol=PreviewBuildWorkflow "source")

[Repository-restricted host token](./src/github.ts#symbol=withPreviewToken "source")

## Call contract

Baseline: landed main `20f29103911800606929de4f9afa095667606e48`.
Unchanged lines describe retained behavior. Additions are this unlanded recipe,
not deployed APIs. Nothing moves out of the historical demo or its Slack path.

```diff
 DemoSitePublisher.publish(revision, assets)
   DemoSiteRevisions.publish(revision, assets) -> retained immutable demo URL
 githubCommentProvider(options).deliver(run, previous) -> per-run owned comment
+githubCommentProvider({ lifecycle, reconcileOnly?, ... }).deliver(run, previous)
+  -> PR-wide presentation only; reconcileOnly never writes
+preview.fetch(signed PR/delete event)
+  PreviewRegistry.refresh(number) / refreshDeletedBranch(ref)
+    withPreviewToken(host) -> currentPullRequest(token, number)
+    durable generation + budget + dispatch intent
+    PreviewBuildWorkflow.create(id = PR/generation/SHA, params = lease)
+      inspectLease(lease) -> stale: stop
+      checkoutSource(SHA) -> buildSite(LOADER, source) [no host capabilities]
+      PreviewRegistry.publish(lease, sourceDigest, assets)
+        canonical GitHub head + lease fence -> immutable owned site commit
+        notify(token, state) -> durable intent -> maintained provider
+          host notification allowlist required; absent means no comment writes
+        failure: retain site; quarantine uncertain notification
+      build failure -> PreviewRegistry.fail(lease) [cannot change newer owner]
+  close/delete: canonical read -> remove only owned assets; retain tombstone
+  lost dispatch ACK: get(same id).status(); never blind create retry
+  lost comment ACK: reconcileOnly readback of same body; never blind repost
+PreviewRegistry.alarm() -> expired owned assets removed before notification
+preview.fetch(GET/HEAD exact URL) -> read(lease, digest) -> serveSite(...)
```

## Local validation

From a managed checkout, install locked dependencies and run the existing checks:

```sh
pnpm install --frozen-lockfile
pnpm --filter @effect-ci-testbed/pull-request-preview check
node --test packages/github-cloudflare/src/github-comment.test.ts packages/github-cloudflare/src/notification-service.test.ts
pnpm --filter @effect-ci-testbed/pull-request-preview build
```

There is no deploy script and no automatic connection to the existing CI webhook.
Local checks do not validate this new controller's live race, restart or
lost-ack behavior. No tests are added or changed without explicit approval.

## Before enabling

After exact scope approval, confirm the account, App permissions and metered-run
budget; provision only the declared resources and host secrets; set the authority
flag; connect the new signed webhook endpoint. A GitHub notification fixture is
an external comment and needs explicit approval too. Do not merge or deploy merely
because a Draft PR exists.

Read-only account/subdomain API checks identified the proposed personal account
and `eric-clemmons-da2` subdomain. The current connection's three accounts do not
report the historical `ericclemmons` subdomain. This is a new standalone target,
not a migration of that old host. The local `cf` CLI also has no authentication
token in this worktree; do not log in or copy credentials without approval.

Record exact source/build/deployment IDs and exercise open, new-head update,
old-run completion, close/reopen, branch deletion, fork rejection, duplicate events,
lost create/publication/comment ACKs and expiry in that actual environment.
Read all three served assets at each successful immutable URL; verify cleanup
404s, the same comment ID, unchanged historical demo URLs and host-only secrets.
Keep the issue open until those receipts establish all acceptance criteria.

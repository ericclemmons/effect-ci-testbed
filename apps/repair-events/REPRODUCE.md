# Reproduce the owned Issue ingredient

These standalone apps own their configs, fixtures and tests. This is an **owned deterministic demo**, not an arbitrary production repair service. No model or GitHub writer is bound to either app. Hosting/storage/Workflow operations use your Cloudflare account and its metering; this slice calls no AI. The separate repair broker's existing $7 cumulative inference authorization is neither an account-wide billing cap nor a credit purchase.

Prerequisites: the repository's declared Node/pnpm toolchain, a frozen workspace install respecting all denied build scripts and release-age policies, and the maintained `cf` CLI. Local operator authentication needs Workers/Workflows deployment, observability and Notifications permissions on your own account. Never copy OAuth, refresh tokens, personal GitHub tokens or the App key into these apps. Discover commands with anonymous action/resource descriptions via `cf cli search`, then read the chosen help. Do not use Wrangler or invent `--body @file` support.

## 1. Build and configure the receiver before emitting

From this app directory:

```sh
node --test src/*.test.ts
pnpm check
node scripts/prepare-notification-secret.ts
cf build
cf deploy --prebuilt --secrets-file .verification/notifications-secret.json
```

The helper creates a fresh LOCAL256-bit secret once, mode600, in an ignored directory. Existing files refuse overwrite. **Do not run it against the retained demo secret or rotate/delete that secret.** On update, preserve the same secret and namespace. The production config exposes only authenticated POST `/notifications`; previews are disabled, root/inspection/admission HTTP routes404, unsigned notification401. Verify these responses and the actual deployed bindings before enrolling notifications. Never print/upload the secret or put its value in process arguments.

Dispatch an authenticated private inventory through the native Workflow API, using a fresh operator receipt ID in your own reproduction:

```sh
cf workflows instances create effect-ci-notification-inspection --body '{"instance_id":"my-owned-inventory-before-1","params":{"mode":"inventory"}}'
cf workflows instances get my-owned-inventory-before-1 --workflow-name effect-ci-notification-inspection
```

Expect an empty inventory on a fresh installation. This does not emit or infer.

## 2. Arm ONLY the dedicated owned source

Deploy `../repair-incident` from its own directory with `cf build` then `cf deploy --prebuilt`. It is private, has no secrets/outbound bindings, explicitly enables Issues in config, and only authenticated Workflow API commands can emit. Record its actual source commit and deployed version. Do not assume this fixture matches private GitHub source bytes.

Create a Generic Webhook destination in Cloudflare Notifications using your receiver's actual HTTPS `/notifications` URL and the dedicated shared secret. Use the dashboard's secret input or the CLI's supported **in-process** `runMain` integration with the secret read from the LOCAL file; never a literal `--secret`/`--body` value in OS arguments. See [webhook setup](https://developers.cloudflare.com/notifications/get-started/configure-webhooks/). A platform destination test is not an Issue; text-only204 leaves inventory empty. Reconcile current destinations after an uncertain acknowledgement before creating anything again.

Create a DISABLED policy with the actual owned destination ID:

```sh
cf alerting policies create --body '{"name":"my-owned-issue-policy","alert_type":"workers_observability_real_time_issue","enabled":false,"mechanisms":{"webhooks":[{"id":"REPLACE_WITH_OWNED_WEBHOOK_ID"}]}}'
cf o11y issues automations create --body '{"name":"my-owned-500","policyId":"REPLACE_WITH_OWNED_POLICY_ID","service":"effect-ci-repair-incident","afterOccurrences":1,"enabled":false}'
```

Read the actual policy and automation back. Require `scope:service`, exact `service:effect-ci-repair-incident`, threshold1, intended policy, and **webhook-only** mechanism. No email/Slack/PagerDuty or account-wide automation. Service scope belongs to the Issue automation, not invented Notifications filters. Enable the same automation first, then policy, preserving their full fields with their documented update commands; independently read both back before emission. See [Issues automations](https://developers.cloudflare.com/workers/observability/issues/automations/). Automation success means accepted for delivery; receiver persistence must be independently proved.

## 3. Emit ONCE and retain actual counterparts

**Our retained source has already emitted; never run these commands against the existing demo to get more proof.** For a fresh installation, save a create-only operator intent with source/version/armed scope/capture readiness before one dispatch:

```sh
cf workflows instances create effect-ci-owned-incident --body '{"instance_id":"my-owned-emission-1","params":{"mode":"emit-once"}}'
cf workflows instances get my-owned-emission-1 --workflow-name effect-ci-owned-incident
cf o11y issues list --service effect-ci-repair-incident --per-page 10
```

Reconcile the SAME instance if acknowledgement is ambiguous. Do not re-emit/replay/reset on delayed ingestion. Retain all checkpoint outputs: our actual checkpoint contains status500 while outer RPC output serialized status as `unknown`. Do not rewrite that discrepancy. The real occurrence is handled structured-error logging from `OwnedFaultOnce` over private jsrpc, not an uncaught exception or public failing site.

Use `cf o11y issues get ISSUE_ID` and `cf o11y issues occurrences ISSUE_ID --per-page 10` to independently verify service, exact producer version, owned error, timestamps, fingerprint and delivery activity. Create a new private inventory Workflow, then read its single digest with `{mode:"read",digest:"ACTUAL_SHA256"}` through the same inspection Workflow API. Keep raw body/history PRIVATE, not in Git, public releases, prompts or logs. Hash the actual bytes and match Issue ID/service/policy/correlation/timestamps against the independent APIs. The observed `data.issue` envelope omits scriptVersion; the occurrence API supplies it. Authentication or arbitrary notification text alone is not source/version authority.

## 4. Enroll a deliberately bounded policy, then deduplicate

`src/owned-incident.ts` enrolls **our ONE independently verified incident** and developer-authored mapping to private fixture base/path. To reproduce your own incident, change those host-owned enrollment constants only after retaining the actual independent proof, review/commit/test that mapping, and rebuild. Do not substitute caller/model payload values or reset the existing demo record. This is developer enrollment, not hardware attestation, private repository source parity or a generic platform schema guarantee.

The admission implementation has private named `OwnedIncidentAdmission` and authenticated `effect-ci-owned-incident-admission` Workflow modes ONLY `{mode:"inspect"}` and `{mode:"admit-retained"}`. It reads the pinned original authenticated capture internally; callers choose no raw body/Issue/prompt/model/repository/path/base/version/paid identity. Strict real-timeIssue/policy/correlation/one-service/count/time/type guards reject other/recurring/ambiguous incidents. A separate create-only semantic record in the SAME existing SQLite object keys the enrolled Issue, not transport bytes; concurrent deliveries and formatting/text variations deduplicate to one immutable identity. Invalid evidence still rejects after a valid admission exists. No reset, delete or automatic inference/repair follows admission; `repairAuthorized:false` and `inferenceTriggered:false` remain explicit. Original raw captures retain quarantine and `incidentDedupeVerified:false` unchanged.

Local real workerd/RPC/SQLite tests prove concurrency, byte-independent semantic dedupe and reload using clearly synthetic local fixtures. The Workflow coordinator is mocked locally. **Native admission execution/replay is pending**, distinct from the already genuine native capture. After exact-head full CI/merge/deployment, a fresh private inspect should show absent; a single admit-retained and same-record replay should preserve identities. Do not treat a local synthetic fixture as authentic native delivery.

## Stop and cleanup safely

Disable the exact owned Issue automation first, then its Notifications policy, preserving other resources. Inspect actual IDs/scope before any mutation. Retain private create-only receipts and histories; do not delete/rename the capture or budget namespaces, reset the one-shot source, rotate the retained secret, merge/deploy fixture repair PRs, or delete unrelated resources. Destructive Worker/destination removal needs exact targets and an explicit cleanup decision. The Friday ordered fresh Flue→native Node→proposed-PR loop and attestation remain separate unfinished work.

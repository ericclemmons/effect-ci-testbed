# GitHub Actions on Cloudflare

Optional, independently deployable Actions runner. Change where GitHub executes
your existing job; do not rewrite its steps or Effect CI's execution model.

```diff
 jobs:
   ci:
-    runs-on: ubuntu-latest
+    runs-on: effect-ci-cloudflare
     steps:
       - uses: actions/checkout@v7
       - uses: pnpm/action-setup@v4
       - uses: actions/setup-node@v7
         with:
           node-version: 24
       - run: pnpm install
       - run: pnpm build
```

Each YAML step has normal GitHub Actions logs and status. `cf-ci run test build`
can replace commands later, but remains **one GitHub step**: its action graph does
not become dynamic YAML steps. Existing native Cloudflare Workflows, event
routing, Slack, attestation and dependency semantics are unchanged.

## Design

Signed `workflow_job.queued` → durable single-repository queue → GitHub JIT
registration → one fresh Container → normal Actions job → destroy and deregister.

This uses our native Containers API, not either reference project's control plane.
[Matt's Sandbox example](https://gist.github.com/elithrar/082344e39d8a10c5d48b93075554ce89)
adds Sandbox tooling and rootless Docker. [biw's runner](https://github.com/biw/cloudflare-github-actions-runner)
uses Containers directly with its own provisioning/cache implementation. We use
the latter architectural shape, without importing its runner patches or R2 cache.

## Configure and deploy

**Disabled by default; no App installation or cloud resources are created by install/build.**

From the repository root:

```sh
pnpm install
cd apps/github-actions-runner
pnpm check
pnpm test
pnpm build
```

Build compiles the Worker and builds the Linux/amd64 runner image locally (Docker
required). Deploy is separate:

1. Create a **separate** GitHub App with repository **Administration: write**,
   **Actions: read**, and Metadata: read. Subscribe to **Workflow job**; set its
   webhook to `https://<your-runner-worker>/github/webhook` with a random 32+ byte
   secret. Install it on **one selected, trusted private repository**.
2. Set that App/installation/repository's numeric IDs and full repository name in
   [`src/enrollment.ts`](./src/enrollment.ts), then set `enabled: true`.
3. Store `RUNNER_APP_PRIVATE_KEY` and `RUNNER_WEBHOOK_SECRET` as Worker secrets
   using your normal Cloudflare secret provisioning. Do not put either in GitHub
   YAML, the image, a public config, or the existing Effect CI App.
4. Run `pnpm deploy`, then apply the `runs-on` change above to a **push-triggered**
   workflow in the enrolled repository. `GET /health` reports enrollment, not a
   proof that credentials or runners work.

For the first live proof, copy [`examples/smoke.yml`](./examples/smoke.yml) to
`.github/workflows/cloudflare-runner-smoke.yml` in that private repository and
push the ordinary `runner-smoke` branch. It needs no checkout or package install.
Verify both named steps and their stdout/stderr in the native GitHub job, its
`effect-ci-…` runner identity, and subsequent removal of that registration and
container. A green health endpoint or a queued job is not a completed proof.

If using this repo's reusable workflow, its existing input already accepts
`runs-on: '["effect-ci-cloudflare"]'`. No change to that reusable workflow is needed.

## Initial boundaries

- One concurrent runner; 20 pending jobs; 1,000 permanent job/attempt tombstones.
  Queue saturation returns 503; inspect and redeliver the same webhook after
  capacity is available. GitHub does not automatically retry failed webhooks.
- Private, same-repository **push** events can provision capacity. Repository,
  current queued job, run attempt, commit, event and label are re-read from GitHub
  before JIT. Public/fork/PR/dispatch provisioning is not enabled in this version.
- **Trust the entire enrolled repository and all workflows using this label.**
  GitHub may assign any matching queued job in that repository; the admission
  job is a capacity hint, not a reservation. Labels are not a security boundary.
  Do not use this pool for untrusted PR code or mixed-trust workflows.
- Runner lifetime defaults to 15 minutes (configurable 5–30). A root-owned Linux
  timeout stops Actions even during API failures; a durable alarm independently
  destroys compute and revokes the exact registration. Cleanup failures keep
  the slot occupied. No warm workspace, snapshot reuse or cross-job credentials.
- Lost registration/start ACKs never remint or restart automatically. Unknown
  registration identity quarantines the slot until it can be reconciled by its
  unique name. No public reset/dispatch/inspection endpoint exists. Inspect the
  Durable Object journal before operator maintenance; never erase state to retry.
- The Worker retains the App key and narrowed installation token. Only a one-job
  JIT configuration enters Linux; neither token nor JIT is stored in the journal.
  GitHub still supplies the job's own normal credentials to Actions.
- Minimal Ubuntu image, **not** the GitHub-hosted `ubuntu-latest` tool inventory.
  Use setup actions for Node/pnpm/etc. Docker container actions, `container:`,
  `services:` and Docker builds are **not supported** by this initial image.
  Sandbox/Docker-in-Docker is a future optional image capability, not a reason
  to change Effect CI's native execution model.

## Costs and shutdown

This uses the account's paid Workers, Durable Objects, container registry and
Containers allowances. No container is started while enrollment is disabled.
When enabled, capacity is one `standard-2` container with the configured lifetime;
GitHub jobs may still consume GitHub's storage and other account allowances.
The lifetime limits each runner, not the total number of future pushes. Disable
enrollment to stop admitting more work; do not treat it as an account spend cap.

To retire the deployment, set `enabled: false` and deploy that change first.
Allow any existing lease to finish or hit its deadline, then inspect its durable
journal and confirm its container and exact GitHub registration are gone. Cleanup
failure or quarantine requires inspection, not deletion of the journal to free
capacity. Only after cleanup, remove the dedicated App installation and the
runner Worker/Container application using the account's normal resource tools.
Never remove the existing Effect CI App or its native Workers. Keep the journal
until you no longer need its replay protection and audit history.

## Verification

`pnpm test` covers authentication/policy, narrowed App tokens, exact-name cleanup,
duplicate delivery, lost acknowledgements, restart boundaries and deadline cleanup.
The local workerd test uses actual SQLite Durable Objects and a fake GitHub
service; it does not register a runner or execute a real GitHub job.

Native GitHub step/log behavior still requires an approved selected-repository
App installation and one live job. No live registration or deployment is claimed.

Local verification: 17 tests passed, including actual workerd/SQLite reload;
TypeScript and `cf build` passed. The built Linux/amd64 image ran the official
runner as the unprivileged `runner` user and reported `2.336.0`, with networking
disabled. This is an image smoke test, not a completed Actions job.

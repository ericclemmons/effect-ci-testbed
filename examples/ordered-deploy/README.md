# Deploy apps in dependency order

The frontend calls the backend API through a Worker service binding. Its page
fetches `/api/message` and displays the backend's message. Both Workers report
their compiled source revision and Worker version at `/health`; the frontend
rejects a backend from a different source revision.

## Safe build and deployment preview

```sh
cf-ci run --workflow examples/ordered-deploy/.cloudflare/ci/workflow.ts
```

This existing default builds both apps once, then runs backend and frontend
`cf deploy --prebuilt --dry-run` commands. It needs no deployment credentials and
does not publish either Worker. The GitHub Actions comparison is also a dry run.
These paths demonstrate command order, not real deployment or served health.

[Preview actions](./.cloudflare/ci/actions.ts "source")

[GitHub Actions comparison](./.github/workflows/github.yml "source")

## Hosted order and reusable target contract

```text
checkout → shared build → pin immutable outputs
  → publish backend → inspect source/allocation → served backend health
  → recheck backend → publish frontend → inspect source/binding/allocation
  → served frontend health → frontend/backend API interaction → recheck allocation
```

[Hosted actions](./.cloudflare/ci/hosted.ts "source")

[Deployment host contract](./src/target.ts#symbol=DeploymentHost "source")

[Reusable target execution](./src/target.ts#symbol=deployTarget "source")

`deployTarget(host, workspace, prepared, app, signal, prerequisite?)` is the same
entrypoint a graph executor can call. It resolves only after deployment readback,
served health and, for the frontend, the backend interaction succeed. Frontend
publication requires the verified backend receipt from the same prepared source
and output digests. Native publication sequence must increase. This recipe uses
explicit order; graph discovery/import belongs to
[#153](https://github.com/ericclemmons/effect-ci-testbed/issues/153).

The host supplies `OrderedDeploymentHost` to the existing native CI runner.
Without that service the hosted workflow fails closed before publication.
`cf-ci --workflow examples/ordered-deploy/.cloudflare/ci/hosted.ts plan` is safe
without the service or credentials. There is **no enrolled host adapter yet**.

### Host responsibilities

- `prepare` validates the event-selected immutable source, built workspace and
  both output digests. The compiled Git SHA alone is not proof of clean source.
- `publish` maps `backend`/`frontend` to operator-approved fixed targets. It uses
  the existing host-only credential/outbound deployment path; it must not give
  credentials to project code or reuse another demo's target permission.
- Before any external write, the host durably claims the supplied intent
  (`script:revision:output-digest`) and retains the previous traffic allocation.
  A repeat returns the same receipt. A pending/uncertain write stops for read-only
  reconciliation; it never blindly uploads or deploys again.
- `inspect` reads the exact immutable version's source/output identity and current
  allocation through the broker. Frontend inspection also checks the backend
  service binding. An upload acknowledgment alone is insufficient.
- `publish` returns `nativeSequence` from the actual host native-command journal,
  not from a graph plan or echo output. `record` appends attempt events and retains
  prior receipts; it must not overwrite an earlier success with a failure.
- `fetch` performs unauthenticated served-health reads, with no credential-bearing
  transport. Reads reject redirects, unexpected versions and oversized responses.

The publication actions have zero automatic retries. Cancellation is passed to
host operations and health reads; the host must retain any uncertain intent.
There is no new broker, OIDC issuer, token policy, storage or deployment controller
in this change. Existing broker history and Access policy remain untouched.

### Failure and recovery

[Injected backend health failure](./.cloudflare/ci/failure.ts "source")

The failure workflow uses the same build, preparation and publication actions but
returns a synthetic 503 to the backend health gate after publication. The actual
Worker is not deliberately broken. Rejection prevents the frontend publication
callback from running. This is an injected gate failure, not proof that a live
backend served a 503.

For the hosted acceptance run, capture the frontend's current deployment before
and after this failure, plus the native command journal. It must remain unchanged
and contain no frontend publication. Retain the backend's successful publication
receipt and failed verification event. Recovery uses the same immutable intent:
reconcile a pending publication read-only, recheck source and health, and only then
continue to the frontend. Do not delete/recreate targets or reset receipt history.
No rollback or deletion is automatic; a failed action may already have published.

## Target approval still required

Proposed dedicated targets in Eric's existing demo account:

| Target | Proposed public origin | Bindings |
| --- | --- | --- |
| `effect-ci-ordered-deploy-backend` | `https://effect-ci-ordered-deploy-backend.ericclemmons.workers.dev` | Version metadata |
| `effect-ci-ordered-deploy-frontend` | `https://effect-ci-ordered-deploy-frontend.ericclemmons.workers.dev` | Version metadata; backend service binding |

These names in the fixture are **not approval**. The requested authority is limited
to creating/updating these two Workers, reading their immutable versions/current
deployments and enabling their two workers.dev routes. No new compute service,
custom domain, production target, credential or broad account permission is
authorized. Reuse the existing broker's host-only credential only if its operator
confirms that scope; do not broaden its proxy or OIDC grants automatically.

[#142](https://github.com/ericclemmons/effect-ci-testbed/issues/142) is closed, but
its HMD demo authority does not cover either target. The existing native product
deployment proxy is also restricted to the two product apps, not these fixtures.
After target approval, the remaining work is the narrowly enrolled host adapter
using that existing infrastructure and real positive/failure/recovery receipts.

## Evidence boundary

This is an unlanded implementation for
[#151](https://github.com/ericclemmons/effect-ci-testbed/issues/151), not a completed
hosted deployment proof. Local build, app interaction and callback failure checks
cannot establish target authority, durable host idempotency or actual native
deployment order. No real target has been created, published or changed by this
work. Keep the issue open until those hosted criteria are verified.

Local validation for this change passed the production builds and existing
deployment preview, repository `pnpm check`, 44 existing CI package tests and
17 existing recipe/ergonomics tests. In-memory host checks against the compiled
Workers verified the API interaction, one shared preparation, and blocked frontend
publication after backend publication failure, injected health failure, wrong
served version or a changed prerequisite. Those callbacks are not a native
deployment journal. A separate local workerd interaction check stalled during
startup and was stopped; it is not credited as runtime proof. No tests were added
or modified.

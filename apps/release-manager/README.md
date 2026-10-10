# Fixed-target release manager

Separate, RPC-only Worker holding `HMD_DEPLOY_TOKEN`. It has no public hostname,
HTTP administration, container or credential-exporting method. The token needs
Account → Workers Scripts → Edit on the selected account; the API token itself is
account-scoped, **not** restricted to one Worker. Code fixes both account and
target to `effect-ci-hmd-demo`. Only trusted controller Workers should receive its
service binding. Never give the binding or token to repository code or containers.

Deploy from this directory with a private dotenv secret file:

```sh
cp secrets.example.env .secrets.env
$EDITOR .secrets.env
cf deploy --secrets-file .secrets.env
```

`.secrets.env` is ignored by Git. `cf` uploads its values as Worker secrets on
**this broker only**, not as public environment bindings. Never put the token in
the checked-in template, shell arguments or personal OAuth/refresh credentials.
The controller binds the deployed Worker as `RELEASE_MANAGER`, then calls:

```ts
await env.RELEASE_MANAGER.begin(instanceId, candidateVersion)
await env.RELEASE_MANAGER.promote(instanceId, 10)
// Controller obtains complete, version/window-bound health evidence before advancing.
await env.RELEASE_MANAGER.promote(instanceId, 25)
// ... 75%, 100%, final health gate, then complete(instanceId).
// On regression or exhausted uncertainty: rollback(instanceId).
```

One singleton Durable Object serializes broker calls and stores the owner, exact
previous allocation and a write intent before any deployment change. Successful
phase replay does not redeploy. An acknowledged or reconciled rollback restores
every previous version and percentage. Ambiguous writes remain pending; recovery
matches the deployment annotation and full allocation, never blindly retries POST.
An unresolved intent requires operator review; the broker cannot reset it remotely.

Dashboard/external deployment changes are detected before writes, not atomically
fenced by Cloudflare's deployment API. Use this dedicated target with one operator;
do not claim safety against racing external deployment tools. A controller lease
defaults to fifteen minutes (trusted callers may select 30–1800 seconds). The
journal and its Durable Object alarm commit atomically before deployment writes.
`renew(instanceId)` extends a live lease; an expired owner cannot renew, promote
or complete. Expiry does **not** release ownership to a new controller: the alarm
serializes with broker calls and restores the captured allocation first.
Pending/ambiguous writes still require reconciliation; external drift blocks
recovery rather than being overwritten. Failed recovery keeps ownership and
reschedules a one-minute reconciliation attempt, with a redacted operator warning.
Legacy active journals without a deadline still require operator recovery.

This is the mutation boundary, **not** the HMD controller. Health decisions,
telemetry completeness, immutable observation history and live confidence charts
remain controller responsibilities.

## Verified execution

`coverage-release-broker-20261010-4` completed through the separate
`effect-ci-probe-release-broker` Cloudflare Workflow on October 10, 2026:

- Candidate received 10% in deployment `c7af880c-2849-47a3-95a1-86894be0f38c`.
- Repeating the same promotion returned the same deployment and journal sequence.
- Rollback restored the healthy baseline at 100% in
  `6ac41112-480d-41af-9c69-461af86d7476`.
- The controller used only `RELEASE_MANAGER` RPC; the deployment secret remained
  exclusively in the private broker. No container executed this probe.

The initial probe exposed unsupported Workers `redirect: "error"` and incomplete
write acknowledgements. The adapter now uses `manual`, rejects redirects, and
confirms writes by reading the latest allocation and owner annotation. Nine
regressions include a credential-free native Workers runtime test.
An ambiguous rollback intent was also reconciled read-only in instance
`cf_8e2d3088f2e90701e3eeb73044263b40ca20da2156ac9778a62504e33a5fae76`;
no deployment POST was repeated.

The probe is invoked through the authenticated Cloudflare API:

```sh
cf workflows instances create effect-ci-probe-release-broker --instance-id my-broker-probe
# Read-only recovery of an existing owner's pending intent, when needed:
cf workflows instances create effect-ci-probe-release-broker \
  --body '{"params":{"reconcileOwner":"existing-owner"}}'
```

The `--params` flag serializes a string; use the object-valued body for recovery.
This is not yet full 10/25/75/100 health-mediated release or WOBS/chart verification.

## Independent controller-death recovery

On October 10, 2026, fixture
`cf_dfbea9089fb2f0cec1b67d0fe04106f59a443a4683c689e19b0f347b089eece6`
promoted the failing candidate to 10% in deployment
`bf7c693a-7799-46b6-b0e3-092bad70da9c`, then was explicitly **terminated** at
18:20:13 UTC without Workflow rollback. The broker's persisted thirty-second
deadline fired independently and restored the original baseline at 100% in
`d599b570-9a32-485a-ab46-7e514ad757cc` at 18:20:30 UTC. No controller cleanup
step ran and no operator rollback was dispatched.

Read-only assertions check the terminated run, absent cleanup, prior allocation,
restoration annotation and timing:

```sh
HMD_ABANDON_INSTANCE=cf_dfbea9089fb2f0cec1b67d0fe04106f59a443a4683c689e19b0f347b089eece6 \
HMD_RECOVERY_DEPLOYMENT=d599b570-9a32-485a-ab46-7e514ad757cc \
node --test apps/example-runner/ci/tests/live-recovery.test.ts
```

The dedicated authenticated probe accepts `{"params":{"abandon":true}}` only to
create this short-lease test on the fixed demo. Terminate it during its two-minute
sleep, without `--rollback`, to exercise the independent alarm. Do not run it
alongside other releases. This does not simulate every possible outage: recovery
still depends on broker storage, alarm scheduling and the deployment API being
available, and unresolved writes or drift require operator review.

The live HMD controller also renews before each observation. Post-change regression
`cf_6b5d0a21168d1fef60a2a7d7b93f24d4893320ff0eef9f5355af0b3d3e3f4e29`
completed an uncertain-to-regression transition and normal broker rollback in
`f157265b-4ae8-40b2-ac95-416fc78705fd`; its read-only HMD assertions pass.

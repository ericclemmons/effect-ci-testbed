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
do not claim safety against racing external deployment tools. Durable ownership
does not expire automatically because an expired lease could race a delayed write.

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

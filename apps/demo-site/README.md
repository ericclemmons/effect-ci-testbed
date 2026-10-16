# Serve the same Vite build that passed CI

This owned app serves the actual three-file output from `examples/demo`, not a
separately authored showcase. A native container runs npm/Vite; a normal host action
reads its automatically inherited workspace revision and publishes bounded public
HTML/JavaScript through a private service capability. Serving uses a Worker and
SQLite Durable Object, without a container. This is **not** Workers Static Assets
upload, a Worker version rollout, HMD approval, or an entirely containerless build.

## Reproduce

From a managed checkout:

```sh
pnpm install --frozen-lockfile
node --test packages/cloudflare/src/demo-site.test.ts apps/demo-site/src/site-runtime.test.ts
pnpm --filter @effect-ci-testbed/demo-site check
cd apps/demo-site
cf build
cf deploy --prebuilt
```

The fixed public origin is
`https://effect-ci-demo-site.ericclemmons.workers.dev`. For another account, change
the host-selected name/origin together in this config and the shared
`@effect-ci-testbed/cloudflare/demo-site` protocol. No account credentials, secrets,
AI binding, outbound service, or public write endpoint are installed in this app.

The existing CI host config binds only `DemoSitePublisher` as `DEMO_SITE`.
After the exact merged host build, current resource/security/HMD inspection, and
a create-only deployment intent:

```sh
cd ../effect-ci
cf build
cf deploy --prebuilt
cd ../../examples/demo
cf-ci run --remote
```

The final `publish site` action runs with zero retries and a one-minute timeout;
its private RPC receipt contains the immutable public URL. No local credentials
are passed into project code or its container. An interrupted/uncertain publication
must be reconciled with the same revision, never a new identity to evade a conflict.
Exactly matching same-revision bytes replay; changed bytes for an existing revision
are rejected. There is no mutable `latest` route.

### Private publication diagnosis

`SiteInspectionWorkflow` is a fixed, read-only inspection of the same registry.
Its empty payload cannot select source, SQL, destinations or policy. It returns
only revision count, the host-owned retention capacity, and presence of the fixed
released `105ce02…` and failed-preview `4ae41a2…` revisions—never asset bodies.
It adds one private Workflow, no binding, secret or public route. Its retained
[native inspection](./PUBLICATION-DIAGNOSIS.md) found the original registry full
at 32/32, with the released revision present and failed preview absent. The new
256-revision retention policy also has native metadata readback preserving all
32 old records. Metadata is not publication proof: see
[publication acceptance and current status](https://github.com/ericclemmons/effect-ci-testbed/pull/311)
for the separate source-triggered run and byte verification.

```sh
cf workflows instances create effect-ci-demo-site-inspection --body '{"instance_id":"owned-site-inspection-20261016-1","params":{}}'
cf workflows instances get owned-site-inspection-20261016-1 --workflow-name effect-ci-demo-site-inspection
```

Create it once only after its reviewed host is deployed. An ambiguous acknowledgement
requires reading that same ID, not retrying. Inspection uses ordinary metered
Workflow/DO reads, with zero retries and a 15-second checkpoint deadline. It does
not publish, evict, reset storage, restart a failed run or shift production traffic.
Retain its history; removing the diagnostic Workflow needs deliberate cleanup
authority and must leave the existing registry and immutable URLs intact.

From the repository root, read the retained before/after inspections without creating or restarting anything:

```sh
LIVE_DEMO_SITE_CAPACITY=1 CF_BIN=apps/effect-ci/node_modules/.bin/cf \
  node --test apps/demo-site/src/live-capacity.test.ts
```

Open the returned `/r/<commit>/<asset-digest>/index.html` URL in the browser.
The release message is visible immediately. Click **Test JavaScript** to check
the built browser code.

## Permissions, costs, limits and cleanup

Deployment uses the operator's existing local Workers/DO authority. Runtime
publication requires only the named private service binding held by the CI host;
HTTP GET/HEAD can read, while POST/PUT/DELETE cannot publish. Assets are public:
never publish secrets, raw traces, or private browser recordings. CSP denies
network connections, framing and forms; JavaScript is allowed only from this
separate credential-free public origin.
For HTML, CSP additionally permits up to eight exact SHA-256 style-element
hashes derived from that immutable response. Kumo and the app's embedded CSS can
render without allowing arbitrary inline styles, inline scripts, style attributes,
network requests or `unsafe-inline`. Asset bodies/digests are not rewritten.

The fixed file allowlist is `index.html`, `app.js`, `message.js`, each nonempty and
at most256KiB, at most512KiB total. The registry accepts at most256 immutable
revisions; it never evicts or overwrites one. This bounds logical asset payloads
at 128MiB plus metadata/storage overhead; actual storage remains metered. The
previous capacity of 32 exhausted during normal preview pushes; the increase
retains every old revision and does not grant any actor a configurable quota.
These are UTF-8 text assets, not a
generic binary download service. Worker requests, DO compute/storage and the
existing native build containers remain metered; there is no inference or paid
browser provider here. GET recomputes stored byte identities before serving.

To stop future publication, remove only this host's `DEMO_SITE` binding and deploy
that reviewed config. Keep existing immutable revision storage and private receipts.
Deleting this Worker/DO data would break retained URLs and needs a deliberate
operator cleanup decision; no automatic destructive cleanup is provided.

## Verification boundary

Local tests use real workerd/SQLite/RPC and fake small assets to cover concurrent
publication, same-revision conflict, persisted reload, method/path/digest rejection
and response bytes. The capacity regression admits the 33rd revision without
eviction, races the last slots at 256, rejects overflow/conflicts and preserves
old receipts across reload. These local tests are not native Vite-build or
live-browser evidence.

Native instance `14c8ceb0-840f-4f39-a565-a97cc9b76c71` completed on source
`b302e8cb0965cdbc7da2ab455d696385e782abf7`: all ten actions passed, nine real
commands and one durable publication body, each once with zero configured retries.
Independent HTTP reads matched all three native build byte hashes/sizes
(HTML525B/app1520B/message103B). The published URL binds this commit and asset digest
`e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23`.
An isolated real browser loaded that URL and clicking **Show message** displayed
**Check my work before I push**; its screenshot was visually reviewed. The public
POST negative returns405 and a wrong asset digest returns404. No replacement
publication or model request was needed. Local video encoding failed; no successful
clip or public media publication is claimed.

```sh
LIVE_DEMO_SITE=1 CF_BIN=apps/effect-ci/node_modules/.bin/cf \
  node --test apps/demo-site/src/live-site.test.ts
```

Run this from the repository root: it only reads the retained Workflow and public
site. Ordinary CI skips it. Site Worker version `dd2f2784-0f16-4833-a27a-02c06ad90cad`
has no secret/outbound binding; the CI host version is
`03ee2394-d9e6-4d70-b3c1-44dbd7b1a6c9`. Private create-only deployment, native
CLI/history, independent HTTP and browser receipts are retained. Queue1743ms /
execution82223ms / total83966ms is one orchestration sample, not a build benchmark.

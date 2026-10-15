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

Open the returned `/r/<commit>/<asset-digest>/index.html` URL in the browser.
Click **Show message**.

## Permissions, costs, limits and cleanup

Deployment uses the operator's existing local Workers/DO authority. Runtime
publication requires only the named private service binding held by the CI host;
HTTP GET/HEAD can read, while POST/PUT/DELETE cannot publish. Assets are public:
never publish secrets, raw traces, or private browser recordings. CSP denies
network connections, framing and forms; JavaScript is allowed only from this
separate credential-free public origin.

The fixed file allowlist is `index.html`, `app.js`, `message.js`, each nonempty and
at most256KiB, at most512KiB total. The registry accepts at most32 immutable
revisions; it never evicts or overwrites one. These are UTF-8 text assets, not a
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
and response bytes. They are not native Vite-build or live-browser evidence.
Native same-build publication and browser acceptance must be recorded separately;
no live completion is claimed by these local tests.

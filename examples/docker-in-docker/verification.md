# Docker recipe execution boundary

Issue: [#149](https://github.com/ericclemmons/effect-ci-testbed/issues/149).
Baseline: `20f29103911800606929de4f9afa095667606e48` on main.
The implementation in this branch is unlanded; hosted execution is not yet proven.

## Guidance and prior art

Cloudflare's current [Sandbox 1.0 migration guide](https://developers.cloudflare.com/sandbox/sdk/migrate/other-features/#run-docker-inside-the-sandbox)
and [Container FAQ](https://developers.cloudflare.com/containers/faq/) require a
root daemon, disabled iptables/IP forwarding, and host networking for inner
network traffic. Consulted October 26, 2026. The older rootless recipe is not the
current 1.0 setup.

Landed [PR #373](https://github.com/ericclemmons/effect-ci-testbed/pull/373) explains
why image environment variables alone do not configure native process execution.
The [native runner](../../apps/effect-ci/src/monorepo-workflow.ts) already starts
Docker with `vfs` and a readiness probe; its image already supplies Docker/buildx.
The [rerun fixture](../../apps/effect-ci/verification/native-rerun/worker.ts) and
[monorepo host](../../apps/effect-ci/src/monorepo-workflow.ts) supply the scoped
VM-destruction/finally pattern. This change reuses those facilities and does not
replace the shared SDK, production host or deployment credentials.

Baseline-to-branch call diff (all added calls are implemented here, not new SDK APIs):

```diff
 workflowEntrypoint(workflow, options).run(event, step)
   checkout() -> CI.Source.checkout()
-  buildImage() -> workspace.exec("docker build --network=host ...")
-  runImage() -> buildImage() -> workspace.exec("docker run --network=host ...")
+  runImage() -> checkout() -> workspace.exec("node .cloudflare/ci/build-and-run.mjs")
+    Docker CLI -> build -> run -> wait/logs/inspect -> finally: remove named container/image
+    hosted runner docker.sh -> docker-native build/run --network=host
-  Worker entrypoint -> dockerd-entrypoint.sh & sleep infinity
+  start-docker -> Unix-only dockerd(vfs, no iptables/IP forwarding) -> wait(daemon)
+  docker-ready -> bounded docker info -> failure: daemon log tail
+  WorkspaceContainer.checkout/execute(...args) -> armDeadline() -> SDK method
+  Workflow finally -> cleanup checkpoint -> stop() -> destroy owned VMs
+  WorkspaceContainer.alarm() -> stop() -> destroy VM; delete alarm
```

Networking moves from portable commands into the hosted image's CLI wrapper.
Local execution uses the ordinary daemon/network unchanged. Build and run share
one action so its `finally` owns the image lifecycle, rather than leaving an
image stranded between action snapshots. No signer, callback, registry push,
production deployment or secret binding is added.

## Local execution

The [unsigned execution report](./local-proof.json) records an actual inner project
image build, Dockerfile `RUN` execution, an unprivileged container's expected
output, inspected limits, and independent empty container/image readback at
`8f6f94b52d41c6d8c7722b4445de3a081a910a5f`. An outer-environment sentinel was
present; the inner image's environment contained only `PATH`. The local daemon
was Docker Desktop, not a privileged nested daemon. This is local execution
evidence, not hosted acceptance or signed reusable check evidence.

Disposable copies of the project Dockerfile also exercised real build failure
(exit 42), inner-process failure (exit 42 with stderr retained), and a running
container whose `docker wait` exceeded 30 seconds (`ETIMEDOUT`). Each returned
nonzero; independent Docker listings found no invocation containers or images.
These experiments preceded the final cleanup-confirmation log addition; they
did not modify or add repository tests. Abrupt external local process death,
daemon loss and provider alarm delivery were not fault-injected.

The AMD64 outer image built successfully, and an offline, read-only container
with dropped capabilities verified Node, git, Docker/buildx and dockerd.
An initial APK-based layer failed TLS verification in this local environment.
The final image instead copies Node and its runtime libraries from the official
Node Alpine image, reusing Docker's existing git/CA tools; TLS verification was
not disabled. This image build is not evidence of a hosted inner run.

Validation passed: the existing root `cf-ci run check build`, the readiness-shell
and recipe-documentation tests (13 checks), recipe planning, Worker bundle
dry-run, shell/Node syntax checks and `git diff --check`. Root validation also
built the public documentation and verified its source includes. Initial sandbox
network/loopback restrictions were retried with scoped approval. No repository
test was created or changed, and no hosted pipeline was watched.

## Remaining hosted authority

No deployment or hosted workflow invocation was made in this task. Wrangler's
existing session reports unauthenticated. The available connector is not
authorized for the historical personal account used by the retained testbed
proofs. Access to unrelated Cloudflare accounts is not authority to use them.
Read-only discovery in the currently connected personal account (Eric Clemmons)
found no `effect-ci-docker*` Workflow. Creating this fixture is a new-resource
decision, not reuse of an existing approved deployment.

Requested boundary: an authenticated, explicitly selected approved account;
one isolated Worker `effect-ci-docker-in-docker`, its SQLite Workspace Durable
Object namespace, its Workflow of the same name, and its outer runner image.
No Access change, service credential, API token creation, registry publication of
the inner image, or production host update is requested.

Allow at most two manually triggered Workflow instances: the exact pushed proof
commit and one failure/cleanup case. Each can use at most two sequential
`standard-1` VMs (checkout and command), each with the ten-minute cleanup alarm.
Each VM has the provider's `standard-1` limits (0.5 vCPU, 4 GiB memory, 8 GB disk).
This is an operational scope, not a quoted monetary price or hard provider-wide
spend cap. Inspect cleanup and active-instance readback before another run.

Keep issue #149 open and all Local/Cloudflare feature-matrix cells unchanged.
Outer-image builds, Worker bundle dry-runs and monorepo deployments do not
satisfy the missing hosted inner build/run acceptance.

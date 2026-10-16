# A bounded TypeScript build transform

`buildStaticTypeScript(loader, source)` compiles one bounded TypeScript source
string to JavaScript in a fresh Dynamic Worker. It uses pinned Sucrase 3.35.1,
not a project-supplied compiler or plugin. Project source is request data: it is
never passed through the host's bundler, imported or evaluated there.

This is not completed **hosted build/deployment coverage** for #134. The
[Static Assets build mode](../../examples/static-assets-source/README.md#bounded-build)
now wires authenticated immutable source, complete output-manifest validation,
durable build provenance and the existing trusted uploader together, with local
Workflow/SQLite/WorkerLoader verification. An actual hosted build-to-served-site
run remains required. The existing
[no-build Static Assets recipe](../../examples/static-assets-source/README.md)
is separate real evidence; it is not relabelled as this build.

The API returns source, output and canonical compiler-module SHA-256 digests.
Those bind bytes, not Git authentication, successful browser behavior or trusted
deployment authority. The caller must independently establish provenance and
validate its fixed asset paths/count/total bytes before authorizing publication.
No target, token, Git client, plugin, filesystem or incoming tool bundle is an API
argument.

## Boundaries

- Source and output are each at most 32 KiB of UTF-8, without NUL.
- Only host-prepared compiler modules are bundled; maximum 32 modules/1 MiB.
- Every operation loads a fresh child with empty bindings, no compatibility
  flags, `globalOutbound: null` and zero subrequests.
- Requested native CPU limit: 1,000 ms. Host wait: 5,000 ms, aborting the request
  on expiry. These are not measured hard CPU thresholds or a guarantee that
  abort instantly terminates an uncooperative child. No infinite-loop test is
  manufactured locally.
- Child response bytes and shape are bounded, then digests are computed in the
  host. Compilation/output failure returns no publication receipt and is not
  retried. Raw source, upstream exception text and credentials are not diagnostics.
- Type erasure is not type-checking, bundling, dependency installation or a
  security analysis of the emitted browser program. Arbitrary npm lifecycle,
  Vite/native plugins and full framework builds are not supported.

## Local evidence

```sh
pnpm exec node --test packages/cloudflare-dynamic-worker/src/static-build*.test.ts
pnpm --filter @effect-ci-testbed/cloudflare-dynamic-worker check
VERIFY_STATIC_BUILD_BUNDLE=1 pnpm exec node --test examples/static-assets-source/src/compiled-runtime.test.ts
```

The actual local WorkerLoader test bundles only the pinned compiler with esbuild
as host preparation, then executes the shared adapter and compiler in workerd.
It proves TypeScript erasure without evaluating source, fresh child state, empty
child bindings, denied outbound requests, inability to read a known existing
non-secret host file, and rejected native-process execution. A `process` global
can exist without granting host process capabilities; its name alone is not an
isolation test. Negative source/output tests reject oversize data, malformed
output and redacted compiler failure. This does not prove native worker-bundler
preparation, resource enforcement or a served-site deployment.

The opt-in compiled-broker test additionally exercises real worker-bundler/WASM
preparation in local workerd, with no source reader or deployment credential.
It downloads the fixed public compiler dependencies and verifies all eight
closed isolation checks. This caught an unresolved `ts-interface-checker`
import: its legacy package `main` omits `.js`, which this bundler does not
resolve. The host pins version 0.1.13 and provides one fixed virtual alias to its
explicit `dist/index.js`; no project alias, Node child compatibility or broader
capability is introduced. CI runs this test explicitly. It still does not prove
hosted execution or publication.

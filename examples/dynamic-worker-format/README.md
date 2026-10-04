# Format source in a Dynamic Worker

This spike proves the isolate execution tier without starting a VM, Sandbox, or
Container. A normal Effect CI action declares that it only needs JavaScript:

```ts
const format = CI.action<CI.SourceTransformResult, []>(
  "format",
  () => function* () {
    const event = yield* CI.WorkflowEvent
    return yield* CI.transformSources(event.payload as CI.SourceTransformRequest)
  },
  {
    execution: {
      capabilities: ["javascript"],
      preference: "isolate-first",
    },
  },
)
```

`@effect-ci-testbed/cloudflare-dynamic-worker` sees that declaration, bundles
Prettier 3.6.2, and executes it through Cloudflare's Worker Loader binding. The
request and response are plain source maps; the Dynamic Worker receives no outbound
network binding and has a 1,000 ms CPU limit. The same router sends undeclared work,
unsupported tools, or actions requiring `filesystem`, `process`, or `native-binary`
to a supplied container executor.

## Run the proof

```sh
pnpm install
cd examples/dynamic-worker-format
pnpm dev

curl http://localhost:8791 \
  --request POST \
  --header 'content-type: application/json' \
  --data '{
    "tool": "prettier",
    "files": {
      "answer.ts": "const answer={value:42};\n"
    }
  }'
```

The result identifies the tier and returns changed source:

```json
{
  "changed": true,
  "files": { "answer.ts": "const answer = { value: 42 };\n" },
  "tier": "dynamic-worker"
}
```

The source-only Cloudflare Workflow can also be triggered locally. Its Wrangler
configuration contains a Worker Loader and Workflow binding, but deliberately has no
`containers` or Durable Object configuration:

```sh
wrangler workflows trigger effect-ci-dynamic-worker-format \
  '{"payload":{"tool":"prettier","files":{"answer.ts":"const answer={value:42}\n"}}}' \
  --local --port 8791
```

On October 4, 2026, Wrangler 4.145.0 completed that workflow locally. A cold HTTP
request, including runtime dependency resolution and bundling, took about 1.03 s;
the cached request took about 6 ms. These are development-machine observations, not
production latency claims.

## What the spike rules out

Full Vite+ parity is not currently an honest Dynamic Worker claim:

- `vp lint` resolves and launches the native Oxlint binary. Oxlint also traverses a
  workspace and discovers config and tsconfig files.
- `vp fmt` similarly fronts Oxfmt rather than exposing a supported JavaScript or Wasm
  source-transform API.
- Vitest defaults to a Node environment and process-based pools; browser mode still
  requires a provider and shared Vite server.
- Vite/Rolldown builds are workspace graph operations with config/plugin/file-system
  expectations, not the narrow source-in/result-out contract proven here.

Dynamic Workers do support JavaScript, Python, and Wasm modules, but they do not turn
`node:child_process` stubs into an operating-system process or provide a POSIX
workspace. The next viable steps are therefore tool-specific APIs: add ESLint or a
future Oxc Wasm library when its public API is compatible, then investigate a custom
Vitest pool only if it can preserve Vitest semantics without pretending to be Node.

## Cost and memory boundary

Cloudflare documents a 128 MB Worker memory limit and paid CPU time up to five minutes;
Dynamic Worker invocations inherit the account's Worker limits unless a lower custom
limit is set. A request may have four distinct Dynamic Workers in flight (ten from a
Durable Object). This proof intentionally sets a much lower 1,000 ms CPU ceiling and
loads one formatter isolate. Runtime npm resolution is experimental and adds cold
latency, so production work should cache bundles by immutable tool/version/source
identity or prebuild the formatter module. Containers remain appropriate for native
binaries, large dependency graphs, persistent workspaces, and memory-heavy builds.

Primary references:

- [Cloudflare Dynamic Workers getting started](https://developers.cloudflare.com/dynamic-workers/getting-started/)
- [Worker Loader API](https://developers.cloudflare.com/dynamic-workers/api-reference/)
- [Dynamic Worker limits](https://developers.cloudflare.com/dynamic-workers/platform/limits/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [`@cloudflare/worker-bundler`](https://www.npmjs.com/package/@cloudflare/worker-bundler)
- [Vite+ toolchain overview](https://viteplus.dev/guide/)
- [Vitest environments](https://vitest.dev/guide/environment)
- [Vitest pools](https://vitest.dev/guide/advanced/pool)

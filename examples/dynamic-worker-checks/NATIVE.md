# Native isolated Vitest assertion subset

Source: `c5bef3caf9e6ffc8f2210a82af40cb6b2a62e57b` (October 16, 2026).
Private Worker `effect-ci-source-formatter`, version
`e43a22ba-830a-4115-9a43-f4b2a3f9da21`; Workflow
`effect-ci-vitest-subset-checks`, version
`f7dc2e14-5fa4-4326-8311-f4d0bb7e1f70`.

The host bundled the real pinned `@vitest/expect` 5.0.3 / Chai runtime natively:
one module, 140,163 bytes, canonical bundle digest
`b20c1060fcc95e5eb002252e4a1da5f0c76c710f99bf782363b099410e83c630`.
Project JavaScript was appended raw afterward, not imported, evaluated or resolved
by the parent bundler. Each named test used a fresh WorkerLoader child.

## Retained results

All IDs are `owned-vitest-<mode>-20261016-1`. Each was created once, with a
create-only intent before dispatch. The following are actual native histories,
not synthetic reader fixtures or local Miniflare results.

| Mode | Workflow state | Evidence |
| --- | --- | --- |
| `passing` | Complete | Relative-module import, awaited function, three real assertions; `ok` tail |
| `state-isolation` | Complete | Two fresh children each observe counter 1; one assertion and `ok` tail each |
| `assertion-failure` | Errored | Real unequal assertion; one assertion, redacted `assertion` failure |
| `forbidden-import` | Errored | Unprovided bare import denied; redacted `execution` failure |
| `host-filesystem` | Errored | `node:fs` host-file read denied; redacted `execution` failure |
| `cpu-loop` | Errored | Infinite loop terminated; actual platform `exceededCpu` tail |

All report and verify-report checkpoints succeeded once with zero retries, on
the same Workflow version and tool digest. Required tail checkpoints also
succeeded once with zero retries. Negative workflows deliberately remain errored
after retaining their reports. The CPU tail is bound to that exact instance and
test index 0; it records 3,000 ms CPU and 3,123 ms wall time. A generic exception,
cancelled invocation or five-second outer timeout cannot satisfy the reader.

## Limits and compatibility boundaries

The fixed child policy requests `cpuMs:1000`, `subRequests:0`, empty `env`, no
Node compatibility and `globalOutbound:null`. The observed CPU receipt establishes
platform termination, **not a hard 1,000 ms maximum**. Cloudflare's
[general CPU documentation](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
describes isolate flexibility, while its
[Dynamic Worker limit API](https://developers.cloudflare.com/dynamic-workers/usage/limits/)
documents the configured maximum. Neither source establishes why this particular
run recorded 3,000 ms. Do not infer a universal three-second grace period or hide
this discrepancy. Exact-limit enforcement remains an open finding in #137.

Native import/file denial and fresh-state tests passed. Empty bindings and denied
outbound fetch also have actual **local** WorkerLoader operation tests; this six-case
native campaign did not include a direct network-attempt canary. The native
environment/outbound/subrequest policy is configured, not a claim that every
possible capability escape was tested. No parent secrets, filesystem, Container,
workspace snapshot or shell are supplied to the children.

This supports `toBe`, `toEqual` and `.not` inside awaited named exported functions.
It does not support the full Vitest runner, discovery/registration, mocks,
snapshots, plugins, Vite transforms, arbitrary npm dependencies, signed reusable
test evidence or native Oxfmt/Oxlint. A project can intentionally write a vacuous
passing assertion; this is execution isolation, not test-quality certification.

## Read-only reproduction

From the repository root, using the installed `cf` CLI:

```sh
node --test examples/dynamic-worker-checks/src/vitest-evidence.test.ts
LIVE_OWNED_VITEST=1 VITEST_WORKFLOW_VERSION=f7dc2e14-5fa4-4326-8311-f4d0bb7e1f70 CF_BIN=cf node --test examples/dynamic-worker-checks/src/vitest-live.test.ts
```

The first command tests the reader with explicitly synthetic invalid histories.
The second performs GETs only against the six retained actual histories and pins
their immutable version, outcomes, attempts and common bundle digest. It passed
for all six on October 16. Neither command creates work or repeats the loop.

The rollout added one private Workflow, one private tail entrypoint and a separate
SQLite outcome journal to the existing formatter Worker. Only `LOADER` is bound;
Workers.dev and preview URLs remain disabled. The original formatter histories,
repair automation, release allocation and other protected deployments were
preserved. No model call, public error emission, deployment credential or new
account permission was used. Worker/Workflow, bundling, child execution, tail and
journal storage remain metered. Cleanup needs explicit authority and retained
negative histories; never reset/restart/delete these runs to make a demo green.

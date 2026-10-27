# D1 preparation evidence — October 26, 2026

This is partial work for [#152](https://github.com/ericclemmons/effect-ci-testbed/issues/152),
not acceptance or a hosted deployment proof. No hosted resources or permissions
were changed. The issue remains open pending target approval and execution.

Baseline: `20f29103911800606929de4f9afa095667606e48`.

Validated source Git blobs:

| File | Blob |
| --- | --- |
| `.cloudflare/ci/actions.ts` | `b52ee6c8483ca11be6afa04478c6f1cfd6fe5c24` |
| `migrations/0002_add_display_name.sql` | `1fc49e00c2615aa798961700127c3716f46340a4` |
| `src/index.ts` | `bbbf8bd01b9c552fb1aaeda54ecd7d8240a4692e` |
| `deploy.mjs` | `35f5b5a02de1fa9e88d7371fd7577ec11e85f198` |

## Passed

- `node --check examples/d1-migration/deploy.mjs`.
- `node node_modules/typescript/bin/tsc -p examples/d1-migration/tsconfig.json --noEmit`.
- Recipe plan: `checkout → build → migrate database → deploy worker`, with no
  migration reversal or automatic deployment retry.
- `node scripts/check-example-plans.ts`: all recipe plans pass.
- Existing tests: 17 documentation/ergonomics tests and 44 CI package tests pass.
  No tests were added or changed.
- `cf build --mode production` using the installed `cf@1.0.0-beta.12`, followed by
  `node deploy.mjs`: built the new Worker and completed its **dry run**, not a
  publication. Vite required a loopback listener outside the sandbox.
- An in-memory SQLite smoke check applied the two SQL files, inserting one
  synthetic baseline row between them. Its ID, email and creation timestamp
  remained identical after expansion and injected pre-upload failure. The old
  count query returned 1; the new query returned `{count: 1, named: 0}`. Injection
  exited 1 before invoking `cf`. This is SQL/script validation, not D1 runtime,
  Worker HTTP, migration-ledger replay or hosted evidence.
- `git diff --check`.
- `pnpm docs:build`: builds and verifies 92 document routes, source snippets,
  internal links and search assets. The package manager required execution
  outside the sandbox; this does not publish the documentation site.

## Incomplete or blocked

The local `cf d1 migrations apply` command stalled. A 45-second retry outside
the sandbox timed out too. A read-only SQLite inspection of its disposable
persisted state found `users` and one `0001_create_users.sql` ledger entry, so
the command did perform that migration before timing out. It is **not** a
successful command or a complete replay proof. A separate local Miniflare smoke
attempt also stalled and was stopped. No remote fallback was used.

No hosted migration, old/new Worker health observation, post-migration deployment
failure/retry, duplicate-migration check, cross-checkout replay, native signed
receipt or GitHub comparison run has been performed. The existing GitHub D1 job
still checks only the plan and Worker build. None of these local results upgrades
that coverage.

[Exact approval request and remaining campaign](./HOSTED.md)

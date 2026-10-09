# Check an edit before pushing, then reuse unchanged work

For copyable commands, expected output, and spoken narration, use the
[step-by-step talking script](./TALKING-SCRIPT.md).

> Can a human and an agent use one CI command without writing a workflow or
> repeating a task whose inputs have not changed?

The empty [`.cloudflare/ci/ci.ts`](./.cloudflare/ci/ci.ts) opts into task inference.
There is no custom Effect workflow, Vite task configuration, input glob, or output
manifest. Ordinary package scripts opt into Vite+'s cache; Effect CI discovers
`lint` and `build`, installs dependencies, and invokes those scripts.

This example joins [zero config](../zero-config) and [Vite+ caching](../vite-plus-cache)
into a developer loop. Vite+ owns cache validity and output restoration. Effect CI
owns discovery, planning, execution, and human/agent result formatting. A cache hit
is not signed verification evidence.

## Set up once

Use Node 24.11+ or Node 26+. From the testbed repository root:

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
cd examples/developer-loop
cf-ci list --format=text
cf-ci plan --format=mermaid
```

No `--workflow` flag is needed. Discovery walks up from the current directory;
it also works inside `app/`. The PATH setup exposes the workspace's CLI once;
there is no package-manager prefix on subsequent CI commands.
The product command is `cf-ci`, not yet `cf ci`.

## Human demo

1. Run `cf-ci run lint --format=text`, then
   `cf-ci run build --format=text`. The first build primes the cache.
2. Run the build again. Look for Vite+'s `cache hit` output. Do not use replayed
   `Built dist/message.js` output as proof that the build executed again.
3. Delete only the generated `dist/message.js` and rerun the build. Vite+ should
   restore the output from cache.
4. Change a sentence in this README and rerun the build. It does not read this
   README, so the build should remain a hit.
5. Change the string in `app/message.js`, without committing or pushing. Rerun
   lint and build. The changed source should invalidate both tasks; inspect
   `dist/message.js` to see the new string. An immediate repeat should hit.
6. Remove the closing quote in `app/message.js`. Run lint with `--format=json`:
   it must return `ok: false` and a nonzero exit code. Rerun with `--format=text`
   to see the syntax diagnostic, restore the quote, and rerun.

Compare total command times with `time`, keeping dependencies and task scope the
same. Do not promise a speedup: this deliberately tiny build may be faster to
execute than to validate. The point is visible reuse, correct invalidation, output
restoration, and no push required—not an artificial slow task.

Every inferred invocation still runs an installation action. Cache hits skip the
Vite+ task body, not installation or the CLI. Output replay is tool-owned reuse,
not a `CI.check` signed-evidence hit. Environment, network, time, and other inputs
that filesystem observation cannot capture need a separate tracking policy.

## Agent demo

Give the agent this task:

> Change the exported message to "Checked before pushing". Discover the available
> CI targets, inspect the lint plan, then run lint and build with JSON output.
> Fix any failure and rerun. Confirm the generated artifact contains the new
> message. Do not commit or push.

The agent uses the same entrypoint as the human:

```sh
cf-ci list --format=json
cf-ci plan lint --format=json
cf-ci run lint --format=json
cf-ci run build --format=json
```

JSON mode suppresses command logs so stdout remains a structured CLI result.
The current local executor does not include compiler diagnostics in a JSON
failure; rerun the failed target in text mode to read them. Use text mode to show
Vite+ cache diagnostics. An `ok: true` result means this
target succeeded, not that every possible check passed. Here `lint` only checks
JavaScript syntax, and `build` copies the source into a generated artifact.

No trailer is suggested: the existing commit-scoped signer does not bind dirty
working-tree content. See [verification evidence](../verification-evidence) for
that separate contract and its trust requirements.

## GitHub checks

The root E2E workflow includes this discovered entrypoint in the existing
Effect-on-GitHub matrix. Its plan and execute jobs use the shared runner and
existing GitHub App reporter. No new App, secret, deployment, or hosted Worker is
required. This example does not claim Cloudflare zero-config hosting coverage.

The local plan/execute matrix runs the same example. The conventional
[GitHub workflow](./.github/workflows/github.yml) runs these identical package
scripts directly and is included in the native comparison matrix. Its caching
comes from Vite+ too; the difference is the portable CI entrypoint and result
contract, not a faster underlying build algorithm.

# Check an edit before pushing, then reuse unchanged work

For copyable commands, expected output, and spoken narration, use the
[step-by-step talking script](./TALKING-SCRIPT.md).

> Can a human and an agent use one CI command without writing a workflow or
> repeating a task whose inputs have not changed?

The empty [`.cloudflare/ci/ci.ts`](./.cloudflare/ci/ci.ts) opts into task inference.
There is no custom Effect workflow, input glob, or output manifest. Vite configuration
selects the library entrypoint, lint rules, and cached task bodies.
Ordinary package scripts expose those tasks and their lifecycle hooks; Effect CI discovers
`check`, `lint`, `typecheck`, `test`, and `build`, installs dependencies, and
invokes those scripts.

```json
{
  "check": "vpr check:source",
  "lint": "vpr lint:source",
  "typecheck": "vpr typecheck:source",
  "pretest": "vpr typecheck",
  "test": "vpr test:source",
  "prebuild": "vpr typecheck && vpr lint",
  "build": "vpr build:source"
}
```

The wrapper scripts call distinct tasks in `vite.config.ts`, with `cache: true`
on each task. No package script needs a cache flag or recursively calls itself.
The task bodies are Vite+'s built-in linter and builder, not custom programs.
`no-undef` is explicitly an error in `vite.config.ts`, so a bare `asdf` fails lint
even though it is valid JavaScript syntax. Plain `vp lint` discovers the project
files without a directory argument. This example keeps its source in `src/`.
The config excludes the generated `dist/` output and empty `.cloudflare/` CI marker.

`check` runs formatting and lint only. `typecheck` uses the TypeScript checker
through Vite+'s lint driver with lint rules disabled. `tsconfig.json` enables
`allowJs` and `checkJs` for `src/`, so the JavaScript source and tests get static
type checking without conversion to TypeScript. `test` requires type checking;
`build` requires type checking and lint, but not formatting or test execution.
`pretest` and `prebuild` express these prerequisites as package lifecycle hooks.
Vite+ caches each configured task independently. A failed prerequisite prevents
its dependent command from running. Run `cf-ci run build`, `npm run build`, or
`vpr build` to include the hook; bare `vp build` invokes only the built-in bundler.
Type-check flags stay in the configured `typecheck:source` task rather than global
`lint.options`, because enabling them globally would also type-check `check`.

The test checks that the exported message is a non-empty string, not a particular
sentence, so the human and agent can change the message during the demo.

This example joins [zero config](../zero-config) and [Vite+ caching](../vite-plus-cache)
into a developer loop. Vite+ owns cache validity and output restoration. Effect CI
owns discovery, planning, execution, and human/agent result formatting. A cache hit
is not signed verification evidence.

Local text output preserves tool colors when the terminal supports them, including
Vite+ cache replay. `NO_COLOR`, `NODE_DISABLE_COLORS`, and explicit `FORCE_COLOR`
settings are respected. Redirected output does not automatically enable colors,
and JSON output remains separate from command logs.

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
it also works inside `src/`. The PATH setup exposes the workspace's CLI once;
there is no package-manager prefix on subsequent CI commands.
The product command is `cf-ci`, not yet `cf ci`.

## Human demo

1. Run `cf-ci run lint --format=text`, `cf-ci run test --format=text`, then
   `cf-ci run build --format=text`. The first build primes the cache.
2. Run the build again. Look for Vite+'s `cache hit` output. Do not use replayed
   build output as proof that the build executed again.
3. Delete only the generated `dist/message.js` and rerun the build. Vite+ should
   restore the output from cache.
4. Change a sentence in this README and rerun the build. It does not read this
   README, so the build should remain a hit.
5. Change the string in `src/message.js`, without committing or pushing. Rerun
   lint and build. The changed source should invalidate both tasks; inspect
   `dist/message.js` to see the new string. An immediate repeat should hit.
6. Add a bare `asdf` line to `src/message.js`. Run lint with `--format=json`:
   it must return `ok: false` and a nonzero exit code. Rerun with `--format=text`
   to see the undefined-variable diagnostic, remove that line, and rerun.

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
> CI targets, inspect the lint plan, then run lint, test, and build with JSON output.
> Fix any failure and rerun. Confirm the generated artifact contains the new
> message. Do not commit or push.

The agent uses the same entrypoint as the human:

```sh
cf-ci list --format=json
cf-ci plan lint --format=json
cf-ci run lint --format=json
cf-ci run test --format=json
cf-ci run build --format=json
```

JSON mode suppresses command logs so stdout remains a structured CLI result.
The current local executor does not include linter diagnostics in a JSON
failure; rerun the failed target in text mode to read them. Use text mode to show
Vite+ cache diagnostics. An `ok: true` result means this
target succeeded, not that every possible check passed. Here `lint` runs Oxlint
with undefined identifiers treated as errors. `build` first checks types and
lint, then bundles the source into an ES module at `dist/message.js`. Run
`cf-ci run check` for formatting/lint and `cf-ci run test` for behavioral tests.

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

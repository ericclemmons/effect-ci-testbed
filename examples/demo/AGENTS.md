# Demo

Use `cf-ci`, `cf-ci list`, `cf-ci plan`, and `cf-ci run [target]` from this
directory. In this workspace checkout, use `pnpm exec cf-ci` if the executable is
not on PATH. Do not pass `--workflow`. The initial demo has no CI marker:
help/list/plan infer package scripts without writing files; explicit run creates
the ignored empty `.cloudflare/ci/ci.ts` marker. No target means the full workflow.

Use `--agent` for deterministic agent-friendly JSON in a human terminal; automatic
direct-agent environment detection also selects JSON. Explicit `--format` overrides
both. Human terminals default to readable text without a format flag. A nonzero exit code
is a failure. If JSON only names the failed command, rerun that target with
`--format=text` to read its diagnostics, then fix the source and rerun. The demo's
lint uses plain `vp lint`, with `no-undef` set to `error` in `vite.config.ts`:
undefined identifiers such as `asdf` are errors. `check` is formatting and lint
only. `typecheck` invokes the TypeScript checker through Vite+'s lint driver with
lint rules disabled; `tsconfig.json` checks JavaScript source and tests with
`allowJs` and `checkJs`.

Make source changes in `src/message.js`. Do not edit generated `dist/message.js`.
The `pretest` hook runs `vpr typecheck` before the test task. The `prebuild` hook
runs `vpr typecheck` and `vpr lint` before the build task bundles the exported
message as an ES module. Task commands and `cache: true` live in `vite.config.ts`.
Use the public package scripts, not bare `vp build`, to include these hooks.
Vite+ caches the configured tasks separately. A failed prerequisite
stops its dependent command. Build does not depend on formatting or tests.
Do not commit or push unless the user asks. These results do not provide signed
dirty-worktree evidence, authorize a commit, or justify a verification trailer.

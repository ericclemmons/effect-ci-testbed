# Developer-loop demo

Use `cf-ci list`, `cf-ci plan`, and `cf-ci run <target>` from this
directory. In this workspace checkout, use `pnpm exec cf-ci` if the executable is
not on PATH. Do not pass `--workflow`: the empty `.cloudflare/ci/ci.ts` is discovered.

Use `--format=json` when consuming results programmatically. A nonzero exit code
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

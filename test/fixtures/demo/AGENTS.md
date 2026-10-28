# Demo

Use `effect-ci`, `effect-ci list`, `effect-ci plan`, and `effect-ci run [target]` from this
directory. In this workspace checkout, use `pnpm exec effect-ci` if the executable is
not on PATH. Do not pass `--workflow`. The initial demo has no CI marker:
help/list/plan infer package scripts without writing files; explicit run creates
the ignored empty `.cloudflare/ci/ci.ts` marker. No target means the full workflow.

Agent detection uses `@vercel/detect-agent`, including `AI_AGENT` and tool-specific
environment signals; no `--agent` flag is needed. Explicit `--format` overrides
detection. Human terminals default to readable text without a format flag. A nonzero exit code
is a failure. If JSON only names the failed command, rerun that target with
`--format=text` to read its diagnostics, then fix the source and rerun. The demo's
lint uses plain `vp lint`, with `no-undef` set to `error` in `vite.config.ts`:
undefined identifiers such as `asdf` are errors. `check` is formatting and lint
only. `typecheck` invokes the TypeScript checker through Vite+'s lint driver with
lint rules disabled; `tsconfig.json` checks TypeScript source and tests.

Make source changes in `src/message.ts`. Do not edit generated `dist/message.js`.
The `pretest` hook runs `vpr typecheck` before the test task. The `prebuild` hook
runs `vpr typecheck` and `vpr lint` before the build task bundles the exported
message as an ES module. Task commands and `cache: true` live in `vite.config.ts`.
Use the public package scripts, not bare `vp build`, to include these hooks.
Vite+ caches the configured tasks separately. A failed prerequisite
stops its dependent command. Build does not depend on formatting or tests.
Do not commit or push unless the user asks. These results do not provide signed
dirty-worktree evidence, authorize a commit, or justify a verification trailer.

Reusable evidence is commit-first, not dirty-tree feedback. In a clean enrolled
checkout, after the authorized commit has been pushed:

```sh
effect-ci run test build --remote --format=json
```

The trusted host uses the same check definitions for remote and SCM runs. It
signs successful enrolled syntax/test commands with a separate host-owned key,
after checking unchanged prepared inputs and runtime. The next exact-input run
can verify that receipt. Local runs and local Git notes are not this authority.
No key reaches project code or containers. A test receipt does not imply build
success: build has its own completed-step receipt binding its returned workspace
snapshot. A later run can restore that snapshot into its own workspace identity
instead of rebuilding. Deployment and approval actions still execute. Changing the
suite/config/dependencies or using a nonliteral demo message leaves ordinary
execution intact. Never weaken enrollment to force a hit or copy evidence to
another commit. Squash/rebase requires new verification.

Historical local signers remain separate experiments. Keep their keys outside
containers; never overwrite existing notes or describe them as host-issued
receipts. See `../../../packages/cloudflare/src/trusted-runner-receipts.md`.

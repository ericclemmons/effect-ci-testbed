# Demo

Use `cf-ci`, `cf-ci list`, `cf-ci plan`, and `cf-ci run [target]` from this
directory. In this workspace checkout, use `pnpm exec cf-ci` if the executable is
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
node .cloudflare/ci/attest.ts
git push origin refs/notes/effect-ci-hosted-checks-v1
cf-ci run --remote
```

The local signer executes the exact committed pure syntax check in the pinned
Linux image before signing. Keep its private key outside containers and project
code. Existing exact-commit notes are create-only: inspect conflicts, do not force
an overwrite. Only the enrolled check may be verified; builds and other actions
still execute. Advisory `refs/notes/effect-ci-verification` is not reuse authority.

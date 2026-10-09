# Developer-loop demo

Use `cf-ci list`, `cf-ci plan`, and `cf-ci run lint` or `cf-ci run build` from this
directory. In this workspace checkout, use `pnpm exec cf-ci` if the executable is
not on PATH. Do not pass `--workflow`: the empty `.cloudflare/ci/ci.ts` is discovered.

Use `--format=json` when consuming results programmatically. A nonzero exit code
is a failure. If JSON only names the failed command, rerun that target with
`--format=text` to read its diagnostics, then fix the source and rerun. The demo's
lint uses plain `vp lint`, with `no-undef` set to `error` in `vite.config.ts`:
undefined identifiers such as `asdf` are errors. It does not perform formatting
or type checking.

Make source changes in `app/message.js`. Do not edit generated `dist/message.js`.
Run the build after a successful lint so the artifact reflects the edited source.
The build uses `vp build` to bundle the exported message as an ES module.
Do not commit or push unless the user asks. These results do not provide signed
dirty-worktree evidence, authorize a commit, or justify a verification trailer.

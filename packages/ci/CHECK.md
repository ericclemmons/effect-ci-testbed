# CI.check

Use `CI.check(id, construction, options?)` for an assertion that returns no
workspace or domain result. It succeeds or fails. Dependencies belong in the
check's construction, just as they do in an action.

Its handler may end with `workspace.exec(...)`. The check discards that
workspace, so a runner never commits or snapshots it after the command passes.
A long hosted test step then has no post-command snapshot that can fail when its
container is replaced.

[Inspect required files](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=inspect "source")

A check may opt into `reuse: { scope: "commit" }`. A trusted host must verify
acceptable evidence for that exact commit; the option alone does not create
trust or a cache. Missing or invalid evidence runs the check normally.

[Reusable check](../../examples/verification-evidence/.cloudflare/ci/actions.ts#symbol=lint "source")

Use an action for builds and deployments. Use [CI.optional](./WORKFLOW.md#optional)
when a failed assertion may be reported as a warning.

[Reuse](../../examples/verification-evidence)

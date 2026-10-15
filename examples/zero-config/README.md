# Discover checks automatically

> How do I get an inspectable CI workflow by adding an empty `ci.ts`?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_install["install"]
  step_format["format"]
  step_lint["lint"]
  step_test["test"]
  step_build["build"]
  step_checkout --> step_install
  step_install --> step_format
  step_install --> step_lint
  step_format --> step_lint
  step_install --> step_test
  step_lint --> step_test
  step_install --> step_build
  step_test --> step_build
```

---

The empty [`.cloudflare/ci/ci.ts`](./.cloudflare/ci/ci.ts) is the opt-in. An explicit
local `cf-ci run` in a package with conventional scripts and no discovered workflow
creates this empty marker automatically, then executes the inferred workflow.
`cf-ci run lint` creates it and runs the selected inferred target. A known package
manager declaration or lockfile is needed for installation. Existing workflows
are never overwritten; unknown targets and packages without supported scripts
are rejected before creating the marker. Initialization refuses symlinked config
directories. `plan`, `list`, explicit workflow paths and remote dispatch remain
non-initializing. With the marker in place, `cf-ci`
discovers `package.json`, detects conventional `format`, `lint`, `check`, `typecheck`,
`test`, and `build` scripts, and synthesizes ordinary CI actions before planning.

Nothing special executes behind the plan: checkout and installation remain visible,
every inferred script is a node, and each script becomes an intentional direct target:

```sh
pnpm exec cf-ci list
pnpm exec cf-ci plan --format=mermaid
pnpm exec cf-ci run lint
pnpm exec cf-ci run
```

Adding an explicit default workflow later replaces CLI inference completely.

Bare `cf-ci` (or `cf-ci --help`) prints usage, including list/plan/Mermaid
commands and the configured project's targets; it does not execute or initialize.
`cf-ci run` without a target executes the whole default workflow.

Inference currently uses a conservative serial script order. This is not proof
of automatic dependency-driven parallelism or of Vite/Node execution in an isolate.
The CLI bootstrap regression executes a real dependency-free npm package from a
fresh temporary directory; it is local proof, not a new hosted coverage result.

The [hosted example runner](../../apps/example-runner) uses the same SDK inference,
but reads `package.json` from the requested immutable GitHub revision in a native
Workflow step. It then runs checkout, installation, and the inferred tasks in the
Cloudflare workspace layer. No task definitions are copied into the host, and the
consumer's `ci.ts` remains empty. This proof supports public GitHub source; arbitrary
private repository discovery and executing a source-defined workflow module are
separate concerns.

## Verification proof

**Video:** Pending — no same-run recording has been published for this recipe.

**Measured results:** Pending — no structured per-environment timing summary has
been published here. Existing recorded runs and coverage claims remain as documented;
missing media or measurements do not imply those runs failed or were never verified.

Use the [proof-page contract](../PROOF-PAGES.md) for exact revision/environment,
assertions, video/transcript, outcome and cold/warm timings. See the
[coverage matrix](../../README.md#recipes-by-feature) for current backend support.

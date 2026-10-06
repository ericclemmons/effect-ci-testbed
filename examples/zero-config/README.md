# Infer conventional project tasks

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

The empty [`.cloudflare/ci/ci.ts`](./.cloudflare/ci/ci.ts) is the opt-in. `cf-ci`
discovers `package.json`, detects conventional `format`, `lint`, `check`, `typecheck`,
`test`, and `build` scripts, and synthesizes ordinary CI actions before planning.

Nothing special executes behind the plan: checkout and installation remain visible,
every inferred script is a node, and each script becomes an intentional direct target:

```sh
pnpm exec cf-ci list
pnpm exec cf-ci plan --format=mermaid
pnpm exec cf-ci run lint
pnpm exec cf-ci
```

Adding an explicit default workflow later replaces inference completely. Cloudflare
hosting will require the source manifest to be available during workflow creation, so
that environment remains roadmap work.

# Run every combination in a matrix

> How do I check every combination of two independent configuration axes?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_test_de_DE_EUR["test de-DE EUR"]
  step_test_de_DE_USD["test de-DE USD"]
  step_test_en_US_EUR["test en-US EUR"]
  step_test_en_US_USD["test en-US USD"]
  step_checkout --> step_test_de_DE_EUR
  step_checkout --> step_test_de_DE_USD
  step_checkout --> step_test_en_US_EUR
  step_checkout --> step_test_en_US_USD
```

---

This recipe runs the same currency-formatting check for **two locales × two
currencies**, producing four parallel actions. Every combination runs; this is
coverage expansion, not test splitting. The small fixture needs only Node 24+.
Node versions, browsers or operating systems can also be matrix axes, but require
a runner that supplies those environments; this recipe does not simulate them.

[The actions](./.cloudflare/ci/actions.ts) create a distinct action definition for
each combination. Action IDs include both dimensions because Effect CI memoizes
by action ID, not by arguments. The workflow coordinates them with `CI.parallel`.
The [GitHub comparison](./.github/workflows/github.yml) uses `strategy.matrix` with
the same two axes and `fail-fast: false`.

Expected result: four passing combinations and one shared checkout.
To demonstrate failure, prefix the run command with
`FAIL_COMBINATION="en-US USD"`; that combination fails and the workflow exits nonzero.

Next: [split a suite](../test-splitting) when parallel jobs should run different tests.

From the repository root after `pnpm install`:

```sh
pnpm cf-ci --workflow examples/matrix/.cloudflare/ci/workflow.ts plan
pnpm cf-ci --workflow examples/matrix/.cloudflare/ci/workflow.ts run --format=text
node --test examples/matrix/.cloudflare/ci/tests/matrix.test.ts
```

Compare [plain GitHub Actions](./.github/workflows/github.yml) with the
[Effect-on-GitHub caller](./.github/workflows/effect-on-github.yml). The repository’s
[parallel recipe checks](../../.github/workflows/parallel-recipes.yml) exercise native
matrix jobs, shard report aggregation, and reuse of measured timing history.

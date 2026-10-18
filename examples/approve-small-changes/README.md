# Approve a README-only PR

> Can an organization approve a narrowly defined small change automatically?

Yes. This example expresses the policy as ordinary Effect CI actions:

```text
inspect PR → is small change → approve small change
                         ↘ normal review for everything else
```

The trusted organization defines “small.” Here it means fewer than 100 changed
lines, only `README.md` or `docs/README.md`, successful exact-head `test`/`build`
checks, complete deterministic documentation review, and at least one prior merged
documentation PR by the author. These are example choices, not a universal safety
claim. No model is needed to decide the path allowlist.

```ts
const decision = yield* isSmallChange()
if (decision.eligible) yield* approve()
```

[`workflow.ts`](./workflow.ts) contains the actions and policy. Eligibility checks
**every** changed path; “no TypeScript changed” alone is not an approval policy.
A shell script, workflow, lockfile or security file could still have changed.
Unknown/incomplete evidence does not approve—the opposite of a work-selection
watchlist, where uncertainty should run checks.

## Try the local rehearsal

From the repository root after installing dependencies:

```sh
node examples/approve-small-changes/demo.ts
node --test examples/approve-small-changes/workflow.test.ts
```

The first command prints three plans and captured decisions:

- README-only: `inspect PR`, `is small change`, `approve small change`.
- TypeScript change: normal review; no approval action.
- `package.json` change: normal review; no approval action.

This uses **fixture evidence and a captured writer**. It sends no GitHub review,
creates no PR, changes no rules and does not merge anything. Planning also performs
no API reads or writes.

## Connect the real host

Use [`readSmallChange` and `publishSmallChange`](../../packages/github/src/small-change-host.ts)
with the **same policy**, a host-owned GitHub App capability and a durable operation
journal. Supply them to the workflow's `read`/`approve` callbacks. The canonical
reader includes old/new rename paths and verified checks. The writer rereads
evidence, pins the approval to `commit_id`, journals intent, and reconciles lost
acknowledgements without blindly submitting another review.

Run this trusted workflow from the organization-controlled revision, not code
checked out from the incoming PR. Do not expose the App key or approval capability
to that code. Later pushes need stale-review dismissal and fresh policy evaluation.
Ineligible changes go to normal review, not an automatic rejection.

The existing host already demonstrated a real
[README approval on PR #340](https://github.com/ericclemmons/effect-ci-testbed/pull/340)
and a [code change requiring normal review on PR #341](https://github.com/ericclemmons/effect-ci-testbed/pull/341).
See [retained hosted evidence](../../apps/effect-ci/TRUSTED-REMOTE.md).
Those runs used the existing host policy, not this new recipe's arbitrary thresholds.
They did not enable auto-merge or demonstrate an App acting as a code owner.

## Approval, CODEOWNERS and auto-merge are different gates

GitHub Apps can submit `APPROVE` reviews using Pull requests write permission.
They **cannot be listed in CODEOWNERS**. A required code-owner review is not
satisfied merely because the App approved. See
[GitHub's answer](https://github.com/orgs/community/discussions/23064) and
[CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

When all required checks and reviews are genuinely satisfied, GitHub's separately
enabled [auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)
or merge queue can merge. The approval action has no merge capability and does not
enable auto-merge, weaken owner requirements or grant itself bypass permissions.
If the selected paths require a human owner, that review remains required.
A separately managed machine-user code owner is another account model; this
example does not create or impersonate one.

## Verification proof

**Video:** Pending.

**Measured results:** [Local workflow tests](./workflow.test.ts) cover allowed
READMEs, mixed paths, TypeScript/JSON/security changes, missing/stale evidence,
the line-count boundary, no-I/O planning and a failed approval attempted only once.
The real shared host writer has separate journal/reconciliation tests; no new live
approval or merge is claimed by this recipe.

[Proof requirements](../PROOF-PAGES.md).

# Small changes

Reuse the work. Review the change.

```text
agent: cf-ci run test build --remote
PR:    verify receipts → small-change → approve or normal review
merge: GitHub's existing rules + the user's auto-merge setting
```

Remote results cover execution, not approval. The PR-only gate reads the current
head/base, verified check results and org-owned review evidence. It does not
rerun tests or ask an agent to review a README.

Inspired by [Will Larson's small-change policy](https://lethain.com/small-changes/).
The thresholds and service boundaries are policy, not CI primitives.

## Write the policy

```ts
import { approveSmallChange } from "@effect-ci-testbed/github/small-change";

await approveSmallChange({
  policy: {
    maxChangedLines: 1000, // additions + deletions; strictly below this limit
    maxServices: 1,
    minMergedPullRequests: 10,
    requiredChecks: ["test", "build"],
    service: path =>
      path === "README.md" || path.startsWith("apps/demo/")
        ? "demo"
        : undefined, // shared, sensitive and unknown paths need normal review
  },
  read: host.readPullRequestEvidence,
  publish: host.publishSmallChangeDecision,
});
```

The host owns both callbacks. `read` uses canonical GitHub data, the trusted
receipt verifier, author history and the org's reviewer—not JSON from PR code.
Fetch every changed file, including both paths of a rename. Mark incomplete
pagination, missing patches/review or uncertain history as incomplete evidence.
Count only distinct merged PRs by this author in each affected service.

`publish` writes `small-change` on `decision.head`. An eligible result can also
submit an `APPROVE` review with that `commit_id`. Journal writes and reconcile
lost acknowledgements rather than blindly posting another review. Changed
head/base/check/review evidence aborts before publication; later pushes must
invalidate approval through GitHub's stale-review rules.

No merge token, deployment or auto-merge toggle belongs in this action.

## Two paths

| Change | PR-only result |
| --- | --- |
| Small README edit, experienced author, verified tests/build | Deterministic documentation review → eligible → approve |
| Small application edit, experienced author, completed AI review without P0/P1/P2 findings | Eligible → approve |
| Large change, shared code, unknown author history or incomplete review | Not eligible → normal review |
| Reviewer finds a defect | Normal reviewer comments or requests changes |

The README path is intentionally narrower than arbitrary Markdown. A `.md`
extension does not make agent instructions, security policy or generated inputs
safe. Host service exclusions still apply to README files in sensitive areas.
AI findings must come from the org's pinned reviewer for this exact head/base;
an absent review does not mean zero findings. This module makes no model calls.

Do not make eligibility itself an unconditional required-success check if normal
human-reviewed changes must still merge. Keep build/test and review requirements;
use eligibility to grant the narrow automatic approval path. CODEOWNERS and
rulesets remain authoritative: this bot does not bypass them. The user enables
auto-merge separately.

## Run the example

From the repo root:

```sh
node --test packages/github/src/small-change.test.ts
```

This exercises both paths with fixture PR evidence and a captured writer. It also
proves that stale checks, moving commits, missing reviews, duplicate history and
the 1,000-line boundary cannot approve. It does not create a GitHub review.

The hosted [PR workflow](../../../apps/effect-ci/src/small-change-review.ts) and
[signed event router](../../../apps/effect-ci/src/small-change-webhook.ts) are
implemented. Deployment and the live two-PR acceptance demo are still pending.
No repository protection or auto-merge settings are changed by this example.

The demo host uses the existing Effect CI App, restricted to this repository.
Its short-lived token has Contents read, Checks write and Pull requests write;
it cannot merge. PR events and completed native check suites select the separate
review workflow. The host verifies test and build receipts through its private
authority, not a key supplied by the PR. The numeric bot identity survives renames.

The reader bounds history to 300 recent closed PRs and 30 same-author merged PR
file lists. It may undercount experience; that means normal review, not invented
qualification. Unavailable or incomplete evidence never grants approval. Code
changes currently need normal review: no paid reviewer is configured.

# Approve a README-only PR

Only `README.md` changed? Approve. Everything else goes to normal review.

```ts
export const policy = ({ files }) =>
  files.length === 1 && files[0]?.path === "README.md"
```

No line limits, author history, service counts or AI rationale. Checks and merge
requirements remain separate GitHub gates; approval is not permission to merge.

## Run it

From the repository root:

```sh
node examples/small-change/demo.ts
node --test examples/small-change/workflow.test.ts
```

The rehearsal runs the actual workflow with fixture evidence and a captured
approval writer. README-only approves; TypeScript and JSON changes do not. It
sends no real review, creates no PR and changes no repository rules.

```text
inspect PR → is small change → approve small change
                         ↘ normal review
```

## Choose the policy in the trusted App

[`workflow.ts`](./workflow.ts) exports the rule separately from the host's
`read` and `approve` capabilities. The organization-controlled App/workflow can
choose this rule or another rule dynamically. The PR under review cannot select
its own policy or receive approval credentials.

Use the same selected rule with the shared
[`readSmallChange` / `publishSmallChange`](../../packages/github/src/small-change-host.ts)
host adapter. It reads a complete diff pinned to the canonical base and head,
includes both sides of renames, revalidates before writing, pins the approval to
that head, and journals/reconciles uncertain acknowledgements. A simple function
policy does not fetch author history. Unknown, incomplete, closed, draft or
moving evidence never approves.

An approval does not bypass CODEOWNERS, required checks or human reviews, enable
auto-merge, or grant merge permissions. This example does not enroll a new live
repository or change the existing production policy.

## Verification proof

The [workflow tests](./workflow.test.ts) exercise the real action graph, README
and mixed/code paths, large README changes by an author with no history, missing
or stale canonical evidence, no-I/O planning and failed-write non-replay. The
shared host tests exercise the canonical reader and journaled exact-head writer
with captured GitHub responses. No live automatic approval is claimed here.

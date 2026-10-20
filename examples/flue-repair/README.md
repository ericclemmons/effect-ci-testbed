# Propose a fix, then check it

Let a model propose a patch, but let independent checks decide whether to open
a pull request.

```text
failure → proposed patch → allowed-diff check → exact-commit tests → PR
```

The model does not get to merge or deploy. The [writer](../../packages/github/src/repair.ts)
restricts the patch, and the [verifier](../../packages/github/src/repair-verifier.ts)
checks the candidate independently.

This example has an [existing unmerged proposal](https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/2)
in a private fixture. It is not a fresh-repository installer. Model execution
remains off unless separately authorized and enrolled; see
[host setup](../../test/apps/repair-agent/README.md).

For formatting or lint rules with a deterministic fixer, use that tool instead
of a model. The [format-recovery helper](../../packages/source-tools/src/format-recovery.ts)
checks those candidate bytes; its PR-creation integration is not connected yet.

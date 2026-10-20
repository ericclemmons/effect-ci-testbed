# Recording and publication notes

These are maintainer notes for recording runs, not a template for example READMEs.
READMEs explain the user's problem, show the useful code, and describe how to try it.
Keep recording metadata, execution audits and publication checklists out of them.

## README shape

1. **What / why:** a clear title and the task it demonstrates.
2. **Useful code:** the smallest part that solves that problem; a diagram only if helpful.
3. **Try it:** essential setup, commands, and what happens.
4. **Limitations:** only those that matter to someone using the example.

Recorded artifacts and historical results remain separate. A documentation rewrite
does not change a run's outcome or an environment's coverage status.

## What the E2E harness records

One asserted run produces a manifest containing recipe and scenario, repository,
full source commit, workflow/policy/toolchain identity, backend, actual runner/browser,
run/version identifiers, timestamps, expected and actual outcomes, assertion result,
media digest, video and transcript references, and any editing/speed changes.
This is the publication contract; the recorder and full manifest publisher are
still being implemented in issues #165 and #176.

Record queue, execution, evidence/approval wait and total elapsed time separately
where the backend exposes them. Unknown is not zero. State dependency/cache state,
cold/warm conditions and sample count; one run is not a benchmark distribution.
Keep raw timings even when the presentation is cut or sped up.

Conventional GitHub Actions, Effect CI Local, Effect CI GitHub, hosted Cloudflare
and future GitLab CI have separate evidence. Reading GitLab source does not verify
GitLab execution. Local workerd does not verify hosted CPU enforcement. A DO source
does not make its Container consumer containerless. An expected failing workflow
can pass its regression test without becoming a successful release.

## Publishing and updating

- Generate the plan; preserve the existing recipe's coverage boundaries.
- Link playable same-run footage and transcript only after assertions complete.
  Use a poster/link if the README renderer cannot play video inline.
- Bind the latest summary/badge to recipe, scenario, revision and environment;
  link immutable historical evidence underneath. A whole-repository green badge
  is not per-recipe hosted proof. Detect stale or broken assets.
- Keep failed recordings with their real outcomes. Never reconstruct successful
  footage, turn timer risk acceptance into health, or impersonate human approval.
- Redact before storing frames, telemetry or transcripts. Public README media
  must not expose private source, Slack channels, Access sessions or credentials.
- Video is explanatory evidence, not signed authorization to skip a check.
  Commit first; exact-commit attestation and its trust policy remain separate.

## Friday flywheel

Begin in an example with local discovery/checks; commit and verify; demonstrate
trusted reuse where actually supported; change Source without rewriting actions;
run a real progressive release; trigger a dedicated Worker error; observe a bounded
repair propose a verified PR. The complete scripted run may take ten minutes.
The three-minute presentation uses real checkpoints and disclosed recorded cuts.

Local marker creation has a real CLI regression. Safe automatic DAG concurrency,
hosted attestation consumption, full production HMD and Workers Issues-to-Flue repair must each pass
their own end-to-end proof before the script claims them. Never silently treat an
ordinary build/deployment as a reusable side-effect-free check.

# Recipe proof pages

Every recipe is a customer need, a runnable program, and an inspectable proof.
Use this shape for future work even before a recording exists. Do not fabricate
videos, measurements, verification badges, or a hosted result to fill the page.

## README shape

1. **What / why:** a customer-facing title, one focused question, and the benefit.
2. **Plan:** Mermaid generated from the actual definition. Existing plan checks
   detect drift; diagrams are not a substitute for execution.
3. **Run it:** setup, supported commands, expected result and intentional failure.
   Own fixtures/config/bindings. Import packages, not another example's host.
4. **Verification proof:** actual same-run video, transcript, immutable evidence
   and independently reported outcomes/timings per environment.
5. **Boundaries:** what remains unsupported, uncertain, shared-host-only or unverified.

Existing recipes retain their setup and historical evidence while the proof section
is filled in. A pending recording does not demote an already verified run. Conversely,
an existing green coverage cell does not imply a video or timing manifest exists.

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

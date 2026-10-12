# Clone public GitLab source

> How do I run the same `CI.Source` workflow against a pinned GitLab commit instead of a GitHub repository?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_verify_GitLab_source["verify GitLab source"]
  step_checkout --> step_verify_GitLab_source
```

The actions receive only `CI.Source` and a workspace. The hosted adapter uses the
existing Git runner with a public HTTPS GitLab URL, checks the exact fetched HEAD,
then checkpoints the checkout. A separate check restores it and reads `VERSION`.
There is no GitHub-specific source logic and no credential is provided to Git.
This is clone-only verification: it does not execute the external project's code,
initialize its submodules, run GitLab pipelines, or configure private GitLab auth.

The pinned fixture is GitLab's own [gitlab-test repository](https://gitlab.com/gitlab-org/gitlab-test),
commit [ddd0f15](https://gitlab.com/gitlab-org/gitlab-test/-/commit/ddd0f15ae83993f5cb66a927a28673882e99100b).
Its `VERSION` is `6.7.0.pre`. The public API was used to resolve that exact commit;
the workflow never fetches a mutable branch as its source identity. The included
`VERSION` file lets the unchanged check run locally, but is not GitLab clone proof.

```sh
pnpm cf-ci --workflow examples/gitlab-source/.cloudflare/ci/workflow.ts
```

After deploying the [example host](../../apps/example-runner) with `cf deploy`:

```sh
cf workflows instances create effect-ci-example-gitlab-source --body '{"instance_id":"my-gitlab-source-run","params":{"repository":"https://gitlab.com/gitlab-org/gitlab-test.git","revision":"ddd0f15ae83993f5cb66a927a28673882e99100b"}}'
```

The administrative lab accepts only that pinned public repository/revision. A
trusted host can supply another Git source provider without changing actions;
private GitLab credentials require a separate host-owned authentication design,
not reuse of the GitHub App token. No notification is sent by this example.

See [source providers](../source-providers), [R2](../r2-source), [Artifacts](../artifacts-source),
and [Durable Object source](../durable-object-source) for the other input boundaries.
Hosted `coverage-gitlab-source-20261012-1` completed a real GitLab HTTPS clone,
checkpoint `6a05adc1-7dc5-45e6-a278-bfb81948088d`, a downstream native exact-HEAD
assertion, and a separate `VERSION` read. Workflow version
`1f7a05b3-fabc-4602-b761-bf67c5982efb`, host deployment
`4d4e80ef-e00c-418b-9a4c-eaabad05956e`. This proves public pinned clone and
checkpoint restoration, not private GitLab authentication or external CI execution.
The local filesystem variant passed independently. PR118's exact-head full suite
also passed the Effect-on-GitHub plan/execute jobs for that portable fixture variant;
the real GitLab network clone proof remains the hosted run above.

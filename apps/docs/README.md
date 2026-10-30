# Documentation

Public site: https://effect-ci-docs.eclemmons.workers.dev

The Starlight site reads existing Markdown directly from the repository. Keep
recipe documentation beside its code in `examples/<recipe>/README.md`; service
documentation belongs in `apps/<service>/README.md`. No copied pages or generated
Markdown are committed.

The homepage is a static feature compatibility matrix. Rows and applicability
come from `examples/COVERAGE.md`; new example directories are included automatically.
Colors come from a completed GitHub check snapshot for one `main` commit. The
commit link and UTC capture time identify the evidence. The browser makes no
GitHub or readiness API requests, and the matrix works without JavaScript.

The Documentation GitHub workflow runs after the main recipe, monorepo, OIDC or
parallel-recipe workflow completes, including failed runs. It uses its read-only
GitHub token to paginate and deduplicate checks for that exact commit, excluding
its own documentation jobs. It waits up to 30 minutes for remaining checks. A
newer main commit, incomplete results or an API error prevents publication and
leaves the existing site in place. Completed failures still publish red results.
The existing Cloudflare authentication action obtains and revokes a short-lived
OIDC deployment token after the static build passes.

Green means the mapped check passed. Missing, skipped, cancelled and failed
checks stay red; not-applicable cells do not count toward progress. Local
Cloudflare runtime checks count as local, and only native `Cloudflare / <recipe>`
checks from the Effect CI App count as hosted. The page does not infer readiness
from historical coverage ticks.

The walkthrough comes from
`examples/demo/README.md` at `/walkthrough/`; `/examples/demo/` remains a compatibility route.
The API section groups solutions by API using the `CI.*` headings and link labels in
`examples/README.md`. Each group has a matching API page beside the SDK under
`packages/ci/`; its title matches the group and its method headings become links.
Each group starts with Usage, followed by Methods and Examples. Groups and entries
within Methods and Examples are alphabetical. Source examples are included from
their runnable files, including the local workspace/checkpoint example.
Recipes lists every remaining example alphabetically, including newly added
examples. Self-hosting and environment evidence belong in the API section.

From the repository root, run `pnpm docs:dev` to preview or `pnpm docs:build` to
build the static site. Output is in `apps/docs/dist/`. Local and PR builds reuse
`/readiness.json` from the published site, without GitHub credentials. Every
publication includes this static JSON alongside the HTML for future builds.

To collect a fresh snapshot manually, set `GITHUB_TOKEN` with read access to
contents and checks and `DOCS_READINESS_SHA` to a full main commit SHA, then run
`node apps/docs/scripts/snapshot.mjs --wait`. Build and publish that snapshot with
`DOCS_READINESS_SNAPSHOT=.cloudflare/state/readiness.json pnpm docs:deploy` from an
authenticated Cloudflare CLI session. An existing JSON snapshot can also be
provided through `DOCS_READINESS_SNAPSHOT`, relative to `apps/docs/` or absolute.
Queued or running checks are rejected.

The docs Worker serves static assets only and has no service bindings or secrets.
Disable independent Workers Builds push triggers; the Documentation workflow
owns publication after checks finish. The legacy trigger is parked on the unused
`codex/docs-builds-disabled` branch; its ID and filter remain in `builds.json` for
rollback. Do not push that branch. Restore its include filter to `main` only when
rolling back the publication migration.

[Continuous deployment settings](./builds.json "source")

[Snapshot collection](./scripts/snapshot.mjs "source")

[Deployment configuration](./cloudflare.config.ts "source")

## Include code from source

Write a standalone Markdown link with the title `"source"`. It remains a normal
clickable source link on GitHub; Starlight adds a highlighted snippet from the file.
Paths are relative to the README. For example, the actual site configuration is:

[Site configuration](./astro.config.mjs "source")

In a recipe README, write `[Workflow](./.cloudflare/ci/workflow.ts "source")` to
include that recipe's workflow.

To show one TypeScript declaration, append `#symbol=name` (or `#symbol=outer.inner`
for a nested declaration) to its path. To show one
top-level JSON property, append `#json=key`. Selection uses the source declaration
or JSON key, so moving code does not require updating line numbers. Missing files,
symbols, and keys fail the build. Shell commands and example output can remain
ordinary fences; executable code and configuration should link to their source.

For a real example, see the [exported action recipe](../../examples/exported-actions).
README edits and included source edits refresh the development site. Internal doc
links resolve to site pages; links to implementation files lead to GitHub.

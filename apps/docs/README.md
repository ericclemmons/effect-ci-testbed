# Documentation

Public site: https://effect-ci-docs.eclemmons.workers.dev

The Nimbus site reads existing Markdown directly from the repository. Keep
recipe documentation beside its code in `examples/<recipe>/README.md`; service
documentation belongs in `apps/<service>/README.md`. No copied pages or generated
Markdown are committed.

The presentation uses the [Nimbus starter](https://github.com/cloudflare/nimbus/tree/main/packages/nimbus-starter-source).
Its layouts, components, styles, and agent routes live in `src/`; the framework
is pinned to `@cloudflare/nimbus-docs` 0.19.2. `NIMBUS-LICENSE` retains its MIT
license. The site includes navigation filtering, Pagefind search, dark mode,
page copying, Markdown routes, and an `llms.txt` index. Keep the collocated loader
and repository Markdown transform when updating the starter. No CMS sync or
database is needed.

The loader resolves repository links and source snippets before Nimbus renders
them, so HTML, search, and Markdown exports share the same content. The committed
`nimbus.json` records the reviewed starter version; `.nimbus/` is a generated cache.

The homepage is an interactive "How it works" explainer. Pick where the graph runs
and what changed, and it replays the walkthrough's real output: cache hits,
Markdown-only skips, and the local approval gate. Scenarios live in
`src/explainer.mjs`. The default scenario is rendered into the HTML, so the page
works without JavaScript.

[Explainer scenarios](./src/explainer.mjs "source")

`/examples/features/` (`examples/FEATURES.md`) opens with "Is Effect CI ready
yet?": one red or green row per product feature. Each feature lists the recipes
that prove it and its walkthrough step. It stays red until one of its checks
passes in the snapshot, and turns red again when one fails. A feature with no
recipes, such as "Fast checks", stays red until a check proves it. A missing
walkthrough step shows "Not yet".

[Features](./src/features.mjs#symbol=features "source")

Below it is a static recipe compatibility matrix. Rows and applicability
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

Green ✓ means the mapped check passed; red × means a recorded failure, timeout
or required action. Missing, skipped, cancelled and neutral checks show a gray
em dash (—), because they do not establish success or failure. Not-applicable
cells also show an em dash and do not count toward progress. The columns are
GitHub Actions, Effect CI (local), Effect CI on GitHub Actions, and Effect CI on
Cloudflare. Local Cloudflare runtime checks count as Effect CI (local), and only
native `Cloudflare / <recipe>` checks from the Effect CI App count as Effect CI on
Cloudflare. The page does not infer readiness from historical coverage ticks. The
Effect CI on Cloudflare column reports evidence for that exact
commit, not whether a recipe is supported. For example, npm and pnpm workflows
can run remotely even when that snapshot has no matching native check. Checks
labeled `GitHub Actions / <recipe>` do not establish Cloudflare execution, even
when the Effect CI App publishes them.

The walkthrough comes from
`examples/demo/README.md` at `/walkthrough/`; `/examples/demo/` remains a compatibility route.
Navigation separates Getting started, Guides, Examples, Reference, and Development.
Guides covers GitHub, self-hosting, the ecosystem, and execution evidence. Examples
lists all recipes alphabetically, including newly added examples; the walkthrough
stays under Getting started.

Reference contains the SDK overview, CLI, and `CI.*` APIs. API groups come from the
`CI.*` headings in `examples/README.md`. Each group has a matching page beside the
SDK under `packages/ci/`; its title matches the group and its method headings
become direct links after Overview. APIs without methods link straight to their
page. API groups and methods are alphabetical.
Development contains repository wiring, package internals, and host services.
Source examples are included from their runnable files.

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
clickable source link on GitHub; Nimbus adds a highlighted snippet from the file.
Paths are relative to the README. For example, the actual site configuration is:

[Site configuration](./astro.config.mjs "source")

In a recipe README, write `[Workflow](./.cloudflare/ci/workflow.ts "source")` to
include that recipe's workflow.

Use an inline-code filename as the link label to show only the snippet on the
site, with that filename as its caption:
``[`vite.config.ts`](./path/to/cache.diff "source")``.
Diff files use highlighted `diff` syntax. GitHub still shows a source link.

To show one TypeScript declaration, append `#symbol=name` (or `#symbol=outer.inner`
for a nested declaration) to its path. To show one
top-level JSON property, append `#json=key`. Selection uses the source declaration
or JSON key, so moving code does not require updating line numbers. Missing files,
symbols, and keys fail the build. Shell commands and example output can remain
ordinary fences; executable code and configuration should link to their source.

For a real example, see the [exported action recipe](../../examples/exported-actions).
README edits and included source edits refresh the development site. Internal doc
links resolve to site pages; links to implementation files lead to GitHub.

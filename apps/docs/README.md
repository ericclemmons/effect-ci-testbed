# Documentation

Public site: https://effect-ci-docs.eclemmons.workers.dev

The Starlight site reads existing Markdown directly from the repository. Keep
recipe documentation beside its code in `examples/<recipe>/README.md`; service
documentation belongs in `apps/<service>/README.md`. No copied pages or generated
Markdown are committed.

The homepage is a live feature compatibility matrix. Rows and applicability come
from `examples/COVERAGE.md`; new example directories are included automatically.
Colors come from public GitHub check results for one resolved `main` commit,
loaded through the public docs Worker's `/api/readiness` endpoint. Its service
binding calls the existing CI host, which uses a short-lived GitHub App token
limited to reading this repository's contents and checks, then revokes it.
The host resolves one `main` commit and reads all check pages. The docs Worker
caches active runs for 30 seconds and completed runs for ten minutes at each
Cloudflare location. An empty check list also uses the active window. Active
results refresh automatically every 30 seconds while the page is visible;
refreshing keeps the current results visible. Concurrent reads in one
Worker isolate share a refresh. A failed refresh keeps the last successful result
for up to 24 hours, labels it as cached with its timestamp, and retries after ten
minutes. A cold cache with no successful read still reports checks unavailable.
Green means the mapped check passed;
amber hourglasses mean results are loading or the check is queued or running.
Missing, skipped, cancelled, and failed checks stay red. Not-applicable
cells do not count toward progress. Refresh reloads results; an API or rate-limit
error is shown explicitly when no cached result is available. Local Cloudflare runtime checks count as local, and
only native `Cloudflare / <recipe>` checks from the Effect CI App count as hosted.
The page does not infer current readiness from historical coverage ticks.

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
build the static site. Output is in `apps/docs/dist/`. Local dev and preview
proxy readiness reads to the public docs API.

Pushes to `main` build and publish this site through Cloudflare Workers Builds.
PRs build the docs in GitHub Actions without deployment credentials.

[Continuous deployment settings](./builds.json "source")

Publish manually with `pnpm docs:deploy` from an authenticated
Cloudflare CLI session. This builds the site, then deploys the static
assets and readiness API as the separate `effect-ci-docs` Worker. Deploy the CI
host's `DocsReadiness` export before deploying docs. The docs Worker has one
service binding and no secrets; the app's Access policies remain on its own hostname.

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

# Documentation

Public site: https://effect-ci-docs.eclemmons.workers.dev

The Starlight site reads existing Markdown directly from the repository. Keep
recipe documentation beside its code in `examples/<recipe>/README.md`; service
documentation belongs in `apps/<service>/README.md`. No copied pages or generated
Markdown are committed.

The homepage is a live feature compatibility matrix. Rows and applicability come
from `examples/COVERAGE.md`; new example directories are included automatically.
Colors come from public GitHub check results for one resolved `main` commit,
loaded in the browser with no credentials. Green means the mapped check passed;
amber hourglasses mean results are loading or the check is queued or running.
Missing, skipped, cancelled, and failed checks stay red. Not-applicable
cells do not count toward progress. Reloading the page reloads results; an API or
rate-limit error is shown explicitly. Local Cloudflare runtime checks count as local, and
only native `Cloudflare / <recipe>` checks from the Effect CI App count as hosted.
The page does not infer current readiness from historical coverage ticks.

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
build the static site. Output is in `apps/docs/dist/`.

Pushes to `main` build and publish this site through Cloudflare Workers Builds.
PRs build the docs in GitHub Actions without deployment credentials.

[Continuous deployment settings](./builds.json "source")

Publish manually with `pnpm docs:deploy` from an authenticated
Cloudflare CLI session. This builds the site, then deploys the static
assets as the separate `effect-ci-docs` Worker. It has no app bindings or secrets;
the app's Access policies remain on its own hostname.

[Deployment configuration](./cloudflare.config.ts "source")

## Include code from source

Write a standalone Markdown link with the title `"source"`. It remains a normal
clickable source link on GitHub; Starlight adds a highlighted snippet from the file.
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

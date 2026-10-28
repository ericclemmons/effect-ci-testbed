# Documentation

Public site: https://effect-ci-docs.ericclemmons.workers.dev

The Starlight site reads existing Markdown directly from the repository. Keep
recipe documentation beside its code in `examples/<recipe>/README.md`; service
documentation belongs in `apps/<service>/README.md`. No copied pages or generated
Markdown are committed. The homepage is a feature checklist. The walkthrough comes from
`examples/demo/README.md` at `/walkthrough/`; `/examples/demo/` remains a compatibility route.
Ecosystem pages link tools to their runnable examples. Other recipes follow the
examples guide. Self-hosting and environment evidence belong in Reference.

From the repository root, run `pnpm docs:dev` to preview or `pnpm docs:build` to
build the static site. Output is in `apps/docs/dist/`.

Pushes to `main` build and publish this site through Cloudflare Workers Builds.
PRs build and verify the docs in GitHub Actions without deployment credentials.

[Continuous deployment settings](./builds.json "source")

Publish manually with `pnpm docs:deploy` from an authenticated
Cloudflare CLI session. This builds and verifies the site, then deploys the static
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

To show one TypeScript declaration, append `#symbol=name` (or `#symbol=outer.inner`
for a nested declaration) to its path. To show one
top-level JSON property, append `#json=key`. Selection uses the source declaration
or JSON key, so moving code does not require updating line numbers. Missing files,
symbols, and keys fail the build. Shell commands and example output can remain
ordinary fences; executable code and configuration should link to their source.

For a real example, see the [exported action recipe](../../examples/exported-actions).
README edits and included source edits refresh the development site. Internal doc
links resolve to site pages; links to implementation files lead to GitHub.

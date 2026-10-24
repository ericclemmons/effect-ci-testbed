<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## How we work

Keep moving. Stop and ask at one-way doors: irreversible changes, destructive
operations, or decisions that need authority we do not have. Two-way doors swing
freely: make reversible changes, test them, and use the results to decide.

We are figuring out what actually works. Prefer a small working end-to-end proof
over polishing a speculative design. Once it works, we can work backwards to
make it more correct, secure, and general. Keep changes recoverable and state
what the evidence proves—and what it does not. Do not call a prototype production-ready.

This is permission to act within the task, not to expose secrets, bypass explicit
approval boundaries, silently spend an unapproved budget, or perform destructive
actions. If one path is blocked, keep working on the useful reversible work.

## Documentation

Keep READMEs beside their code; `apps/docs` reads them directly into Starlight.
Use standalone Markdown links with the title `"source"` for code examples instead
of copied code fences. Select declarations with `#symbol=name` or JSON properties
with `#json=key`. See `apps/docs/README.md` for the authoring convention.

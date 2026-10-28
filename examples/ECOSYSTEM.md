# Ecosystem

Keep the tools you already use. Start with [the walkthrough](./demo/README.md).

| Tool | Try it | Who owns what |
| --- | --- | --- |
| [npm](./node-npm) | Existing scripts and lockfile | npm installs; Effect CI invokes scripts. |
| [pnpm](./node-pnpm) | Existing scripts and lockfile | pnpm installs; Effect CI invokes scripts. |
| [Vite+](./vite-plus-cache) | Automatic task input/output tracking | Vite+ decides cache hits. Effect CI runs it and the host preserves its cache. |
| [Turborepo](./turborepo-cache) | Existing task graph and cache | Turbo owns dependencies and cache keys. No second graph to configure inside those commands. |
| [GitHub](./GITHUB.md) | Actions, native checks, deployment identity | Choose an entrypoint; keep the same project commands. |
| [GitLab](./gitlab-source) | Source checkout | Public pinned commits in the fixture; not a GitLab webhook/check integration. |
| [Cloudflare](./cloudflare-runner) | Remote runner | The host owns compute, identity, and persistent cache policy. |
| [Blacksmith](./blacksmith) | Runner adapter | Requires provider configuration; see the recipe's evidence. |

## Caching has separate owners

| Reuse | Owner | Avoids |
| --- | --- | --- |
| Dependency downloads | Package manager and host cache policy | Downloading the same packages; the locked install still runs. |
| Task outputs | Vite+ or Turbo | Recomputing work with unchanged inputs. |
| Signed check results | Trusted Effect CI host | Repeating an eligible check for the exact same commit. |

`--remote` changes execution location. It does **not** enable a task cache,
enroll a repository, or make local results trusted.

[Vite+ automatic data tracking](https://viteplus.dev/guide/automatic-data-tracking)
can remove hand-written input/output globs for cache-enabled tasks. Arbitrary
commands still need explicit environment-variable tracking when it affects results.

[Vercel CI](https://vercel.com/blog/introducing-vercel-ci) uses Turbo's task graph
and cache, then schedules uncached tasks on separate machines. Turbo's graph and
cache are not the hosted scheduler. Effect CI does not claim that scheduling or
Vercel's reported speedups.

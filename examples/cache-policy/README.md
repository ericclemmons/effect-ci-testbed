# Customize or disable a reusable cache

This example answers one question:

> How do I declare a custom cache once without putting platform storage details in my actions?

The portable workflow owns only cache intent:

```ts
CI.workflow("cache-policy", workflow, {
  cache: {
    key: "custom-build-cache",
    keyFiles: ["examples/cache-policy/app/src/input.txt"],
    paths: ["examples/cache-policy/app/.cache/build"],
  },
})
```

Paths and invalidating files are repository-relative. The GitHub runner translates
the policy to `actions/cache`; the Cloudflare runner translates it to a snapshot-backed
directory cache. Local execution simply uses the directory already present in the
working tree. Set `EFFECT_CI_DISABLE_CACHE=1` to make the same workflow declare
`cache: false`.

The fixture is intentionally dependency-free: `build.ts` reads one input, reuses or
creates one cached output, and `build.test.ts` verifies the result with Node's built-in
test runner. There is no nested package installation or JavaScript runtime shim.

Compare:

- [plain GitHub Actions with explicit `actions/cache`](./.github/workflows/github.yml)
- [Effect CI on GitHub](./.github/workflows/effect-on-github.yml), where the reusable
  runner reads the policy from the workflow
- [the portable workflow](./.cloudflare/ci/workflow.ts)

Run it twice locally to see a miss followed by a hit:

```sh
./examples/cache-policy/.cloudflare/ci/workflow.ts
./examples/cache-policy/.cloudflare/ci/workflow.ts
```

Cache retention remains runner policy. GitHub configures it at repository or
organization level rather than per `actions/cache` entry, so Effect CI does not expose
a misleading per-workflow retention option.

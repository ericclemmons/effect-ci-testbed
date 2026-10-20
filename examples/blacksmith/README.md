# Run CI on Blacksmith

Use Blacksmith's compute with the same workflow you run locally.

The [GitHub caller](./.github/workflows/effect-on-github.yml) passes
`blacksmith-2vcpu-ubuntu-2404` to the reusable runner. No provider-specific code
goes into the [Effect workflow](./.cloudflare/ci/workflow.ts).

## Try it

```sh
pnpm exec cf-ci run --workflow examples/blacksmith/.cloudflare/ci/workflow.ts
```

For hosted execution, enable Blacksmith for your organization and repository,
then place the comparison workflow in the repository-root `.github/workflows`.
See [Blacksmith setup](https://docs.blacksmith.sh/introduction/quickstart).

This testbed has not run the example on Blacksmith. The local command needs no
Blacksmith account.

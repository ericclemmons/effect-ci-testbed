# Fan one prepared workspace out to isolated checks

This example answers one question:

> How can parallel checks start from the same prepared filesystem without mutating each other?

The actions express only their real dependency:

```ts
export const left = CI.action("left", () => function* () {
  const workspace = yield* prepare()

  return yield* workspace.exec("...")
})
```

The workflow runs `left()` and `right()` with `CI.parallel`. `prepare()` executes once
and returns a durable workspace revision. On Cloudflare, each consuming action restores
that same snapshot into a Container selected by the action ID. The two checks both
write `branch.txt`, sleep, and assert their own value remains; they would race and fail
if they shared a filesystem.

[The conventional GitHub version](./.github/workflows/github.yml) expresses the same
shape with a prepared artifact and two matrix jobs. Effect CI does not need an artifact
manifest because the workspace revision is the dependency value.

Run the Cloudflare-shaped path locally with Docker and Wrangler:

```sh
pnpm dev

pnpm exec wrangler workflows trigger effect-ci-snapshot-fanout \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --local
```

The ordinary in-process local runner deliberately does not promise filesystem
isolation. This example uses the Cloudflare local runtime because isolated Containers
are the behavior under test. A future local snapshot runner can provide the same
capability without changing these actions.

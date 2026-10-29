# Self-host environment contract

Companion to [SELF-HOST.md](./SELF-HOST.md). Source baseline: `adebaca`, reviewed 2026-10-28.
This documents an adoption path, not installed integration or deployment proof.
Schema, dependencies, package commands, and provisioning remain unchanged.

## Current behavior and the safety boundary

[Current package commands](./package.json)

- `pnpm run setup` discovers host settings and may create credentials; `pnpm run deploy` reconciles Access, prepares the standalone runtime, then deploys.
- Build/dev/deploy currently load `.deploy.env`, then `.env.production` through Node; `pnpm run cf` requires `.env.production`. They do not invoke Varlock.
- [Node env-file loading](https://nodejs.org/api/cli.html#--env-filefile) parses dotenv values, not provider expressions. An `op(...)` or `keeper(...)` value remains a string, not a fetched secret.
- `setup.ts` separately calls `parseEnv`, merges file settings over `process.env`, and appends plaintext API/Access credentials with mode `0600`. Even wrapping setup in Varlock does not fix that file reread. Do not run setup after authoring provider references.
- `deploy.ts` serializes allowlisted `process.env` entries into a temporary `0600` secrets file. It does not resolve or reject provider expressions. Without resolve-first loading, those strings can become Worker secrets.

[Setup implementation](./scripts/setup.ts)

[Deploy implementation](./scripts/deploy.ts)

## File ownership

These are the intended roles when adopting Varlock; this app currently has neither `.env.schema` nor a committed `.env`.

| File | Contents and owner |
| --- | --- |
| `.env` | Committed public URLs and shared settings only, maintained by the host/project owner. No tokens, private keys, credential-bearing webhook URLs, or resolver bootstrap credentials. |
| `.env.production` | Ignored host/account choices: `CLOUDFLARE_ACCOUNT_ID`, `EFFECT_CI_PUBLIC_URL`, `EFFECT_CI_PROFILE=standalone`, Worker name, project root, reviewers, and optional Access service-token ID. Keep private reviewer identities here. For the provider path, no plaintext secrets. |
| `.env.schema` | Committed, validated contract: names, descriptions, types, requiredness, sensitivity, and provider references; never secret values. Include public keys too so their types are checked. |

[Host setting names](./deploy.example.env)

[Worker secret allowlist and optional features](./secrets.example.env)

[Host profile selection](./host-profile.ts)

Use the [schema guide](https://varlock.dev/guides/schema/) for `@required`, `@sensitive`, and `@type` annotations.
Require the enabled features' credentials, including the independent API token and GitHub App credentials for webhook CI; keep optional Slack/OIDC requirements conditional.
Validate the public origin as a URL and the profile as an enum; do not mark secret-bearing notification URLs public.

[Environment precedence](https://varlock.dev/guides/environments/) is schema → `.env` → `.env.local` → `.env.production` → `.env.production.local`, followed by process overrides.
Varlock discourages generic `.env`; retaining it here is an explicit public-defaults convention, not its recommended layout.
Set `@currentEnv=$APP_ENV` and declare `APP_ENV` in the schema; select production explicitly, rather than relying on detection.
Audit local files and ambient overrides for stale account choices, plaintext values, or unresolved references before deployment.

## Concrete provider: 1Password service account

Follow the official [installation](https://varlock.dev/getting-started/installation/), [plugin installation](https://varlock.dev/guides/plugins/), and [1Password plugin](https://varlock.dev/plugins/1password/) guides.
Having `.env.schema` does not install Varlock. The plugin guide requires a local plugin dependency in JS projects; a versioned decorator is not a substitute here, despite the provider page's broader standalone-install wording.
Neither Varlock nor its plugin is a repository dependency today. Arrange a separately approved CLI/plugin installation before using the commands below; none is performed by this task.

1. Create a dedicated `effect-ci-production` vault and an `effect-ci-host` item with fields named for the credentials in the Worker allowlist. Store the PEM intact, preserving newlines.
2. Create a [1Password service account](https://www.1password.dev/service-accounts/get-started) with read access only to that vault. Supply its bootstrap token as `OP_TOKEN` through an approved secret-injection mechanism, never committed files, shell literals, or agent transcripts.
3. In the schema header, load `@varlock/1password-plugin` with `@plugin(...)` and initialize `@initOp(token=$OP_TOKEN, allowAppAuth=false)`. Declare `OP_TOKEN` with `@type=opServiceAccountToken`, `@required`, `@sensitive`, and `@internal`.
4. Mark each Worker credential required/sensitive as appropriate. For example, give `EFFECT_CI_API_TOKEN` the resolver `op(op://effect-ci-production/effect-ci-host/EFFECT_CI_API_TOKEN)`; copy each field's actual Secret Reference for the other keys.
5. Keep operator Cloudflare credentials separate from Worker credentials. Declare any needed operator token sensitive but not internal if `cf` needs it in its child environment. Keep `OP_TOKEN` internal; do not upload it to the Worker.

[Keeper](https://varlock.dev/plugins/keeper/) is an alternative: approve its plugin, create a Secrets Manager application, share only the required folder, initialize a device, and securely inject its exported base64 config as `KSM_CONFIG`.
Use `@initKeeper(token=$KSM_CONFIG)`, an internal/sensitive `keeperSmToken` bootstrap item, and `keeper()` field references. Base64 is not encryption; the one-time enrollment token is not the reusable config.

## Resolve first, then use the existing deploy implementation

For this path, author host settings once from the setting source above; obtain any Access service-token ID/credentials through separately approved provisioning and store credentials in the provider.
Do not use setup to populate or refresh provider-backed files. Keep an existing working installation unchanged until its credentials are safely transferred.

After the prerequisites above, run from `apps/effect-ci`, with dependencies already installed and the approved Cloudflare identity available:

```sh
APP_ENV=production varlock load --agent
APP_ENV=production varlock run --inject vars -- pnpm exec node scripts/deploy.ts --dry-run
APP_ENV=production varlock run --inject vars -- pnpm exec node scripts/deploy.ts
```

These are conditional operator commands, not commands executed or verified here. The final command changes Access and deploys resources; it requires destination and budget approval.
The [load/run contract](https://varlock.dev/reference/cli/load-and-run/) validates/resolves before starting the child; failures prevent execution. `--agent` redacts validation output; `--inject vars` avoids the serialized Varlock graph and strips internal bootstrap items.
Calling the script directly avoids the package commands' extra dotenv loading. `pnpm exec` supplies the local `cf` binary on PATH.
Do not export resolved dotenv/JSON to disk or logs, use `eval`, or supply your own `--secrets-file`; let the existing allowlist own upload.
The wrapper still briefly writes resolved secrets to a private temporary file and removes it in `finally`; this is not disk-free secret delivery.
Dry-run skips Access API writes but still prepares runtime artifacts and invokes `cf deploy --dry-run`; it proves neither account readiness nor hosted behavior.
Access reconciliation happens before deployment; a later failure does not roll back Access changes. Check the actual host after an approved deployment.

## Direct `cf deploy`: future integration, not today's host path

[Cloudflare configuration and current Access limitation](./cloudflare.config.ts)

[Standalone runtime preparation](./scripts/standalone-runtime.ts)

Baseline: landed `adebaca`; no unlanded runtime changes are included here. This call diff shows the proposed resolve-first operator path using existing APIs, not new native hooks:

```diff
- package commands → node --env-file … scripts/deploy.ts
+ operator → Varlock CLI validation/resolution → pnpm exec node scripts/deploy.ts
  accessApplications(options) → accessCommand(args: ReadonlyArray<string>)
    → Access create/update → service audience returned to process.env
  prepareStandaloneRuntime() → allowlisted private temporary secret file
    → spawnSync(cf, ["deploy", ...args]) → deployment status
    → finally: remove temporary secret directory, even on failure
```

The desired future native lifecycle would move Access reconciliation, audience handoff, runtime packaging, and allowlisted secret upload out of `deploy.ts` into supported `cf deploy` integration. That API is not implemented or specified here; failures must still clean secrets and must not imply that Access changes were rolled back.

Exact blockers: no Varlock dependency/schema or native resolver hook; `cf/config` does not expose this host's Access resources; bare deployment bypasses runtime preparation and the Worker secret allowlist.
`varlock run -- cf deploy` only supplies process variables: it does not reproduce those missing host steps or make process variables Worker bindings.
Retain the deploy wrapper until those contracts are implemented and verified. `.deploy.env` remains a legacy input; this guide does not use it or remove its ignore rule.

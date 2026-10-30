# Self-host files and credentials

Run these steps in `apps/effect-ci`. Varlock and the 1Password plugin are installed
by `pnpm install`. CF CLI is [installed globally](https://developers.cloudflare.com/cf/get-started/#install-cf).

## Files

| File | What goes in it |
| --- | --- |
| `.env.production` | Account ID, host URL, GitHub App ID, Access issuer/audience, numeric owner ID. Copy `.env.production.example` and fill it in. Ignored by Git. |
| `.env.schema` | Committed types and 1Password references. Defaults `NODE_ENV` to production; an existing `NODE_ENV` overrides it. No `APP_ENV` variable. |
| `.env.production.local` | Only the 1Password bootstrap credential: `OP_TOKEN=<service-account-token>`. Ignored by Git; enter it yourself, not in an agent transcript. |
| `secrets.env` | Committed list of Worker bindings, each referring to its resolved environment variable. No credential values. |
| Your app's `.env` | Public `EFFECT_CI_REMOTE_URL=https://<host>`. Commit it; do not create a GitHub secret for it. |

## Set up 1Password

1. Create a vault named `effect-ci-production` and an item named `host`.
2. Add these fields to the item:

   | Field | Value |
   | --- | --- |
   | `GITHUB_PRIVATE_KEY` | Complete downloaded GitHub App PEM, preserving newlines. |
   | `GITHUB_WEBHOOK_SECRET` | The same random secret entered in the GitHub App. |
   | `EFFECT_CI_API_TOKEN` | A new 64-character random password. This is a host API credential, not a Cloudflare API token. |
   | `RECEIPT_SIGNING_KEY` | Another new 64-character random password. |
   | `CLOUDFLARE_TOKEN_ISSUER` | Optional: the account token created in the guide's deployment-credentials section. |
   | `CLOUDFLARE_API_TOKEN` | Host-only deployment credential for this repository's automatic main deployment. |
   | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Credentials for the connected Slack App. |

   In `.env.production`, use `op(op://effect-ci-production/host/<field>)` for these
   additional secret fields. Fill in the Slack App/team/channel/approver IDs and
   `EFFECT_CI_DETAILS_URL` there too. The schema marks these integration settings
   optional so reduced installations remain compatible; configure them for the
   complete host.

3. Create a [1Password service account](https://www.1password.dev/service-accounts/get-started)
   with read access to this vault only. Put its token in `.env.production.local` as `OP_TOKEN`.
4. Restrict the local files:

   ```sh
   chmod 600 .env.production .env.production.local
   ```

5. Check that the schema references match each field's **Copy Secret Reference** value.
   If you use different vault/item names, edit those references:

   [`.env.schema`](./.env.schema "source")

6. Validate without printing secrets:

   ```sh
   pnpm exec varlock load --agent
   ```

   `OP_TOKEN` is internal: Varlock uses it but does not pass it to `cf`.
   A missing or invalid required value stops deployment before the command starts.

## Deploy the resolved values

[Worker secret manifest](./secrets.env "source")

```sh
pnpm exec varlock run --inject vars -- cf deploy --secrets-file secrets.env
```

Varlock resolves the provider references. CF uploads only the keys listed in
`secrets.env`; it does not upload `OP_TOKEN`. `CLOUDFLARE_API_TOKEN` is now an
explicit host binding for automatic main deployment: supply the intended
host deployment token, never an inherited operator token.
Keep `$NAME` references in this file, not `op(...)` expressions or resolved secrets.
No generated secrets file or custom deployment script is needed.

[Varlock 1Password syntax](https://varlock.dev/plugins/1password/)
· [Environment selection](https://varlock.dev/guides/environments/)
· [CF deployment options](https://developers.cloudflare.com/cf/projects/#deploy)

To use [Keeper](https://varlock.dev/plugins/keeper/) instead, install
`@varlock/keeper-plugin`, replace the plugin/initializer with `@initKeeper(token=$KSM_CONFIG)`,
and use `keeper()` field references. Keep its reusable Secrets Manager config
internal and in `.env.production.local`; the one-time enrollment token is not that config.

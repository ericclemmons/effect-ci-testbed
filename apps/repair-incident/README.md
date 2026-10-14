# Owned failure signal

Private, standalone deterministic failure source for the Friday incident loop. No public URL, secrets, AI, GitHub, repair writer, arbitrary prompt, or deployment binding. An authenticated native Workflow may inspect or emit ONE owned error. A SQLite claim precedes `console.error(new Error(...))`; completed calls replay the same 500 receipt without logging again. Pending/uncertain state fails closed and has no reset API. The private RPC returns an actual 500 Response; ordinary HTTP remains 404.

`observability.issues.enabled` is explicitly configured. [Cloudflare Issues](https://developers.cloudflare.com/workers/observability/issues/) documents handled error logging and 5xx detection. A completed emission is NOT proof that an Issue was ingested, that a Notification was delivered, or that a repair happened. `issueVerified:false` remains explicit until independent native evidence exists.

This app owns its fixture; it does not import private repository code or claim source parity with its repair target. The fixed safe message contains no incoming request or account context. Full source/version-to-private-base enrollment is still required before any paid event-triggered repair.

Local checks: `node --test src/*.test.ts` and `pnpm check`. Native deployment/emission/Issue lookup, authenticated Generic Webhook receiver/dedupe, and ordered Flue-to-verified-PR proof are pending. Never label a synthetic Notifications test or a local workerd error as a real native Issue.

Deployment may precede the receiver, but do not invoke `emit-once` until the authenticated destination, fixed-service Issue automation and bounded receiver are ready. `inspect` emits no error. The single durable emission has no reset route; rehearsals must read its evidence rather than pretending replays are new incidents. Returning a cached 500 may itself create another platform occurrence even though the application does not log again, so replay is not an occurrence-deduplication guarantee. Receiver deduplication remains a separate prerequisite.

# Effect logs in Workers Observability

Both hosted `workflowEntrypoint` adapters install one Effect logger that writes
structured records to native `console.info`, `warn`, `error`, or `debug`.
`Effect.logInfo`, `logWarning`, and `logError` therefore appear in Workers Logs
when the deploying app enables observability. Records carry `source: effect-ci`,
workflow/instance identity, action step, actual native attempt, timestamp, message,
and bounded cause details. This is an Effect Layer, not another logging transport.

The app configs enable observability and redact request query strings. A
`headSamplingRate` of 1 is a request, **not an ingestion/completeness guarantee**.
Native retries have warning records; terminal workflow failures have error records
and still throw their original errors, including `NonRetryableError`. Logging
failure does not change execution. Native platform invocation errors remain
available independently of this logger.

Host secrets identified by token/secret/private-key/password environment keys and
Effect `Redacted` values are masked. Sensitive object keys and capability query
values are masked too. Serialization bounds depth, entry count and string length,
does not invoke getters, and never forwards environment/event payloads or raw
container stdout/stderr automatically. This is not a guarantee for secrets a user
explicitly unwraps, arbitrary direct `console` calls, or unknown credentials.
Do not log them. The release token remains only in the release-manager Worker.

Logs and retry attempts are diagnostics, **not independent health trials**.
HMD Worker health uses version/window-bound native invocation outcomes; Workflow
SLIs count logical terminal outcomes, not intermediate lifecycle/error log rows.

The administrative `effect-ci-probe-observability` Workflow logs info/warning/
handled-error records, fails its first action attempt, and succeeds its second.
`effect-ci-probe-observability-terminal` throws a nonretryable error despite a
configured retry limit of 10. Neither posts Slack notifications. Unit tests verify
context inheritance into native retry fibers, levels, redaction, and error identity.
Live WOBS verification must separately inspect actual persisted records; these
unit tests alone do not prove collection.

References: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

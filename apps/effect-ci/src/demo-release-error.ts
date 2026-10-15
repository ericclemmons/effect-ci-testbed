/** Translate only the fixed broker protocol; never forward arbitrary RPC error text/cause. */
export function demoReleaseError(cause: unknown): Error {
  const descriptor = cause && typeof cause === "object"
    ? Object.getOwnPropertyDescriptor(cause, "message") : undefined;
  const message = descriptor && "value" in descriptor && typeof descriptor.value === "string"
    && descriptor.value.length <= 512 ? descriptor.value : "";
  const match = /^Candidate upload uncertain or rejected \((upload|readback|identity|allocation)(?:, HTTP ([1-5][0-9]{2}))?(?:, version ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?\); reconcile the pending identity, never retry automatically$/.exec(message);
  const stage = match?.[1] ?? (message === "Prepared release identity mismatch" ? "receipt" : "broker");
  return new Error(`Release preparation failed (stage=${stage}${match?.[2] ? `, HTTP ${match[2]}` : ""}${match?.[3] ? `, version ${match[3]}` : ""}); inspect the retained run and reconcile any pending candidate; never retry automatically`);
}

/** Publication has no upload-version protocol to expose; keep its failure boundary explicit. */
export function demoPublicationError(): Error {
  return new Error("Demo publication failed (stage=publication); inspect the retained run and immutable publication before retrying; RPC details redacted");
}

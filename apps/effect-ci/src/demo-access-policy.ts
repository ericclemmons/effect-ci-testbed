// Host-owned enrollment from independently verified existing Access metadata.
// Identity is an opaque subject digest, not an email, token or project input.
export const demoAccessOrigin = "https://effect-ci-github-cloudflare.eclemmons.workers.dev";
export const demoAccessIdentity = Object.freeze({
  "issuer": "https://cf-eric-clemmons.cloudflareaccess.com",
  "audience": "1bc63bdc2181bb26df716137628c79aa94ff4d118082e57aabfb56fec698614e",
  "subjectSha256": "ce7429e49077cc0d5d10440bb7be389ada729414ebad93c665a21b83c52fc3e3"
});

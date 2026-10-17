// Host-owned enrollment from independently verified existing Access metadata.
// Identity is an opaque subject digest, not an email, token or project input.
export const demoAccessOrigin = "https://effect-ci-github-cloudflare.ericclemmons.workers.dev";
export const demoAccessIdentity = Object.freeze({
  "issuer": "https://ericclemmons.cloudflareaccess.com",
  "audience": "bce76113a4e842f5fb81228d5f8770f0d19e73aa1dcf5856acfb6aa23d696f19",
  "subjectSha256": "128b79e41b705ec8ec8798147a07c3d9953053b7587a57bcb4fbe87eb61d7937"
});

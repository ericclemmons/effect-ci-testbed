# Containerless site: recorded proof

Built source: `cf6dd38f2cbb6e89840fb7dc75b6ee681c5eb3c0`.
Recorder: `121ea93e58c3773bafa02faa25e68b13eb2d6f2c`.
Native instance: `coverage-containerless-site-20261013-1`.
Browser run: `01a1378d-b462-706c-af76-b1367127a683`.

Agent-authored summary of actual assertions, not a verbatim trace or CLI/dashboard
recording. Capture occurred after the existing native build; no redispatch,
rebuild, deployment or model call.

1. Open the immutable public site URL for the built commit.
2. Assert heading “CI without the container” is visible.
3. Click “Count: 0”; assert “Count: 1”; capture its screenshot.
4. Click “Count: 1”; assert “Count: 2”; capture its screenshot.
5. Successful settlement, one attempt, complete cleanup, no secondary errors.

Original 960×540 VP8 WebM: 1.60 seconds / 40 decoded frames. Film includes blank
startup and visibly reaches Count1. Final assertion and unaltered PNG show Count2;
that last update is not in the video before cleanup. The film is not reconstructed.

Codex reviewed all 20 distinct decoded frames and the final screenshot: owned
public site only, no account/private pages observed. Framework video redaction
is incomplete; original quarantine/review fields remain unchanged. This is not
human approval, general privacy certification, signed attestation or cache authority.

Native original: queue 2,671 ms, execution 1,675 ms, isolated build 37 ms,
total 4,346 ms. Replay: queue 2,014 ms, execution 627 ms, isolated build 48 ms,
total 2,641 ms. One sample each; cache/cold-warm unknown, not a benchmark.

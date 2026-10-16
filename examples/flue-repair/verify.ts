import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Read-only playback validation of the original real run, NOT an agent dispatch.
// The live regressions assert model reservation identity, native attempts,
// exact candidate commit, check-before-PR ordering and the one-file patch.
const root = fileURLToPath(new URL("../../", import.meta.url));
const cf = fileURLToPath(
  new URL("../../apps/effect-ci/node_modules/.bin/cf", import.meta.url),
);
for (const [file, enrollment] of [
  [
    "apps/repair-agent/src/live-proposal.test.ts",
    { LIVE_FLUE_INSTANCE: "coverage-flue-proposal-20261014-1" },
  ],
  [
    "apps/effect-ci/src/live-repair-writer.test.ts",
    {
      LIVE_NATIVE_WRITER_INSTANCE: "coverage-native-repair-proposal-20261014-1",
    },
  ],
] as const) {
  execFileSync(process.execPath, ["--test", file], {
    cwd: root,
    env: { ...process.env, ...enrollment, CF_BIN: cf },
    stdio: "inherit",
    timeout: 180_000,
  });
}
console.log(
  "Verified original Flue proposal → exact-commit native check → proposed PR.",
);
console.log(
  "https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/2",
);
console.log(
  "Read-only: no inference, redispatch, GitHub write, merge or deployment.",
);

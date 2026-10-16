import { expect, it } from "vite-plus/test";

it("keeps failed test diagnostics in the Slack step reply", () => {
  globalThis.console.log("SLACK_OUTPUT_STDOUT: expected and received values follow");
  globalThis.console.error("SLACK_OUTPUT_STDERR: this owned assertion deliberately fails");
  expect("actual demo value").toBe("expected demo value");
});

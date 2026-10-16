import { expect, it } from "vite-plus/test";

it("preserves readable assertion output in the owned Slack preview", () => {
  globalThis.console.log("SLACK_READABLE_STDOUT\n  indentation stays visible");
  globalThis.console.error("SLACK_READABLE_STDERR\n  source details stay in Slack");
  expect({ release: "preview", result: "actual" }).toEqual({
    release: "preview",
    result: "expected",
  });
});

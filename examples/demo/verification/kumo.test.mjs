import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@cloudflare/kumo/components/button";

test("the genuine static Kumo button works without forbidden inline style attributes", () => {
  const markup = renderToStaticMarkup(createElement(Button,
    { id: "show", type: "button", variant: "secondary" }, "Test JavaScript"));
  assert.match(markup, /data-kumo-component="Button"/);
  assert.match(markup, /text-kumo-default/);
  assert.ok(!/\sstyle=/.test(markup));
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /variant: "secondary"/);
  assert.match(config, /must not require CSP-blocked style attributes/);
});

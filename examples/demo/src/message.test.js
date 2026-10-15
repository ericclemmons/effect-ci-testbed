import { expect, it } from "vite-plus/test";
import { message } from "./message.js";

it("exports a non-empty message", () => {
  expect(typeof message).toBe("string");
  expect(message.trim().length).toBeGreaterThan(0);
});

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { message } from "../src/message";

test("shows the generated build message", async ({ app, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("heading", "Release preview")).toBeVisible();
  await expect(screen.getByText(message)).toBeVisible();
  await screen.getByRole("button", "Test JavaScript").click();
  await expect(screen.getByRole("status")).toHaveText("JavaScript is working in this build.");
});

import { Button } from "@cloudflare/kumo/components/button";
import kumoStyles from "@cloudflare/kumo/styles/standalone?inline";
import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { message } from "./message";

// Keep the stylesheet in the checked JavaScript: no CDN or extra deployment artifact.
const style = document.createElement("style");
style.textContent = kumoStyles;
document.head.prepend(style);

function BrowserCheck() {
  const [tested, setTested] = useState(false);
  return h(
    "section",
    { className: "browser-check", "aria-labelledby": "browser-label" },
    h(
      "div",
      null,
      h("h2", { id: "browser-label" }, "Browser check"),
      h(
        "p",
        { id: "interaction", role: "status", "aria-live": "polite" },
        tested ? "JavaScript is working in this build." : "Ready to test this page's browser code.",
      ),
    ),
    h(
      Button,
      { id: "show", variant: "primary", onClick: () => setTested(true) },
      "Test JavaScript",
    ),
  );
}

const output = document.querySelector<HTMLParagraphElement>("#message");
const controls = document.querySelector<HTMLElement>("#browser-check");
if (!output || !controls) throw new Error("Demo controls are missing");
output.textContent = message;
createRoot(controls).render(h(BrowserCheck));

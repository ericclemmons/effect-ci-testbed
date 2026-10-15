import { message } from "./message";

const button = document.querySelector<HTMLButtonElement>("#show");
const output = document.querySelector<HTMLParagraphElement>("#message");

if (!button || !output) throw new Error("Demo controls are missing");

button.addEventListener("click", () => {
  output.textContent = message;
});

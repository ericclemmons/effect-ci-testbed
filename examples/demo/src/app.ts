import { message } from "./message";
const button = document.querySelector<HTMLButtonElement>("#show");
const output = document.querySelector<HTMLParagraphElement>("#message");
const interaction = document.querySelector<HTMLParagraphElement>("#interaction");
if (!button || !output || !interaction) throw new Error("Demo controls are missing");
output.textContent = message;
button.addEventListener("click", () => {
  interaction.textContent = "JavaScript is working in this build.";
});

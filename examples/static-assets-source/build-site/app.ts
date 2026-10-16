const button = document.querySelector<HTMLButtonElement>("button");
const result = document.querySelector<HTMLParagraphElement>("#result");
const message: string = "Compiled TypeScript is running in your browser.";

button?.addEventListener("click", () => {
  if (result) result.textContent = message;
  if (button) button.textContent = "Browser code verified";
});

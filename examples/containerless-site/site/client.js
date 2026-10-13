let count = 0;
document.querySelector("#counter").addEventListener("click", (event) => {
  event.currentTarget.textContent = `Count: ${++count}`;
});

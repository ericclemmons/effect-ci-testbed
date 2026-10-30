import { catalog, formatPrice } from "@turbo-ci/core"

const storefront = document.querySelector<HTMLElement>("#app")
if (!storefront) throw Error("Storefront root is missing")

storefront.innerHTML = `
  <h1>Storefront</h1>
  <ul>${catalog.map(product => `
    <li>
      <strong>${product.name}</strong> — ${formatPrice(product.priceCents)}
      <button data-product="${product.id}">Add to cart</button>
    </li>`).join("")}</ul>
  <p id="total">Cart: ${formatPrice(0)}</p>
`

let totalCents = 0
storefront.addEventListener("click", event => {
  const button = event.target
  if (!(button instanceof HTMLButtonElement)) return
  const product = catalog.find(item => item.id === button.dataset.product)
  if (!product) return
  totalCents += product.priceCents
  document.querySelector("#total")!.textContent = `Cart: ${formatPrice(totalCents)}`
})

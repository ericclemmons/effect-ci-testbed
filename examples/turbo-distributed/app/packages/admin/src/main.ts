import { catalog, formatPrice, inventoryValue } from "@turbo-ci/core"

const dashboard = document.querySelector<HTMLElement>("#app")
if (!dashboard) throw Error("Dashboard root is missing")

dashboard.innerHTML = `
  <h1>Inventory dashboard</h1>
  <table>
    <thead><tr><th>Product</th><th>Stock</th><th>Value</th></tr></thead>
    <tbody>${catalog.map(product => `
      <tr>
        <td>${product.name}</td><td>${product.stock}</td>
        <td>${formatPrice(product.priceCents * product.stock)}</td>
      </tr>`).join("")}</tbody>
  </table>
  <p>Total inventory: ${formatPrice(inventoryValue(catalog))}</p>
`

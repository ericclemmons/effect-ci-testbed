export interface Product {
  readonly id: string
  readonly name: string
  readonly priceCents: number
  readonly stock: number
}

export const catalog: ReadonlyArray<Product> = [
  { id: "shirt", name: "T-shirt", priceCents: 2400, stock: 18 },
  { id: "cap", name: "Cap", priceCents: 1600, stock: 12 },
  { id: "bag", name: "Tote bag", priceCents: 1200, stock: 25 },
]

export const formatPrice = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)

export const inventoryValue = (products: ReadonlyArray<Product>): number =>
  products.reduce((total, product) => total + product.priceCents * product.stock, 0)

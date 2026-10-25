import assert from "node:assert/strict"

const [locale, currency] = process.argv.slice(2)
const expected = {
  "en-US USD": "$1,234.50",
  "en-US EUR": "€1,234.50",
  "de-DE USD": "1.234,50\u00a0$",
  "de-DE EUR": "1.234,50\u00a0€",
}
const key = `${locale} ${currency}`
assert.ok(Object.hasOwn(expected, key), `Unknown combination: ${key}`)
assert.notEqual(process.env.FAIL_COMBINATION, key, "Intentional matrix failure")
assert.equal(new Intl.NumberFormat(locale, { style: "currency", currency }).format(1234.5), expected[key])
console.log(`PASS ${key}`)

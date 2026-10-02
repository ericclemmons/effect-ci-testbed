import isNumber from "is-number"

if (!isNumber("42")) {
  throw new Error("Expected the installed dependency to recognize a number")
}

console.log("installed dependency is available")

# Put inspectable conditions in a workflow plan

This example answers one question:

> How do I deploy only for a push to `main` without hiding that rule in arbitrary JavaScript?

`CI.when` accepts a small serializable condition algebra. The plan can display and
validate the branch before execution, and every runner evaluates the same predicate.
Ordinary Effect control flow remains available for decisions that are genuinely
runtime-only.

Property-based tests are useful for exercising combinations of events and refs, but
they cannot make an arbitrary JavaScript `if` inspectable. The declarative predicate is
what makes planning possible; tests verify its algebra.

Run the executable verification:

```sh
node --import tsx examples/conditional-deploy/verify.ts
```

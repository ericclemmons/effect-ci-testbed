# Effect owns CI path matching

## Context

Effect 4.1 supplies path matching. Our custom compiler duplicated it and sent
JavaScript regexes to a Python snapshot scanner. Snapshot containers guarantee
Python, not Node or an installed Effect package.

## Decision

Use `effect/Glob` for source queries, directory deployment, snapshot selection,
and manifest validation. Use brace alternatives and include dotfiles. Remove
the custom glob compiler rather than translating its old syntax.

The snapshot scanner lists bounded candidate paths. The host selects them with
Effect, then the scanner hashes those exact files. Keep symlink rejection,
traversal/byte limits, file identity checks, and inspection-container cleanup.
Reject missing selected files rather than returning a partial manifest.

## Consequences

Snapshot inspection makes two read-only container calls. Python has no glob or
regex implementation. Package-manager membership retains picomatch because it
follows external workspace conventions, including extglobs unsupported by Effect.
Reconsider the scanner transport when containers guarantee a shared JS runtime.

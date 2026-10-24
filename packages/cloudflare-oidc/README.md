# Cloudflare workload credentials

Shared credential-exchange primitives for the hosted CI app: GitHub signature
verification, owner/repository grants, explicit Cloudflare permission mapping,
one-use token leases, 15-minute expiration, and signed revocation receipts.
The package is not a separately deployed credential service.

[Identity and grants](./src/auth.ts "source")

[Token lease and exchange handler](./src/worker.ts "source")

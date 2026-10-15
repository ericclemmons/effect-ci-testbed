import type { PublicIncidentEnrollment } from "../../../packages/github/src/public-incident.ts";

// HOST SOURCE ONLY. Do not populate from a webhook, RPC payload, caller env or
// model. Remain disabled until exact producer deployment+fixture enrollment,
// private evidence, bounded agent/writer and same-ledger policy are all ready.
export const publicIncidentEnrollment: PublicIncidentEnrollment | undefined = undefined;

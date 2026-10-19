import { OWNED_INCIDENT as p } from "../src/owned-incident.ts";
/** LOCAL synthetic protocol fixture, never evidence of native delivery. */
export function ownedNotificationFixture() {
  return {
    alert_type: "workers_observability_real_time_issue",
    policy_id: p.notificationPolicyId,
    alert_event: "ALERT_STATE_EVENT_START",
    alert_correlation_id: p.correlationId,
    data: {
      state_event: "ALERT_STATE_EVENT_START",
      state_correlation_id: p.correlationId,
      issue: {
        id: p.issueId,
        count: "1",
        fingerprint: p.fingerprint,
        first_observed: p.firstObserved,
        last_observed: p.firstObserved,
        status: "ISSUE_STATUS_ACTIVE",
        type: "ISSUE_TYPE_LOG",
        services: [
          {
            name: p.service,
            type: "SERVICE_TYPE_WORKER",
            first_observed: p.firstObserved,
            last_observed: p.firstObserved,
          },
        ],
      },
    },
  };
}

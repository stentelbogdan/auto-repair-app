export type NotificationRecipientRole = "customer" | "workshop";

export const TOWING_TRACKING_STARTED_NOTIFICATION_TYPE = "towing_tracking_started";

// Only the exact contextual destination produced by the server is accepted.
export function getTowingTrackingNotificationTarget(notification: {
  type?: string | null;
  request_id?: string | null;
  target_url?: string | null;
}): string | null {
  const id = notification.request_id;
  if (notification.type !== TOWING_TRACKING_STARTED_NOTIFICATION_TYPE ||
      !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const target = `/customer/my-jobs/${id}`;
  return notification.target_url === target ? target : null;
}

export const WORKSHOP_STARTED_JOB_NOTIFICATION_TYPE =
  "workshop_started_job";

export const WORKSHOP_OFFER_REJECTED_NOTIFICATION_TYPE =
  "workshop_offer_rejected";

export const WORKSHOP_REQUEST_CLOSED_NOTIFICATION_TYPE =
  "workshop_request_closed";

export const CUSTOMER_REVIEW_SUBMITTED_NOTIFICATION_TYPE =
  "customer_review_submitted";

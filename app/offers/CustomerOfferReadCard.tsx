"use client";

import { useMemo, type ReactNode } from "react";
import type { OfferReadObservation } from "@/lib/offer-read-version";
import type { useVisibleNotificationRead } from "@/lib/hooks/useVisibleNotificationRead";

// Carousel scroll changes parent state. Keep the ref attached while the same
// authorized version is displayed, otherwise React aborts its pending receipt.
export default function CustomerOfferReadCard({ requestId, offerId, appointmentId, observation, observe, children }: {
  requestId: string;
  offerId: string;
  appointmentId?: string;
  observation: OfferReadObservation | null;
  observe: ReturnType<typeof useVisibleNotificationRead>["observe"];
  children: ReactNode;
}) {
  const userId = observation?.userId;
  const role = observation?.role;
  const observedOfferId = observation?.offerId;
  const version = observation?.version;
  const ref = useMemo(() => observe({ requestId, offerId, appointmentId },
    userId && role && observedOfferId && version
      ? { userId, role, offerId: observedOfferId, version } : null),
  [observe, requestId, offerId, appointmentId, userId, role, observedOfferId, version]);
  return <div data-focus-request={requestId} data-focus-offer={offerId}
    data-focus-appointment={appointmentId} ref={ref} className="min-w-full shrink-0 snap-start px-px">
    {children}
  </div>;
}

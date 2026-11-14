"use client";

import { useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/client";
import { useVisibleNotificationRead } from "@/lib/hooks/useVisibleNotificationRead";
import { TOWING_TRACKING_STARTED_NOTIFICATION_TYPE } from "@/lib/notifications";

const TYPES = [TOWING_TRACKING_STARTED_NOTIFICATION_TYPE];

// Reuse the existing visibility/session checks and verified read receipts.
// A later INSERT while this detail page is open needs a new observation batch.
export function useTowingTrackingNotificationRead(context: {
  requestId: string;
  offerId?: string;
  appointmentId?: string;
  ownerId?: string;
  enabled: boolean;
}) {
  const { requestId, offerId, appointmentId, ownerId, enabled } = context;
  const { capture, complete, observe } = useVisibleNotificationRead("customer", TYPES);

  useEffect(() => {
    if (!enabled || !ownerId || !offerId || !appointmentId) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (disposed || error || data.user?.id !== ownerId) return;
        await capture(ownerId, true);
        if (!disposed) complete(ownerId);
      } catch { /* Keep the notification unread if the session cannot be verified. */ }
    };
    const channel = supabase.channel(`towing-notification-read-${requestId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `recipient_id=eq.${ownerId}`,
      }, ({ new: row }) => {
        if (row.type === TOWING_TRACKING_STARTED_NOTIFICATION_TYPE &&
            row.recipient_role === "customer" && row.request_id === requestId &&
            row.offer_id === offerId && row.appointment_id === appointmentId) void refresh();
      })
      .subscribe(status => { if (status === "SUBSCRIBED") void refresh(); });
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [requestId, offerId, appointmentId, ownerId, enabled, capture, complete]);

  return useMemo(() => enabled && ownerId && offerId && appointmentId
    ? observe({ requestId, offerId, appointmentId }) : undefined,
  [enabled, ownerId, requestId, offerId, appointmentId, observe]);
}

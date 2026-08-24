import { supabase } from "@/lib/supabase/client";

export type NotificationRecipientRole = "customer" | "workshop";

export const WORKSHOP_STARTED_JOB_NOTIFICATION_TYPE =
  "workshop_started_job";

type MarkNotificationsAsReadInput = {
  types: string[];
  recipientRole: NotificationRecipientRole;
  requestId?: string;
  offerId?: string;
  appointmentId?: string;
};

export async function markNotificationsAsRead({
  types,
  recipientRole,
  requestId,
  offerId,
  appointmentId,
}: MarkNotificationsAsReadInput): Promise<boolean> {
  if (types.length === 0) {
    return true;
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser();

  if (authError) {
    console.error(
      "Failed to identify notification recipient:",
      authError,
    );
    return false;
  }

  if (!authData.user) {
    return false;
  }

  let query = supabase
    .from("notifications")
    .update({
      read_at: new Date().toISOString(),
    })
    .eq("recipient_id", authData.user.id)
    .eq("recipient_role", recipientRole)
    .is("read_at", null)
    .in("type", types);

  /*
    Filtrele sunt opționale. Când intrăm direct într-un anumit card,
    putem marca doar notificările acelei lucrări.
  */
  if (requestId) {
    query = query.eq("request_id", requestId);
  }

  if (offerId) {
    query = query.eq("offer_id", offerId);
  }

  if (appointmentId) {
    query = query.eq("appointment_id", appointmentId);
  }

  const { error } = await query;

  if (error) {
    console.error(
      "Failed to mark notifications as read:",
      error,
    );
    return false;
  }

  /*
    AppNavbar ascultă acest eveniment și își recalculează badge-urile.
  */
  window.dispatchEvent(new Event("notifications-read-updated"));

  return true;
}

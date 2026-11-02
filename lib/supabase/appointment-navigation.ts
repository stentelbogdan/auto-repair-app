import { supabase } from "@/lib/supabase/client";
import { getWorkshopRequestDetail } from "@/lib/supabase/workshop-request-detail";

export type AppointmentProposalNotification = {
  type?: string | null;
  request_id?: string | null;
  offer_id?: string | null;
  appointment_id?: string | null;
};

export function isAppointmentProposal(type: string | null | undefined) {
  return type === "customer_proposed_appointment" || type === "workshop_proposed_appointment";
}

// Resolve current, RLS-authorized state on navigation, not from a stale target_url.
// This changes no notification, read-state, subscription or appointment.
export async function getAppointmentProposalDestination(
  notification: AppointmentProposalNotification,
  role: "customer" | "workshop",
  userId: string,
): Promise<string | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (notification.type !== (role === "workshop" ? "customer_proposed_appointment" : "workshop_proposed_appointment") ||
      ![userId, notification.request_id, notification.offer_id, notification.appointment_id].every(v => typeof v === "string" && uuid.test(v))) return null;
  const { data: appointment, error } = await supabase.from("repair_appointments")
    .select("id, request_id, offer_id")
    .eq("id", notification.appointment_id!)
    .eq("request_id", notification.request_id!)
    .eq("offer_id", notification.offer_id!)
    .eq(role === "workshop" ? "workshop_id" : "customer_id", userId).maybeSingle();
  if (error) throw error;
  if (!appointment || appointment.id !== notification.appointment_id ||
      appointment.request_id !== notification.request_id || appointment.offer_id !== notification.offer_id) return null;

  const request = role === "workshop"
    ? await getWorkshopRequestDetail(notification.request_id!)
    : await (async () => {
      const result = await supabase.from("repair_requests")
        .select("id, status, accepted_offer_id, service_type")
        .eq("id", notification.request_id!).eq("user_id", userId).maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    })();
  if (!request || request.id !== notification.request_id) return null;
  const category = ["bodywork", "mechanical", "wheels", "towing"].includes(request.service_type ?? "")
    ? request.service_type : "all";
  if (["matched", "in_progress"].includes(request.status ?? "") && request.accepted_offer_id === notification.offer_id) {
    const tab = role === "workshop"
      ? (request.status === "in_progress" ? "workshop" : "appointments")
      : (request.status === "in_progress" ? "in_progress" : "scheduled");
    return `${role === "workshop" ? "/workshops/won-jobs" : "/customer/my-jobs"}?tab=${tab}&category=${category}&focusRequest=${request.id}`;
  }
  if (request.status === "open" && !request.accepted_offer_id) {
    return `${role === "workshop" ? "/workshops/my-offers" : "/offers"}?category=${category}&focusOffer=${notification.offer_id}`;
  }
  return null;
}

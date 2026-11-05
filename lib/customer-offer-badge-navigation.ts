import { supabase } from "@/lib/supabase/client";
import { getAppointmentProposalDestination } from "@/lib/supabase/appointment-navigation";

// Compare the available event timestamps, including PostgreSQL microseconds.
// read_state_version is a concurrency token, never an event timestamp.
function eventTime(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("INVALID_BADGE_EVENT_TIME");
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/.exec(value)?.[1] ?? "";
  return BigInt(milliseconds) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}

export async function getCustomerOfferBadgeDestination(userId: string): Promise<string> {
  const assertUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.id !== userId) throw new Error("BADGE_SESSION_CHANGED");
  };
  await assertUser();
  const { data: requests, error } = await supabase.from("repair_requests")
    .select("id,status,service_type,accepted_offer_id").eq("user_id", userId);
  if (error || !Array.isArray(requests)) throw new Error("BADGE_REQUESTS_UNAVAILABLE");
  const active = requests.filter(request => (request.status || "open") !== "completed");
  const proposals = await supabase.from("notifications")
    .select("type,request_id,offer_id,appointment_id,created_at")
    .eq("recipient_id", userId).eq("recipient_role", "customer").is("read_at", null)
    .eq("type", "workshop_proposed_appointment")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (proposals.error) throw new Error("BADGE_NOTIFICATIONS_UNAVAILABLE");
  const offers = active.length ? await supabase.from("repair_offers")
    .select("id,request_id,status,created_at").in("request_id", active.map(request => request.id))
    .is("customer_read_at", null).order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null };
  if (offers.error) throw new Error("BADGE_OFFERS_UNAVAILABLE");
  const proposal = proposals.data, offer = offers.data;
  let destination = "/offers";
  if (proposal && (!offer || eventTime(proposal.created_at) >= eventTime(offer.created_at))) {
    const resolved = await getAppointmentProposalDestination(proposal, "customer", userId);
    if (!resolved) throw new Error("BADGE_CONTEXT_UNAVAILABLE");
    destination = resolved;
  } else if (offer) {
    const request = active.find(row => row.id === offer.request_id);
    if (!request) throw new Error("BADGE_CONTEXT_UNAVAILABLE");
    const category = request.service_type || "bodywork";
    if (!["bodywork", "mechanical", "wheels", "towing"].includes(category)) throw new Error("BADGE_CONTEXT_UNAVAILABLE");
    const winner = request.accepted_offer_id === offer.id;
    const path = offer.status === "pending" ? "/offers?"
      : winner && ["matched", "in_progress"].includes(request.status)
        ? `/customer/my-jobs?tab=${request.status === "in_progress" ? "in_progress" : "scheduled"}&`
        : null;
    if (!path) throw new Error("BADGE_CONTEXT_UNAVAILABLE");
    destination = `${path}category=${category}&focusOffer=${encodeURIComponent(offer.id)}&focusRequest=${encodeURIComponent(request.id)}`;
  }
  await assertUser();
  return destination;
}

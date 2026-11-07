import { supabase } from "./client";
import { loadWorkshopOfferRequests } from "./workshop-offer-requests";

// Same authorized sources and tab rules as Service → Programări.
export async function fetchWorkshopActiveJobsCount(userId: string): Promise<number> {
  const { data: offers, error: offersError } = await supabase
    .from("repair_offers")
    .select("request_id")
    .eq("workshop_user_id", userId)
    .eq("status", "accepted");
  if (offersError) throw offersError;
  if (!Array.isArray(offers) || offers.some(offer => typeof offer.request_id !== "string" || !offer.request_id)) {
    throw new Error("WORKSHOP_ACTIVE_JOBS_UNAVAILABLE");
  }
  const requestIds = [...new Set(offers.map(offer => offer.request_id as string))];
  if (requestIds.length === 0) return 0;

  const [{ data: appointments, error: appointmentsError }, requests] = await Promise.all([
    supabase.from("repair_appointments")
      .select("request_id, status")
      .eq("workshop_id", userId)
      .in("request_id", requestIds)
      .order("updated_at", { ascending: false }),
    loadWorkshopOfferRequests(requestIds),
  ]);
  if (appointmentsError) throw appointmentsError;
  if (!Array.isArray(appointments)) throw new Error("WORKSHOP_ACTIVE_JOBS_UNAVAILABLE");
  const latestAppointments = new Map<string, string>();
  for (const appointment of appointments) {
    if (typeof appointment.request_id !== "string" || typeof appointment.status !== "string") {
      throw new Error("WORKSHOP_ACTIVE_JOBS_UNAVAILABLE");
    }
    if (!latestAppointments.has(appointment.request_id)) {
      latestAppointments.set(appointment.request_id, appointment.status);
    }
  }

  let count = 0;
  for (const requestId of requestIds) {
    const request = requests.get(requestId);
    // An absent/denied/invalid RPC result is not evidence of zero active jobs.
    if (!request) throw new Error("WORKSHOP_ACTIVE_JOBS_UNAVAILABLE");
    if (request.status === "in_progress" ||
      (request.status === "matched" && latestAppointments.get(requestId) === "confirmed")) {
      count += 1;
    }
  }
  return count;
}

import { supabase } from "@/lib/supabase/client";
import { loadWithOfferVersion } from "@/lib/offer-read-version";

export type RepairOfferRow = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  price: string;
  days: string;
  message: string | null;
  workshop_name: string;
  available_date: string | null;
  available_time: string | null;
  status: string;
  created_at: string;
  read_state_version?: unknown;
};

export async function createRepairOffer(input: {
  requestId: string;
  workshopUserId: string;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  availableDate?: string;
  availableTime?: string;
  handoverMethod?: "customer_dropoff" | "workshop_pickup";
  pickupAddress?: string;
}): Promise<string> {
  // Keep workshopUserId in the caller contract, but only the authenticated
  // identity inside the RPC may determine the workshop owning the offer.
  const { data, error } = await supabase.rpc("create_repair_offer_with_appointment", {
    p_request_id: input.requestId,
    p_price: input.price,
    p_days: input.days,
    p_message: input.message,
    p_workshop_name: input.workshopName,
    p_available_date: input.availableDate || null,
    p_available_time: input.availableTime || null,
    p_handover_method: input.handoverMethod || "customer_dropoff",
    p_pickup_address: input.handoverMethod === "workshop_pickup"
      ? input.pickupAddress?.trim() || null
      : null,
  });

  if (error) throw error;

  if (typeof data !== "string" || data.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
    // A malformed response does not prove rollback. Never retry or compensate.
    throw new Error("Răspunsul creării ofertei nu conține un ID valid. Verifică lista ofertelor înainte de a reîncerca.");
  }

  return data;
}

export async function getOffersForCustomerRequests(userId: string, withReadVersion = false) {
  const { data: requests, error: requestsError } = await supabase
    .from("repair_requests")
    .select("id")
    .eq("user_id", userId);

  if (requestsError) {
    throw requestsError;
  }

  const requestIds = (requests ?? []).map((request) => request.id);

  if (!requestIds.length) {
    return [];
  }

  const load = (projection: string) => supabase
    .from("repair_offers")
    .select(`*${projection}`)
    .in("request_id", requestIds)
    .order("created_at", { ascending: false })
    .overrideTypes<RepairOfferRow[], { merge: false }>();
  const { data: offers, error: offersError } = withReadVersion
    ? await loadWithOfferVersion(load)
    : await load("");

  if (offersError) {
    throw offersError;
  }

  return offers ?? [];
}

export async function getOffersForWorkshop(userId: string) {
  const { data, error } = await supabase
    .from("repair_offers")
    .select("*")
    .eq("workshop_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as RepairOfferRow[];
}

export async function finalizeCustomerRepairOffer(input: {
  offerId: string;
  requestId: string;
}) {
  const { error } = await supabase.rpc("finalize_customer_repair_offer", {
    p_offer_id: input.offerId,
    p_request_id: input.requestId,
  });

  if (error) {
    throw error;
  }
}

export async function finalizeWorkshopCustomerProposal(input: {
  offerId: string;
  requestId: string;
}) {
  const { error } = await supabase.rpc(
    "finalize_workshop_customer_proposal",
    {
      p_offer_id: input.offerId,
      p_request_id: input.requestId,
    },
  );

  if (error) {
    throw error;
  }
}

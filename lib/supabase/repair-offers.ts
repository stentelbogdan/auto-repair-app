import { supabase } from "@/lib/supabase/client";

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
}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user || authData.user.id !== input.workshopUserId) {
    throw new Error("Service-ul autentificat nu corespunde ofertei.");
  }

  const { data: offerId, error: createError } = await supabase.rpc(
    "create_repair_offer_with_appointment",
    {
      p_request_id: input.requestId,
      p_price: input.price,
      p_days: input.days,
      p_message: input.message,
      p_workshop_name: input.workshopName,
      p_available_date: input.availableDate || null,
      p_available_time: input.availableTime || null,
      p_handover_method: input.handoverMethod || "customer_dropoff",
      p_pickup_address:
        input.handoverMethod === "workshop_pickup"
          ? input.pickupAddress?.trim() || null
          : null,
    },
  );

  if (createError) throw createError;
  if (typeof offerId !== "string") {
    throw new Error("Oferta a fost creată fără un ID valid.");
  }

  const { data: offer, error: offerError } = await supabase
    .from("repair_offers")
    .select("*")
    .eq("id", offerId)
    .eq("request_id", input.requestId)
    .eq("workshop_user_id", input.workshopUserId)
    .single();

  if (offerError) throw offerError;

  return offer as RepairOfferRow;
}

export async function getOffersForCustomerRequests(userId: string) {
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

  const { data: offers, error: offersError } = await supabase
    .from("repair_offers")
    .select("*")
    .in("request_id", requestIds)
    .order("created_at", { ascending: false });

  if (offersError) {
    throw offersError;
  }

  return (offers ?? []) as RepairOfferRow[];
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

export async function markCustomerRepairOffersRead(offerIds: string[]) {
  const uniqueOfferIds = [...new Set(offerIds)];
  if (uniqueOfferIds.length === 0) return;

  const { error } = await supabase.rpc("mark_customer_repair_offers_read", {
    p_offer_ids: uniqueOfferIds,
  });

  if (error) throw error;
}

export async function markWorkshopRepairOffersRead(offerIds: string[]) {
  const uniqueOfferIds = [...new Set(offerIds)];
  if (uniqueOfferIds.length === 0) return;

  const { error } = await supabase.rpc("mark_workshop_repair_offers_read", {
    p_offer_ids: uniqueOfferIds,
  });

  if (error) throw error;
}

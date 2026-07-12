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
  // 1. Luăm clientul căruia îi aparține cererea
  const { data: request, error: requestError } = await supabase
    .from("repair_requests")
    .select("user_id")
    .eq("id", input.requestId)
    .single();

  if (requestError) {
    throw requestError;
  }

  if (!request?.user_id) {
    throw new Error("Nu am putut identifica clientul cererii.");
  }

  // 2. Creăm oferta
  const { data: offer, error: offerError } = await supabase
    .from("repair_offers")
    .insert({
      request_id: input.requestId,
      workshop_user_id: input.workshopUserId,
      price: input.price,
      days: input.days,
      message: input.message,
      workshop_name: input.workshopName,
      available_date: input.availableDate || null,
      available_time: input.availableTime || null,
      status: "pending",
    })
    .select()
    .single();

  if (offerError) {
    throw offerError;
  }

  if (!offer?.id) {
    throw new Error("Oferta a fost creată fără un ID valid.");
  }

  // 3. Creăm programarea inițială propusă de service
  const { error: appointmentError } = await supabase
    .from("repair_appointments")
    .insert({
      request_id: input.requestId,
      offer_id: offer.id,
      customer_id: request.user_id,
      workshop_id: input.workshopUserId,

      appointment_date: input.availableDate || null,
      appointment_time: input.availableTime || null,

      original_date: input.availableDate || null,
      original_time: input.availableTime || null,

      proposed_date: input.availableDate || null,
      proposed_time: input.availableTime || null,

      handover_method: input.handoverMethod || "customer_dropoff",

      pickup_address:
        input.handoverMethod === "workshop_pickup"
          ? input.pickupAddress?.trim() || null
          : null,

      status: "requested",
    });

  if (appointmentError) {
    const { error: rollbackError } = await supabase
      .from("repair_offers")
      .delete()
      .eq("id", offer.id);

    if (rollbackError) {
      console.error(
        "Programarea nu a fost creată, iar oferta nu a putut fi ștearsă:",
        rollbackError,
      );
    }

    throw appointmentError;
  }

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

export async function acceptRepairOffer(input: {
  offerId: string;
  requestId: string;
}) {
  const { error } = await supabase.rpc("accept_repair_offer", {
    p_offer_id: input.offerId,
    p_request_id: input.requestId,
  });

  if (error) {
    throw error;
  }
}

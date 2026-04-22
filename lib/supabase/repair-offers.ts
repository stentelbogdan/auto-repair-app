import { supabase } from "@/lib/supabase/client";

export type RepairOfferRow = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  price: string;
  days: string;
  message: string | null;
  workshop_name: string;
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
}) {
  const { data, error } = await supabase
    .from("repair_offers")
    .insert({
      request_id: input.requestId,
      workshop_user_id: input.workshopUserId,
      price: input.price,
      days: input.days,
      message: input.message,
      workshop_name: input.workshopName,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as RepairOfferRow;
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
  const { error: rejectError } = await supabase
    .from("repair_offers")
    .update({ status: "rejected" })
    .eq("request_id", input.requestId);

  if (rejectError) {
    throw rejectError;
  }

  const { error: acceptError } = await supabase
    .from("repair_offers")
    .update({ status: "accepted" })
    .eq("id", input.offerId);

  if (acceptError) {
    throw acceptError;
  }

  const { error: requestError } = await supabase
    .from("repair_requests")
    .update({
      status: "matched",
      accepted_offer_id: input.offerId,
    })
    .eq("id", input.requestId);

  if (requestError) {
    throw requestError;
  }
}
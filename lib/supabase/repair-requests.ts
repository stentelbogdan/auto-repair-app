import { supabase } from "@/lib/supabase/client";
import { formatLicensePlateForDb } from "@/lib/utils/licensePlate";

export type RepairRequestRow = {
  id: string;
  user_id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  license_plate: string | null;
  damage_type: string;

  service_type?: "bodywork" | "mechanical";

  request_type?: "repair" | "direct_request" | "direct_message";
  target_workshop_id?: string | null;

  description: string | null;

  images: {
    name: string;
    url?: string;
    thumbUrl?: string;
    dataUrl?: string;
  }[];

  status: string;
  accepted_offer_id: string | null;
  created_at: string;
  offers_count?: number;
};

export async function createRepairRequest(input: {
  userId: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  licensePlate?: string;
  damageType: string;
  description: string;
  serviceType?: "bodywork" | "mechanical";
  requestType?: "repair" | "direct_request" | "direct_message";
  targetWorkshopId?: string | null;
  images: {
    name: string;
    url?: string;
    thumbUrl?: string;
    dataUrl?: string;
  }[];
}) {
  const { data, error } = await supabase
    .from("repair_requests")
    .insert({
      user_id: input.userId,
      car_brand: input.carBrand,
      car_model: input.carModel,
      car_year: input.carYear,
      city: input.city,
      license_plate: formatLicensePlateForDb(input.licensePlate),
      damage_type: input.damageType,
      description: input.description,
      service_type: input.serviceType ?? "bodywork",
      request_type: input.requestType ?? "repair",
      target_workshop_id: input.targetWorkshopId ?? null,
      images: input.images,
      status: "open",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as RepairRequestRow;
}

export async function getWorkshopRepairRequests() {
  const { data, error } = await supabase
    .from("repair_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as RepairRequestRow[];
}

export async function getOwnRepairRequests(userId: string) {
  const { data, error } = await supabase
    .from("repair_requests")
    .select(
      "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, service_type, request_type, target_workshop_id, description, images, status, accepted_offer_id, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const requests = ((data ?? []) as RepairRequestRow[]).filter(
    (request) => request.request_type !== "direct_message",
  );
  const requestIds = requests.map((request) => request.id);

  if (!requestIds.length) {
    return [];
  }

  const { data: offers, error: offersError } = await supabase
    .from("repair_offers")
    .select("request_id")
    .in("request_id", requestIds);

  if (offersError) {
    throw offersError;
  }

  const offersCountByRequest = new Map<string, number>();

  (offers ?? []).forEach((offer) => {
    offersCountByRequest.set(
      offer.request_id,
      (offersCountByRequest.get(offer.request_id) ?? 0) + 1,
    );
  });

  return requests.map((request) => ({
    ...request,
    offers_count: offersCountByRequest.get(request.id) ?? 0,
  }));
}

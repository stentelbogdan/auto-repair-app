import { supabase } from "@/lib/supabase/client";
import type {
  SupportedMechanicalServiceDetails,
} from "@/lib/mechanical/mechanical-service-details";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import type { TowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";
import { formatLicensePlateForDb } from "@/lib/utils/licensePlate";
import type { WheelsServiceDetails } from "@/lib/wheels/wheels-service-details";

export type StructuredServiceDetails = {
  version: 1;

  selectedServices: string[];

  carDamage: {
    parts: string[];
    damages: string[];
  };

  options: string[];
};

export type RepairServiceDetails =
  | string[]
  | StructuredServiceDetails
  | SupportedMechanicalServiceDetails
  | WheelsServiceDetails
  | TowingServiceDetailsV1;

export type RepairRequestRow = {
  id: string;
  user_id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  route_distance_meters?: number | null;
  route_duration_seconds?: number | null;
  license_plate: string | null;
  damage_type: string;
  service_details?: RepairServiceDetails;

  service_type?: RepairServiceType | null;

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
  view_count?: number;
};

type CustomerRequestViewCountRow = {
  request_id: string;
  view_count: number | string | null;
};

export async function createRepairRequest(input: {
  userId: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  routeDistanceMeters?: number | null;
  routeDurationSeconds?: number | null;
  licensePlate?: string;
  damageType: string;
  serviceDetails?: RepairServiceDetails;
  description: string;
  serviceType?: RepairServiceType;
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
      pickup_lat: input.pickupLat,
      pickup_lng: input.pickupLng,
      destination_lat: input.destinationLat,
      destination_lng: input.destinationLng,
      route_distance_meters: input.routeDistanceMeters,
      route_duration_seconds: input.routeDurationSeconds,
      license_plate: formatLicensePlateForDb(input.licensePlate),
      damage_type: input.damageType,
      service_details: input.serviceDetails ?? [],
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
      "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, service_details, service_type, request_type, target_workshop_id, description, images, status, accepted_offer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, route_distance_meters, route_duration_seconds, created_at",
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

  const [offersResult, viewCountsResult] = await Promise.all([
    supabase
      .from("repair_offers")
      .select("request_id")
      .in("request_id", requestIds),
    supabase.rpc("get_customer_request_view_counts", {
      p_request_ids: requestIds,
    }),
  ]);

  if (offersResult.error) {
    throw offersResult.error;
  }

  if (viewCountsResult.error) {
    throw viewCountsResult.error;
  }

  const offersCountByRequest = new Map<string, number>();
  const viewCountByRequest = new Map<string, number>();

  (offersResult.data ?? []).forEach((offer) => {
    offersCountByRequest.set(
      offer.request_id,
      (offersCountByRequest.get(offer.request_id) ?? 0) + 1,
    );
  });

  ((viewCountsResult.data ?? []) as CustomerRequestViewCountRow[]).forEach(
    (row) => {
      const count = Number(row.view_count ?? 0);
      viewCountByRequest.set(
        row.request_id,
        Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      );
    },
  );

  return requests.map((request) => ({
    ...request,
    offers_count: offersCountByRequest.get(request.id) ?? 0,
    view_count: viewCountByRequest.get(request.id) ?? 0,
  }));
}

import { supabase } from "@/lib/supabase/client";
import type {
  SupportedMechanicalServiceDetails,
} from "@/lib/mechanical/mechanical-service-details";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import type { TowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";
import type { TowingRoutePaths } from "@/lib/towing/towing-route";
import { formatLicensePlateForDb } from "@/lib/utils/licensePlate";
import type { WheelsServiceDetails } from "@/lib/wheels/wheels-service-details";
import type { RepairRequestDiscoveryLocation } from "@/lib/geo/geo-location";
// @ts-expect-error TS5097: source extension for offline Node tests.
import { createRequestPhotoNotifications, type PreparedRequestPhotoNotification } from "../admin/photo-notification-client.ts";

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

export type TowingScheduleType = "asap" | "scheduled";

export type RepairRequestImage = {
  name: string;
  url?: string;
  thumbUrl?: string;
  dataUrl?: string;
  path?: string;
  fingerprint?: string;
  fingerprintVersion?: string;
};

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
  route_paths: TowingRoutePaths | null;
  towing_schedule_type?: TowingScheduleType | null;
  towing_requested_at?: string | null;
  towing_requested_timezone?: string | null;
  license_plate: string | null;
  damage_type: string;
  service_details?: RepairServiceDetails;

  service_type?: RepairServiceType | null;

  request_type?: "repair" | "direct_request" | "direct_message";
  target_workshop_id?: string | null;

  description: string | null;

  images: RepairRequestImage[];

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

export const CUSTOMER_REQUEST_VIEW_COUNT_CHANGED_NOTIFICATION_TYPE =
  "customer_request_view_count_changed";

function toCustomerRequestViewCount(value: number | string | null) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export async function getCustomerRequestViewCount(
  requestId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc(
    "get_customer_request_view_counts",
    { p_request_ids: [requestId] },
  );

  if (error) {
    throw error;
  }

  const row = ((data ?? []) as CustomerRequestViewCountRow[]).find(
    (item) => item.request_id === requestId,
  );

  return row ? toCustomerRequestViewCount(row.view_count) : null;
}

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
  routePaths?: TowingRoutePaths | null;
  towingScheduleType?: TowingScheduleType | null;
  towingRequestedAt?: string | null;
  towingRequestedTimezone?: string | null;
  licensePlate?: string;
  damageType: string;
  serviceDetails?: RepairServiceDetails;
  description: string;
  serviceType?: RepairServiceType;
  requestType?: "repair" | "direct_request" | "direct_message";
  targetWorkshopId?: string | null;
  images: RepairRequestImage[];
  discoveryLocation: RepairRequestDiscoveryLocation;
}) {
  let notification: PreparedRequestPhotoNotification | null = null;
  // One ticket for the new association list, distinct from per-object uploads.
  // Await preparation BEFORE the create transaction; failure never blocks it.
  if (input.images.length > 0) {
    try {
      notification = await createRequestPhotoNotifications({
        enabled: typeof window !== "undefined" && process.env.NEXT_PUBLIC_ADMIN_PHOTO_BROADCAST_ENABLED === "true",
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        projectRef: process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF,
        session: async () => {
          const { data, error } = await supabase.auth.getSession();
          return error ? null : data.session;
        },
        fetch: (url, init) => globalThis.fetch(url, init),
      }).prepareCreation(input.userId);
    } catch { /* Auxiliary notification cannot fail request creation. */ }
  }
  const { data, error } = await supabase.rpc(
    "create_repair_request_with_discovery_location",
    {
      p_request: {
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
      ...(input.routePaths == null ? {} : { route_paths: input.routePaths }),
      towing_schedule_type: input.towingScheduleType ?? null,
      towing_requested_at: input.towingRequestedAt ?? null,
      towing_requested_timezone: input.towingRequestedTimezone ?? null,
      license_plate: formatLicensePlateForDb(input.licensePlate),
      damage_type: input.damageType,
      service_details: input.serviceDetails ?? [],
      description: input.description,
      service_type: input.serviceType ?? "bodywork",
      request_type: input.requestType ?? "repair",
      target_workshop_id: input.targetWorkshopId ?? null,
      images: input.images,
      status: "open",
      },
      p_discovery: {
        locality: input.discoveryLocation.locality,
        postal_code: input.discoveryLocation.postalCode,
        country_code: input.discoveryLocation.countryCode,
        lat: input.discoveryLocation.lat,
        lng: input.discoveryLocation.lng,
        source: input.discoveryLocation.source,
      },
    },
  );

  if (error) {
    throw error;
  }

  // Preserve the RPC result verbatim, including unexpected results. Only the
  // notification helper validates the returned ID before attempting confirm.
  try { await notification?.confirm(data); } catch { /* No retry or false failure. */ }
  return data as string;
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
      "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, service_details, service_type, request_type, target_workshop_id, description, images, status, accepted_offer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, route_distance_meters, route_duration_seconds, route_paths, towing_schedule_type, towing_requested_at, towing_requested_timezone, created_at",
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
      viewCountByRequest.set(
        row.request_id,
        toCustomerRequestViewCount(row.view_count),
      );
    },
  );

  return requests.map((request) => ({
    ...request,
    offers_count: offersCountByRequest.get(request.id) ?? 0,
    view_count: viewCountByRequest.get(request.id) ?? 0,
  }));
}
